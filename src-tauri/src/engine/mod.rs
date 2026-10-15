use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::sync::{Arc, Mutex as StdMutex, Weak};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{watch, Mutex},
    time::{timeout, Duration},
};

pub struct EngineManager {
    session: Mutex<Option<EngineSession>>,
    jobs: StdMutex<Vec<Weak<AnalysisJob>>>,
}
impl EngineManager {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
            jobs: StdMutex::new(Vec::new()),
        }
    }
    pub fn stop(&self, request_id: Option<&str>) {
        self.jobs.lock().unwrap().retain(|job| {
            if let Some(job) = job.upgrade() {
                if request_id.is_none() || job.request_id.as_deref() == request_id {
                    job.cancel.send_replace(true);
                }
                true
            } else {
                false
            }
        });
    }
    fn register(&self, request_id: Option<&str>) -> Arc<AnalysisJob> {
        let (cancel, _) = watch::channel(false);
        let job = Arc::new(AnalysisJob {
            request_id: request_id.map(str::to_owned),
            cancel,
        });
        let mut jobs = self.jobs.lock().unwrap();
        jobs.retain(|job| job.strong_count() > 0);
        jobs.push(Arc::downgrade(&job));
        job
    }
}
struct AnalysisJob {
    request_id: Option<String>,
    cancel: watch::Sender<bool>,
}
pub const MULTIPV: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variation {
    pub rank: u32,
    pub depth: u32,
    pub score_type: String,
    pub score_value: i32,
    pub pv: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub fen: String,
    pub variations: Vec<Variation>,
}
impl Analysis {
    pub fn from_variations(fen: &str, mut variations: Vec<Variation>) -> Option<Self> {
        variations.sort_by_key(|v| v.rank);
        variations.first().filter(|v| v.rank == 1)?;
        Some(Self {
            fen: fen.into(),
            variations,
        })
    }
}
pub fn parse_info(line: &str, fen: &str) -> Option<Variation> {
    if !line.starts_with("info ") {
        return None;
    }
    let parts: Vec<&str> = line.split_whitespace().collect();
    let mut depth = None;
    let mut score = None;
    let mut pv = vec![];
    let mut multipv = 1;
    let mut i = 1;
    while i < parts.len() {
        match parts[i] {
            "depth" => {
                depth = parts.get(i + 1).and_then(|v| v.parse::<u32>().ok());
                i += 2
            }
            "multipv" => {
                multipv = parts
                    .get(i + 1)
                    .and_then(|v| v.parse::<u32>().ok())
                    .unwrap_or(1);
                i += 2
            }
            "score" => {
                if let (Some(kind), Some(value)) = (
                    parts.get(i + 1),
                    parts.get(i + 2).and_then(|v| v.parse::<i32>().ok()),
                ) {
                    score = Some((kind.to_string(), value))
                }
                i += 3
            }
            "pv" => {
                pv = parts[i + 1..].iter().map(|v| v.to_string()).collect();
                break;
            }
            _ => i += 1,
        }
    }
    let (score_type, raw) = score?;
    if !(1..=MULTIPV).contains(&multipv) {
        return None;
    }
    let white_to_move = fen.split_whitespace().nth(1) == Some("w");
    Some(Variation {
        rank: multipv,
        depth: depth?,
        score_type,
        score_value: if white_to_move { raw } else { -raw },
        pv,
    })
}
pub fn validate(path: &str) -> Result<(), String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("无法找到引擎：{e}"))?;
    if !meta.is_file() || meta.permissions().mode() & 0o111 == 0 {
        return Err("引擎路径不是可执行文件".into());
    }
    Ok(())
}
// Keep completed MultiPV iterations together so ranks from different depths never mix.
#[derive(Default)]
struct SearchProgress {
    depth: u32,
    variations: BTreeMap<u32, Variation>,
    completed: Option<Analysis>,
}
impl SearchProgress {
    fn update(&mut self, fen: &str, variation: Variation) -> Option<Analysis> {
        if variation.pv.is_empty() || variation.depth < self.depth {
            return None;
        }
        let mut ready = None;
        if variation.depth > self.depth {
            // A position may have fewer than three legal moves.
            if self.completed.as_ref().map(|a| a.variations[0].depth) != Some(self.depth) {
                ready = self.snapshot(fen);
            }
            if let Some(ref analysis) = ready {
                self.completed = Some(analysis.clone());
            }
            self.variations.clear();
            self.depth = variation.depth;
        }
        self.variations.insert(variation.rank, variation);
        if self.variations.len() == MULTIPV as usize {
            ready = self.snapshot(fen);
            self.completed = ready.clone();
        }
        ready.filter(|analysis| analysis.variations[0].depth >= 4)
    }
    fn snapshot(&self, fen: &str) -> Option<Analysis> {
        if !(1..=self.variations.len() as u32).all(|rank| self.variations.contains_key(&rank)) {
            return None;
        }
        Analysis::from_variations(fen, self.variations.values().cloned().collect())
    }
    fn finish(self, fen: &str) -> Option<Analysis> {
        let latest = self.snapshot(fen);
        match (&latest, &self.completed) {
            (Some(latest), Some(completed))
                if latest.variations.len() < completed.variations.len() =>
            {
                self.completed
            }
            _ => latest.or(self.completed),
        }
    }
}

struct EngineSession {
    path: String,
    modified: Option<std::time::SystemTime>,
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
}
impl EngineSession {
    async fn start(path: &str, modified: Option<std::time::SystemTime>) -> Result<Self, String> {
        let mut child = Command::new(path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| e.to_string())?;
        let stdin = child.stdin.take().ok_or("引擎 stdin 不可用")?;
        let stdout = child.stdout.take().ok_or("引擎 stdout 不可用")?;
        let mut session = Self {
            path: path.into(),
            modified,
            child,
            stdin,
            lines: BufReader::new(stdout).lines(),
        };
        session.send("uci\n").await?;
        session.read_until("uciok").await?;
        session
            .send(&format!(
                "setoption name Hash value 128\nsetoption name MultiPV value {MULTIPV}\nisready\n"
            ))
            .await?;
        session.read_until("readyok").await?;
        Ok(session)
    }
    async fn send(&mut self, command: &str) -> Result<(), String> {
        self.stdin
            .write_all(command.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        self.stdin.flush().await.map_err(|e| e.to_string())
    }
    async fn read_line(&mut self) -> Result<String, String> {
        self.lines
            .next_line()
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "引擎提前退出".into())
    }
    async fn read_until(&mut self, prefix: &str) -> Result<(), String> {
        while !self.read_line().await?.starts_with(prefix) {}
        Ok(())
    }
    async fn search(
        &mut self,
        fen: &str,
        depth: u32,
        mut on_update: impl FnMut(Analysis),
    ) -> Result<Analysis, String> {
        self.send(&format!(
            "position fen {fen}\ngo depth {}\n",
            depth.clamp(4, 30)
        ))
        .await?;
        let mut progress = SearchProgress::default();
        loop {
            let line = self.read_line().await?;
            if let Some(variation) = parse_info(&line, fen) {
                if let Some(analysis) = progress.update(fen, variation) {
                    on_update(analysis);
                }
            }
            if line.starts_with("bestmove ") {
                return progress.finish(fen).ok_or_else(|| "引擎未返回评价".into());
            }
        }
    }
    async fn stop(&mut self) -> Result<(), String> {
        self.send("stop\n").await?;
        // Consume the previous search's final response before using this process again.
        self.read_until("bestmove ").await
    }
}

pub async fn analyze(
    manager: &EngineManager,
    path: &str,
    fen: &str,
    depth: u32,
    request_id: Option<&str>,
    on_update: impl FnMut(Analysis),
) -> Result<Analysis, String> {
    validate(path)?;
    let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok();
    let job = manager.register(request_id);
    let mut cancelled = job.cancel.subscribe();
    let mut session = tokio::select! {
        biased;
        _ = cancelled.changed() => return Err("分析已取消".into()),
        session = manager.session.lock() => session,
    };
    if *cancelled.borrow() {
        return Err("分析已取消".into());
    }
    let reusable = session.as_mut().is_some_and(|s| {
        s.path == path && s.modified == modified && matches!(s.child.try_wait(), Ok(None))
    });
    if !reusable {
        *session = None;
        let started = tokio::select! {
            biased;
            _ = cancelled.changed() => return Err("分析已取消".into()),
            result = timeout(Duration::from_secs(10), EngineSession::start(path, modified)) => result.map_err(|_| "引擎启动超时".to_string())?,
        };
        *session = Some(started?);
    }
    let engine = session.as_mut().unwrap();
    let result = tokio::select! {
        biased;
        _ = cancelled.changed() => {
            let stopped = timeout(Duration::from_secs(2), engine.stop()).await;
            if !matches!(stopped, Ok(Ok(()))) { *session = None; }
            return Err("分析已取消".into());
        }
        result = timeout(Duration::from_secs(45), engine.search(fen, depth, on_update)) => result.map_err(|_| "引擎分析超时".to_string()).and_then(|r| r),
    };
    if result.is_err() {
        *session = None;
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    fn variation(depth: u32, rank: u32) -> Variation {
        Variation {
            rank,
            depth,
            score_type: "cp".into(),
            score_value: 20,
            pv: vec![match rank {
                1 => "e2e4",
                2 => "d2d4",
                _ => "g1f3",
            }
            .into()],
        }
    }
    #[test]
    fn streaming_keeps_complete_depths_and_handles_partial_final_iteration() {
        let fen = "start";
        let mut progress = SearchProgress::default();
        for rank in 1..3 {
            assert!(progress.update(fen, variation(4, rank)).is_none());
        }
        let first = progress.update(fen, variation(4, 3)).unwrap();
        assert_eq!(first.variations.len(), 3);
        assert!(first.variations.iter().all(|v| v.depth == 4));
        progress.update(fen, variation(5, 1));
        let final_result = progress.finish(fen).unwrap();
        assert_eq!(final_result.variations[0].depth, 4);
        assert_eq!(final_result.variations.len(), 3);
    }
    #[test]
    fn streaming_handles_positions_with_only_one_legal_move() {
        let mut progress = SearchProgress::default();
        assert!(progress.update("start", variation(4, 1)).is_none());
        let first = progress.update("start", variation(5, 1)).unwrap();
        assert_eq!(first.variations[0].depth, 4);
        assert_eq!(first.variations.len(), 1);
        assert_eq!(progress.finish("start").unwrap().variations[0].depth, 5);
    }
    #[test]
    fn score_perspective() {
        let w = parse_info(
            "info depth 12 score cp 42 pv e2e4 e7e5",
            "8/8/8/8/8/8/8/8 w - - 0 1",
        )
        .unwrap();
        assert_eq!(w.score_value, 42);
        let b = parse_info(
            "info depth 12 score cp 42 pv e7e5",
            "8/8/8/8/8/8/8/8 b - - 0 1",
        )
        .unwrap();
        assert_eq!(b.score_value, -42)
    }
    #[test]
    fn mate_perspective() {
        let a = parse_info(
            "info depth 14 score mate -3 pv e7e5",
            "8/8/8/8/8/8/8/8 b - - 0 1",
        )
        .unwrap();
        assert_eq!(a.score_type, "mate");
        assert_eq!(a.score_value, 3)
    }
    #[test]
    fn multipv_keeps_rank_scores_and_best_line() {
        let fen = "8/8/8/8/8/8/8/8 b - - 0 1";
        let lines = [
            "info depth 12 multipv 3 score cp 10 pv c7c5 g1f3",
            "info depth 12 multipv 1 score cp 42 pv e7e5 g1f3",
            "info depth 12 multipv 2 score mate -3 pv e7e6 d2d4",
        ];
        let analysis = Analysis::from_variations(
            fen,
            lines
                .iter()
                .map(|line| parse_info(line, fen).unwrap())
                .collect(),
        )
        .unwrap();
        assert_eq!(
            analysis.variations[0].pv.first().map(String::as_str),
            Some("e7e5")
        );
        assert_eq!(analysis.variations[0].score_value, -42);
        assert_eq!(analysis.variations[0].pv, ["e7e5", "g1f3"]);
        assert_eq!(
            analysis
                .variations
                .iter()
                .map(|v| v.rank)
                .collect::<Vec<_>>(),
            [1, 2, 3]
        );
        assert_eq!(analysis.variations[1].score_type, "mate");
        assert_eq!(analysis.variations[1].score_value, 3);
        assert_eq!(analysis.variations[2].score_value, -10);
        assert!(parse_info("info depth 12 multipv 4 score cp 0 pv d7d5", fen).is_none());
    }
}
#[cfg(test)]
mod native_tests {
    use super::*;
    #[tokio::test]
    async fn native_stockfish_round_trip_and_cancel() {
        let path = std::env::var("STOCKFISH_PATH")
            .unwrap_or_else(|_| "/opt/homebrew/bin/stockfish".into());
        if !std::path::Path::new(&path).exists() {
            return;
        }
        let manager = EngineManager::new();
        let fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let result = analyze(&manager, &path, fen, 4, None, |_| {})
            .await
            .unwrap();
        assert_eq!(result.fen, fen);
        assert!(result.variations[0].depth >= 4);
        assert!(!result.variations[0].pv.is_empty());
        assert_eq!(result.variations.len(), 3);
        let moves: std::collections::HashSet<_> = result
            .variations
            .iter()
            .map(|v| {
                assert_eq!(v.depth, 4);
                v.pv.first().unwrap()
            })
            .collect();
        assert_eq!(moves.len(), 3);
        let pid = manager.session.lock().await.as_ref().unwrap().child.id();
        let started = std::time::Instant::now();
        let mut first_update = None;
        let streamed = analyze(&manager, &path, fen, 14, Some("stream"), |analysis| {
            first_update.get_or_insert((started.elapsed(), analysis.variations[0].depth));
            assert_eq!(analysis.variations.len(), 3);
            assert!(analysis
                .variations
                .iter()
                .all(|v| v.depth == analysis.variations[0].depth));
        })
        .await
        .unwrap();
        let elapsed = started.elapsed();
        let (first_elapsed, first_depth) = first_update.unwrap();
        assert!(first_depth < streamed.variations[0].depth);
        assert!(first_elapsed < elapsed);
        assert_eq!(
            pid,
            manager.session.lock().await.as_ref().unwrap().child.id()
        );
        eprintln!(
            "复用引擎：首次推荐 {:?}（深度 {}），完成 {:?}（深度 {}）",
            first_elapsed, first_depth, elapsed, streamed.variations[0].depth
        );
        let pending = analyze(&manager, &path, fen, 30, Some("current"), |_| {});
        tokio::pin!(pending);
        tokio::select! {
            result = &mut pending => panic!("深度 30 在取消前意外完成: {result:?}"),
            _ = tokio::time::sleep(Duration::from_millis(30)) => {}
        }
        manager.stop(Some("previous"));
        tokio::select! {
            result = &mut pending => panic!("旧请求误停新请求: {result:?}"),
            _ = tokio::time::sleep(Duration::from_millis(30)) => {}
        }
        manager.stop(Some("current"));
        assert!(pending.await.is_err());
        let next_fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
        let next = analyze(&manager, &path, next_fen, 4, None, |_| {})
            .await
            .unwrap();
        assert_eq!(next.fen, next_fen);
        assert_eq!(next.variations.len(), 3);
        assert_eq!(
            pid,
            manager.session.lock().await.as_ref().unwrap().child.id()
        );
        assert!(next
            .variations
            .iter()
            .all(|v| matches!(v.pv[0].as_bytes()[1], b'7' | b'8')));

        // Cancelling a queued request must not stop the active search or start later.
        let active = analyze(&manager, &path, fen, 30, Some("active"), |_| {});
        let queued = analyze(&manager, &path, next_fen, 30, Some("queued"), |_| {
            panic!("取消的排队请求不应启动")
        });
        let cancel = async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            manager.stop(Some("queued"));
            tokio::time::sleep(Duration::from_millis(30)).await;
            manager.stop(Some("active"));
        };
        let (active_result, queued_result, _) = tokio::join!(active, queued, cancel);
        assert_eq!(active_result.unwrap_err(), "分析已取消");
        assert_eq!(queued_result.unwrap_err(), "分析已取消");

        // Recover automatically if an idle process has exited.
        manager
            .session
            .lock()
            .await
            .as_mut()
            .unwrap()
            .child
            .kill()
            .await
            .unwrap();
        let recovered = analyze(&manager, &path, fen, 4, None, |_| {})
            .await
            .unwrap();
        assert_eq!(recovered.variations.len(), 3);
        assert_ne!(
            pid,
            manager.session.lock().await.as_ref().unwrap().child.id()
        );
    }
}

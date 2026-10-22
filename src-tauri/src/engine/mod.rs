use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::os::unix::fs::PermissionsExt;
use std::sync::{Arc, Mutex as StdMutex, Weak};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{watch, Mutex},
    time::{timeout, Duration},
};

pub struct EngineManager {
    session: Arc<Mutex<Option<EngineSession>>>,
    candidates_session: Arc<Mutex<Option<EngineSession>>>,
    searches: StdMutex<HashMap<SearchKey, Weak<SharedSearch>>>,
    jobs: StdMutex<Vec<Weak<AnalysisJob>>>,
}
impl EngineManager {
    pub fn new() -> Self {
        Self {
            session: Arc::new(Mutex::new(None)),
            candidates_session: Arc::new(Mutex::new(None)),
            searches: StdMutex::new(HashMap::new()),
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
pub const MAX_MULTIPV: u32 = 3;
#[cfg(test)]
const BACKGROUND_THREADS: u32 = 4;
#[cfg(test)]
const FOREGROUND_THREADS: u32 = 4;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub struct EngineOptions {
    pub threads: u32,
    pub hash_mb: u32,
}
impl Default for EngineOptions {
    fn default() -> Self {
        Self {
            threads: 4,
            hash_mb: 256,
        }
    }
}
impl EngineOptions {
    pub fn from_settings(threads: Option<&str>, hash_mb: Option<&str>) -> Result<Self, String> {
        let options = Self {
            threads: threads
                .unwrap_or("4")
                .parse()
                .map_err(|_| "Threads须为1～64的整数")?,
            hash_mb: hash_mb
                .unwrap_or("256")
                .parse()
                .map_err(|_| "Hash须为1～4096 MB的整数")?,
        };
        options.validate()?;
        Ok(options)
    }
    fn validate(self) -> Result<(), String> {
        if !(1..=64).contains(&self.threads) {
            return Err("Threads须为1～64的整数".into());
        }
        if !(1..=4096).contains(&self.hash_mb) {
            return Err("Hash须为1～4096 MB的整数".into());
        }
        Ok(())
    }
}

#[derive(Clone, Eq, PartialEq, Hash)]
struct SearchKey {
    path: String,
    modified: Option<std::time::SystemTime>,
    fen: String,
    depth: u32,
    multipv: u32,
    options: EngineOptions,
}
#[derive(Clone, Default)]
struct SharedState {
    latest: Option<Analysis>,
    result: Option<Result<Analysis, String>>,
}
struct SharedSearch {
    state: watch::Sender<SharedState>,
    cancel: watch::Sender<bool>,
    subscribers: StdMutex<usize>,
}
struct Subscription(Arc<SharedSearch>);
impl Drop for Subscription {
    fn drop(&mut self) {
        let mut subscribers = self.0.subscribers.lock().unwrap();
        *subscribers -= 1;
        if *subscribers == 0 {
            self.0.cancel.send_replace(true);
        }
    }
}
impl EngineManager {
    fn subscribe(&self, key: SearchKey, budget: Duration) -> Subscription {
        let mut searches = self.searches.lock().unwrap();
        searches.retain(|_, search| search.strong_count() > 0);
        if let Some(shared) = searches.get(&key).and_then(Weak::upgrade) {
            let mut count = shared.subscribers.lock().unwrap();
            if !*shared.cancel.borrow() && !matches!(shared.state.borrow().result, Some(Err(_))) {
                *count += 1;
                drop(count);
                return Subscription(shared);
            }
        }
        let (state, _) = watch::channel(SharedState::default());
        let (cancel, cancelled) = watch::channel(false);
        let shared = Arc::new(SharedSearch {
            state,
            cancel,
            subscribers: StdMutex::new(1),
        });
        searches.insert(key.clone(), Arc::downgrade(&shared));
        let worker = shared.clone();
        let lane = if key.multipv == 1 {
            self.session.clone()
        } else {
            self.candidates_session.clone()
        };
        tokio::spawn(async move {
            let result = run_search(lane, &key, cancelled, budget, |analysis| {
                worker
                    .state
                    .send_modify(|state| state.latest = Some(analysis));
            })
            .await;
            worker
                .state
                .send_modify(|state| state.result = Some(result));
        });
        Subscription(shared)
    }
}

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
    if !(1..=MAX_MULTIPV).contains(&multipv) {
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
struct SearchProgress {
    multipv: u32,
    depth: u32,
    variations: BTreeMap<u32, Variation>,
    completed: Option<Analysis>,
}
impl Default for SearchProgress {
    fn default() -> Self {
        Self::new(MAX_MULTIPV)
    }
}
impl SearchProgress {
    fn new(multipv: u32) -> Self {
        Self {
            multipv,
            depth: 0,
            variations: BTreeMap::new(),
            completed: None,
        }
    }
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
        if self.variations.len() == self.multipv as usize {
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
    threads: u32,
    hash_mb: u32,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
}
impl EngineSession {
    async fn start(
        path: &str,
        modified: Option<std::time::SystemTime>,
        options: EngineOptions,
    ) -> Result<Self, String> {
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
            threads: options.threads,
            hash_mb: options.hash_mb,
            stdin,
            lines: BufReader::new(stdout).lines(),
        };
        session.send("uci\n").await?;
        session.read_until("uciok").await?;
        let EngineOptions { threads, hash_mb } = options;
        session
            .send(&format!("setoption name Threads value {threads}\nsetoption name Hash value {hash_mb}\nsetoption name MultiPV value 1\nisready\n"))
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
        multipv: u32,
        mut on_update: impl FnMut(Analysis),
    ) -> Result<Analysis, String> {
        self.send(&format!(
            "setoption name MultiPV value {multipv}\nposition fen {fen}\ngo depth {}\n",
            depth.clamp(4, 30)
        ))
        .await?;
        let mut progress = SearchProgress::new(multipv);
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

#[cfg(test)]
pub async fn analyze(
    manager: &EngineManager,
    path: &str,
    fen: &str,
    depth: u32,
    multipv: u32,
    request_id: Option<&str>,
    on_update: impl FnMut(Analysis),
) -> Result<Analysis, String> {
    analyze_with_options(
        manager,
        path,
        fen,
        depth,
        multipv,
        EngineOptions::default(),
        request_id,
        on_update,
    )
    .await
}
pub async fn analyze_with_options(
    manager: &EngineManager,
    path: &str,
    fen: &str,
    depth: u32,
    multipv: u32,
    options: EngineOptions,
    request_id: Option<&str>,
    on_update: impl FnMut(Analysis),
) -> Result<Analysis, String> {
    analyze_with_budget(
        manager,
        path,
        fen,
        depth,
        multipv,
        options,
        request_id,
        SEARCH_TIMEOUT,
        on_update,
    )
    .await
}
async fn analyze_with_budget(
    manager: &EngineManager,
    path: &str,
    fen: &str,
    depth: u32,
    multipv: u32,
    options: EngineOptions,
    request_id: Option<&str>,
    budget: Duration,
    mut on_update: impl FnMut(Analysis),
) -> Result<Analysis, String> {
    validate(path)?;
    options.validate()?;
    if !(1..=MAX_MULTIPV).contains(&multipv) {
        return Err("MultiPV必须介于1和3之间".into());
    }
    let job = manager.register(request_id);
    let mut cancelled = job.cancel.subscribe();
    let subscription = manager.subscribe(
        SearchKey {
            path: path.into(),
            modified: std::fs::metadata(path).and_then(|m| m.modified()).ok(),
            fen: fen.into(),
            depth: depth.clamp(4, 30),
            multipv,
            options,
        },
        budget,
    );
    let mut state = subscription.0.state.subscribe();
    let mut reported_depth = 0;
    loop {
        let snapshot = state.borrow_and_update().clone();
        if let Some(analysis) = snapshot.latest {
            if analysis.variations[0].depth > reported_depth {
                reported_depth = analysis.variations[0].depth;
                on_update(analysis);
            }
        }
        if *cancelled.borrow() {
            return Err("分析已取消".into());
        }
        if let Some(result) = snapshot.result {
            return result;
        }
        tokio::select! {
            biased;
            _ = cancelled.changed() => {},
            changed = state.changed() => { changed.map_err(|_| "引擎任务提前退出".to_string())?; },
        }
    }
}
async fn run_search(
    lane: Arc<Mutex<Option<EngineSession>>>,
    key: &SearchKey,
    mut cancelled: watch::Receiver<bool>,
    budget: Duration,
    on_update: impl FnMut(Analysis),
) -> Result<Analysis, String> {
    let mut session = tokio::select! {
        biased;
        _ = cancelled.changed() => return Err("分析已取消".into()),
        session = lane.lock() => session,
    };
    if *cancelled.borrow() {
        return Err("分析已取消".into());
    }
    let EngineOptions { threads, hash_mb } = key.options;
    let reusable = session.as_mut().is_some_and(|s| {
        s.path == key.path
            && s.modified == key.modified
            && s.threads == threads
            && s.hash_mb == hash_mb
            && matches!(s.child.try_wait(), Ok(None))
    });
    if !reusable {
        *session = None;
        let started = tokio::select! {
            biased;
            _ = cancelled.changed() => return Err("分析已取消".into()),
            result = timeout(Duration::from_secs(10), EngineSession::start(&key.path, key.modified, key.options)) => result.map_err(|_| "引擎启动超时".to_string())?,
        };
        *session = Some(started?);
    }
    let engine = session.as_mut().unwrap();
    // Cancellation and timeout stop cleanly, retaining the process and its hash.
    let interrupted = tokio::select! {
        biased;
        _ = cancelled.changed() => "分析已取消",
        result = timeout(budget, engine.search(&key.fen, key.depth, key.multipv, on_update)) => {
            match result {
                Ok(result) => {
                    if result.is_err() { *session = None; }
                    return result;
                }
                Err(_) => "引擎分析超时",
            }
        },
    };
    let stopped = timeout(Duration::from_secs(2), engine.stop()).await;
    if !matches!(stopped, Ok(Ok(()))) {
        *session = None;
    }
    Err(interrupted.into())
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
    fn single_pv_streams_without_waiting_for_other_ranks() {
        let mut progress = SearchProgress::new(1);
        let first = progress.update("start", variation(4, 1)).unwrap();
        assert_eq!(first.variations.len(), 1);
        assert_eq!(first.variations[0].depth, 4);
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
        let result = analyze(&manager, &path, fen, 4, 1, None, |_| {})
            .await
            .unwrap();
        assert_eq!(result.fen, fen);
        assert!(result.variations[0].depth >= 4);
        assert!(!result.variations[0].pv.is_empty());
        assert_eq!(result.variations.len(), 1);
        let moves: std::collections::HashSet<_> = result
            .variations
            .iter()
            .map(|v| {
                assert_eq!(v.depth, 4);
                v.pv.first().unwrap()
            })
            .collect();
        assert_eq!(moves.len(), 1);
        let pid = manager.session.lock().await.as_ref().unwrap().child.id();
        assert_eq!(
            manager.session.lock().await.as_ref().unwrap().threads,
            BACKGROUND_THREADS
        );
        let started = std::time::Instant::now();
        let mut first_update = None;
        let streamed = analyze(&manager, &path, fen, 14, 1, Some("stream"), |analysis| {
            first_update.get_or_insert((started.elapsed(), analysis.variations[0].depth));
            assert_eq!(analysis.variations.len(), 1);
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
        let pending = analyze(&manager, &path, fen, 30, 1, Some("current"), |_| {});
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
        let next = analyze(&manager, &path, next_fen, 4, 1, None, |_| {})
            .await
            .unwrap();
        assert_eq!(next.fen, next_fen);
        assert_eq!(next.variations.len(), 1);
        assert_eq!(
            pid,
            manager.session.lock().await.as_ref().unwrap().child.id()
        );
        assert!(next
            .variations
            .iter()
            .all(|v| matches!(v.pv[0].as_bytes()[1], b'7' | b'8')));

        // Cancelling a queued request must not stop the active search or start later.
        let active = analyze(&manager, &path, fen, 30, 1, Some("active"), |_| {});
        let queued = analyze(&manager, &path, next_fen, 30, 1, Some("queued"), |_| {
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

        // The selected position must finish even while the single-PV lane is busy.
        let background = analyze(&manager, &path, fen, 30, 1, Some("background"), |_| {});
        tokio::pin!(background);
        tokio::select! {
            result = &mut background => panic!("Background finished too soon: {result:?}"),
            _ = tokio::time::sleep(Duration::from_millis(30)) => {}
        }
        let detailed = tokio::select! {
            result = &mut background => panic!("Foreground waited for background: {result:?}"),
            result = analyze(&manager, &path, next_fen, 4, 3, Some("selected"), |_| {}) => result.unwrap(),
        };
        assert_eq!(detailed.variations.len(), 3);
        assert_eq!(
            manager
                .candidates_session
                .lock()
                .await
                .as_ref()
                .unwrap()
                .threads,
            FOREGROUND_THREADS
        );
        assert_ne!(
            pid,
            manager
                .candidates_session
                .lock()
                .await
                .as_ref()
                .unwrap()
                .child
                .id()
        );
        manager.stop(Some("background"));
        assert_eq!(background.await.unwrap_err(), "分析已取消");

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
        let recovered = analyze(&manager, &path, fen, 4, 1, None, |_| {})
            .await
            .unwrap();
        assert_eq!(recovered.variations.len(), 1);
        assert_ne!(
            pid,
            manager.session.lock().await.as_ref().unwrap().child.id()
        );
    }
}

#[cfg(test)]
mod sharing_tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    struct FakeEngine {
        path: std::path::PathBuf,
        log: std::path::PathBuf,
    }
    impl FakeEngine {
        fn new() -> Self {
            let id = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("chess-uci-{id}.py"));
            let log = path.with_extension("log");
            let script = r#"#!/usr/bin/env python3
import sys,threading,time
log=__LOG__
generation=0
active=False
multipv=1

def emit(depth):
    for rank in range(1,multipv+1):
        print(f'info depth {depth} multipv {rank} score cp 20 pv e2e4 e7e5',flush=True)

for raw in sys.stdin:
    line=raw.strip()
    with open(log,'a') as f: f.write(line+'\n')
    if line=='uci': print('uciok',flush=True)
    elif line=='isready': print('readyok',flush=True)
    elif line.startswith('setoption name MultiPV'): multipv=int(line.split()[-1])
    elif line.startswith('go depth'):
        generation+=1
        active=True
        depth=int(line.split()[-1])
        emit(4)
        if depth>=8: emit(8)
        if depth<=8:
            active=False
            print('bestmove e2e4',flush=True)
        elif depth<30:
            def finish(g=generation,d=depth):
                global active
                time.sleep(.2)
                if generation==g and active:
                    emit(d)
                    active=False
                    print('bestmove e2e4',flush=True)
            threading.Thread(target=finish,daemon=True).start()
    elif line=='stop':
        generation+=1
        if active:
            active=False
            print('bestmove e2e4',flush=True)
    elif line=='quit': break
"#
            .replace(
                "__LOG__",
                &serde_json::to_string(&log.to_string_lossy()).unwrap(),
            );
            std::fs::write(&path, script).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
            Self { path, log }
        }
        fn commands(&self) -> Vec<String> {
            std::fs::read_to_string(&self.log)
                .unwrap_or_default()
                .lines()
                .map(str::to_owned)
                .collect()
        }
        fn path(&self) -> &str {
            self.path.to_str().unwrap()
        }
    }
    impl Drop for FakeEngine {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
            let _ = std::fs::remove_file(&self.log);
        }
    }
    async fn wait_for(flag: &AtomicBool) {
        timeout(Duration::from_secs(5), async {
            while !flag.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
    }
    #[test]
    fn resource_settings_validate_and_default() {
        assert_eq!(
            EngineOptions::from_settings(None, None).unwrap(),
            EngineOptions::default()
        );
        assert_eq!(
            EngineOptions::from_settings(Some("3"), Some("64")).unwrap(),
            EngineOptions {
                threads: 3,
                hash_mb: 64
            }
        );
        for value in ["", "0", "65", "1.5", "bad"] {
            assert!(EngineOptions::from_settings(Some(value), None).is_err());
        }
        for value in ["", "0", "4097", "2.5", "bad"] {
            assert!(EngineOptions::from_settings(None, Some(value)).is_err());
        }
    }
    #[tokio::test]
    async fn requests_with_different_resources_are_not_merged() {
        let engine = FakeEngine::new();
        let manager = EngineManager::new();
        let first = analyze_with_options(
            &manager,
            engine.path(),
            "same",
            4,
            1,
            EngineOptions {
                threads: 2,
                hash_mb: 32,
            },
            None,
            |_| {},
        );
        let second = analyze_with_options(
            &manager,
            engine.path(),
            "same",
            4,
            1,
            EngineOptions {
                threads: 3,
                hash_mb: 64,
            },
            None,
            |_| {},
        );
        let (first, second) = tokio::join!(first, second);
        first.unwrap();
        second.unwrap();
        assert_eq!(
            engine
                .commands()
                .iter()
                .filter(|c| c.starts_with("go "))
                .count(),
            2
        );
    }
    #[tokio::test]
    async fn configured_resources_reach_uci_and_restart_only_when_changed() {
        let engine = FakeEngine::new();
        let manager = EngineManager::new();
        let first = EngineOptions {
            threads: 2,
            hash_mb: 32,
        };
        analyze_with_options(&manager, engine.path(), "first", 4, 1, first, None, |_| {})
            .await
            .unwrap();
        let pid = manager.session.lock().await.as_ref().unwrap().child.id();
        analyze_with_options(&manager, engine.path(), "second", 4, 1, first, None, |_| {})
            .await
            .unwrap();
        assert_eq!(
            pid,
            manager.session.lock().await.as_ref().unwrap().child.id()
        );
        let hash_changed = EngineOptions {
            threads: 2,
            hash_mb: 64,
        };
        analyze_with_options(
            &manager,
            engine.path(),
            "hash changed",
            4,
            1,
            hash_changed,
            None,
            |_| {},
        )
        .await
        .unwrap();
        let hash_pid = manager.session.lock().await.as_ref().unwrap().child.id();
        assert_ne!(pid, hash_pid);
        let changed = EngineOptions {
            threads: 3,
            hash_mb: 64,
        };
        analyze_with_options(
            &manager,
            engine.path(),
            "third",
            4,
            1,
            changed,
            None,
            |_| {},
        )
        .await
        .unwrap();
        assert_ne!(
            hash_pid,
            manager.session.lock().await.as_ref().unwrap().child.id()
        );
        analyze_with_options(
            &manager,
            engine.path(),
            "fourth",
            4,
            3,
            changed,
            None,
            |_| {},
        )
        .await
        .unwrap();
        let commands = engine.commands();
        for command in [
            "setoption name Threads value 2",
            "setoption name Hash value 32",
            "setoption name Threads value 3",
            "setoption name Hash value 64",
        ] {
            assert!(commands.contains(&command.to_string()), "missing {command}");
        }
        assert_eq!(commands.iter().filter(|c| c.as_str() == "uci").count(), 4);
    }
    #[tokio::test]
    async fn duplicate_requests_share_one_search_and_cancel_independently() {
        let engine = FakeEngine::new();
        let manager = EngineManager::new();
        let first_seen = AtomicBool::new(false);
        let second_seen = AtomicBool::new(false);
        let first = analyze(
            &manager,
            engine.path(),
            "same",
            12,
            1,
            Some("first"),
            |_| {
                first_seen.store(true, Ordering::SeqCst);
            },
        );
        let second = analyze(
            &manager,
            engine.path(),
            "same",
            12,
            1,
            Some("second"),
            |_| {
                second_seen.store(true, Ordering::SeqCst);
            },
        );
        let cancel = async {
            wait_for(&first_seen).await;
            wait_for(&second_seen).await;
            manager.stop(Some("first"));
        };
        let (first, second, _) = tokio::join!(first, second, cancel);
        assert_eq!(first.unwrap_err(), "分析已取消");
        assert_eq!(second.unwrap().variations[0].depth, 12);
        assert_eq!(
            engine
                .commands()
                .iter()
                .filter(|s| s.starts_with("go "))
                .count(),
            1
        );
        assert!(!engine.commands().iter().any(|s| s == "stop"));
        assert!(engine
            .commands()
            .contains(&"setoption name Threads value 4".to_string()));
    }
    #[tokio::test]
    async fn timeout_preserves_checkpoint_and_engine_process_for_retry() {
        let engine = FakeEngine::new();
        let manager = EngineManager::new();
        let db = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrations::migrate(&db).unwrap();
        let result = analyze_with_budget(
            &manager,
            engine.path(),
            "partial",
            30,
            1,
            EngineOptions::default(),
            Some("timeout"),
            Duration::from_millis(300),
            |a| {
                crate::db::repository::engine_cache_save(&db, engine.path(), "v1", 1, &a).unwrap();
            },
        )
        .await;
        assert_eq!(result.unwrap_err(), "引擎分析超时");
        let pid = manager.session.lock().await.as_ref().unwrap().child.id();
        let partial =
            crate::db::repository::engine_cache_get(&db, "partial", engine.path(), "v1", 4, 1)
                .unwrap()
                .unwrap();
        assert_eq!(partial.variations[0].depth, 8);
        assert!(crate::db::repository::engine_cache_get(
            &db,
            "partial",
            engine.path(),
            "v1",
            22,
            1
        )
        .unwrap()
        .is_none());
        analyze(&manager, engine.path(), "next", 4, 1, None, |_| {})
            .await
            .unwrap();
        assert_eq!(
            pid,
            manager.session.lock().await.as_ref().unwrap().child.id()
        );
        assert_eq!(engine.commands().iter().filter(|s| *s == "uci").count(), 1);
        assert_eq!(engine.commands().iter().filter(|s| *s == "stop").count(), 1);
    }
    #[tokio::test]
    async fn dropping_last_subscriber_stops_search_and_keeps_checkpoint() {
        let engine = FakeEngine::new();
        let manager = EngineManager::new();
        let seen = AtomicBool::new(false);
        let mut latest = None;
        {
            let pending = analyze(
                &manager,
                engine.path(),
                "cancelled",
                30,
                3,
                Some("dropped"),
                |a| {
                    if a.variations[0].depth >= 8 {
                        seen.store(true, Ordering::SeqCst);
                    }
                    latest = Some(a);
                },
            );
            tokio::pin!(pending);
            tokio::select! { result=&mut pending => panic!("Unexpected completion: {result:?}"), _=wait_for(&seen) => {} }
        }
        assert_eq!(latest.unwrap().variations[0].depth, 8);
        analyze(&manager, engine.path(), "next", 4, 3, None, |_| {})
            .await
            .unwrap();
        assert_eq!(engine.commands().iter().filter(|s| *s == "stop").count(), 1);
        assert_eq!(engine.commands().iter().filter(|s| *s == "uci").count(), 1);
        assert!(engine
            .commands()
            .contains(&"setoption name Threads value 4".to_string()));
    }
    #[tokio::test]
    async fn different_depths_and_multipv_are_not_merged() {
        let engine = FakeEngine::new();
        let manager = EngineManager::new();
        let one = analyze(&manager, engine.path(), "same", 4, 1, Some("one"), |_| {});
        let deeper = analyze(
            &manager,
            engine.path(),
            "same",
            8,
            1,
            Some("deeper"),
            |_| {},
        );
        let three = analyze(&manager, engine.path(), "same", 4, 3, Some("three"), |_| {});
        let (one, deeper, three) = tokio::join!(one, deeper, three);
        assert_eq!(one.unwrap().variations.len(), 1);
        assert_eq!(deeper.unwrap().variations[0].depth, 8);
        assert_eq!(three.unwrap().variations.len(), 3);
        assert_eq!(
            engine
                .commands()
                .iter()
                .filter(|s| s.starts_with("go "))
                .count(),
            3
        );
    }
}

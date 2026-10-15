use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::watch,
    time::{timeout, Duration},
};

#[derive(Clone)]
pub struct EngineManager {
    cancel: watch::Sender<u64>,
}
impl EngineManager {
    pub fn new() -> Self {
        let (cancel, _) = watch::channel(0);
        Self { cancel }
    }
    pub fn stop(&self) {
        let next = *self.cancel.borrow() + 1;
        let _ = self.cancel.send(next);
    }
    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.cancel.subscribe()
    }
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
    pub depth: u32,
    pub score_type: String,
    pub score_value: i32,
    pub best_move: Option<String>,
    pub pv: Vec<String>,
    pub variations: Vec<Variation>,
}
impl Analysis {
    pub fn from_variations(fen: &str, mut variations: Vec<Variation>) -> Option<Self> {
        variations.sort_by_key(|v| v.rank);
        let best = variations.first().filter(|v| v.rank == 1)?;
        Some(Self {
            fen: fen.into(),
            depth: best.depth,
            score_type: best.score_type.clone(),
            score_value: best.score_value,
            best_move: best.pv.first().cloned(),
            pv: best.pv.clone(),
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
pub async fn analyze(
    manager: &EngineManager,
    path: &str,
    fen: &str,
    depth: u32,
) -> Result<Analysis, String> {
    validate(path)?;
    let mut rx = manager.subscribe();
    let mut child = Command::new(path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().ok_or("引擎 stdin 不可用")?;
    let stdout = child.stdout.take().ok_or("引擎 stdout 不可用")?;
    let mut lines = BufReader::new(stdout).lines();
    let task = async {
        stdin.write_all(b"uci\n").await.map_err(|e| e.to_string())?;
        loop {
            let line = lines
                .next_line()
                .await
                .map_err(|e| e.to_string())?
                .ok_or("引擎提前退出")?;
            if line == "uciok" {
                break;
            }
        }
        stdin
            .write_all(b"isready\n")
            .await
            .map_err(|e| e.to_string())?;
        loop {
            let line = lines
                .next_line()
                .await
                .map_err(|e| e.to_string())?
                .ok_or("引擎提前退出")?;
            if line == "readyok" {
                break;
            }
        }
        stdin
            .write_all(
                format!(
                    "setoption name MultiPV value {MULTIPV}\nposition fen {fen}\ngo depth {}\n",
                    depth.clamp(4, 30)
                )
                .as_bytes(),
            )
            .await
            .map_err(|e| e.to_string())?;
        let mut variations = BTreeMap::new();
        loop {
            tokio::select! {
                changed = rx.changed() => {
                    if changed.is_ok() {
                        return Err("分析已取消".into());
                    }
                }
                line = lines.next_line() => {
                    let line = line.map_err(|e| e.to_string())?.ok_or("引擎提前退出")?;
                    if let Some(variation) = parse_info(&line, fen) {
                        variations.insert(variation.rank, variation);
                    }
                    if line.starts_with("bestmove ") {
                        return Analysis::from_variations(fen, variations.into_values().collect())
                            .ok_or_else(|| "引擎未返回评价".into());
                    }
                }
            }
        }
    };
    let result = timeout(Duration::from_secs(45), task)
        .await
        .map_err(|_| "引擎分析超时".to_string())?;
    let _ = stdin.write_all(b"quit\n").await;
    let _ = child.kill().await;
    result
}
#[cfg(test)]
mod tests {
    use super::*;
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
        assert_eq!(analysis.best_move.as_deref(), Some("e7e5"));
        assert_eq!(analysis.score_value, -42);
        assert_eq!(analysis.pv, ["e7e5", "g1f3"]);
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
        let result = analyze(&manager, &path, fen, 4).await.unwrap();
        assert_eq!(result.fen, fen);
        assert!(result.depth >= 4);
        assert!(result.best_move.is_some());
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
        let pending = analyze(&manager, &path, fen, 30);
        tokio::pin!(pending);
        tokio::select! {
            result = &mut pending => panic!("深度 30 在取消前意外完成: {result:?}"),
            _ = tokio::time::sleep(Duration::from_millis(30)) => {}
        }
        manager.stop();
        assert!(pending.await.is_err());
    }
}

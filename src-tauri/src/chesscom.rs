use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::{sync::LazyLock, time::Duration};

pub(crate) fn valid_username(value: &str) -> bool {
    (1..=100).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
pub(crate) fn game_id(value: &str) -> Option<String> {
    let url = reqwest::Url::parse(value).ok()?;
    if !matches!(url.host_str(), Some("chess.com" | "www.chess.com"))
        || !matches!(url.scheme(), "http" | "https")
    {
        return None;
    }
    let path: Vec<_> = url.path().trim_matches('/').split('/').collect();
    let (kind, id) = match path.as_slice() {
        ["game", kind @ ("live" | "daily"), id] | [kind @ ("live" | "daily"), "game", id] => {
            (*kind, *id)
        }
        _ => return None,
    };
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(format!("{kind}:{id}"))
}
pub(crate) fn pgn_game_id(pgn: &str) -> Option<String> {
    pgn.lines()
        .take_while(|line| !line.trim().is_empty())
        .find_map(|line| {
            let line = line.trim();
            line.strip_prefix("[Link \"")
                .or_else(|| line.strip_prefix("[Site \""))
                .and_then(|value| value.strip_suffix("\"]"))
                .and_then(game_id)
        })
}

fn client() -> Result<Client, String> {
    static CLIENT: LazyLock<Result<Client, String>> = LazyLock::new(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(45))
            .user_agent("ChessTrainer (https://github.com/yansq/chess-trainer)")
            .build()
            .map_err(|e| e.to_string())
    });
    CLIENT.clone()
}
async fn request(path: &str) -> Result<serde_json::Value, String> {
    for attempt in 0..3 {
        let response = client()?
            .get(format!("https://api.chess.com/pub/player/{path}"))
            .send()
            .await;
        match response {
            Ok(response) => {
                let status = response.status();
                if status == StatusCode::NOT_FOUND {
                    return Err("未找到 Chess.com 账号或对局归档，请检查用户名".into());
                }
                if status == StatusCode::TOO_MANY_REQUESTS {
                    return Err("Chess.com 请求限流，请稍后继续同步".into());
                }
                if !status.is_server_error() {
                    if !status.is_success() {
                        return Err(format!("Chess.com HTTP {status}"));
                    }
                    let text = response
                        .text()
                        .await
                        .map_err(|e| format!("Chess.com 响应读取失败：{e}"))?;
                    return serde_json::from_str(&text)
                        .map_err(|e| format!("Chess.com 响应格式无效：{e}"));
                }
            }
            Err(_) => {}
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
        }
    }
    Err("Chess.com 网络连接失败，请检查网络后继续同步".into())
}
pub async fn test_connection(username: &str) -> Result<(), String> {
    if !valid_username(username) {
        return Err("Chess.com 用户名格式无效".into());
    }
    let profile = request(username).await?;
    if !profile["player_id"].is_number() {
        return Err("Chess.com 账号响应无效".into());
    }
    Ok(())
}
pub(crate) fn valid_month(month: &str) -> bool {
    month.len() == 7
        && month.as_bytes()[4] == b'/'
        && month[..4].bytes().all(|b| b.is_ascii_digit())
        && month[5..].bytes().all(|b| b.is_ascii_digit())
        && month[..4]
            .parse::<u32>()
            .is_ok_and(|n| (1900..=9999).contains(&n))
        && month[5..]
            .parse::<u32>()
            .is_ok_and(|n| (1..=12).contains(&n))
}
fn parse_archives(value: serde_json::Value, username: &str) -> Result<Vec<String>, String> {
    let archives = value["archives"]
        .as_array()
        .ok_or("Chess.com 归档列表无效")?;
    let prefix = format!("/pub/player/{}/games/", username.to_ascii_lowercase());
    let mut months = Vec::new();
    for item in archives {
        let url = reqwest::Url::parse(item.as_str().ok_or("Chess.com 归档地址无效")?)
            .map_err(|_| "Chess.com 归档地址无效")?;
        let path = url.path().to_ascii_lowercase();
        let month = path
            .strip_prefix(&prefix)
            .ok_or("Chess.com 归档账号不一致")?;
        if url.scheme() != "https" || url.host_str() != Some("api.chess.com") || !valid_month(month)
        {
            return Err("Chess.com 归档地址无效".into());
        }
        months.push(month.to_owned());
    }
    months.sort();
    months.dedup();
    Ok(months)
}
pub async fn archives(username: &str) -> Result<Vec<String>, String> {
    if !valid_username(username) {
        return Err("Chess.com 用户名格式无效".into());
    }
    parse_archives(
        request(&format!("{username}/games/archives")).await?,
        username,
    )
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Player {
    pub username: String,
    pub result: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Game {
    pub url: String,
    #[serde(default)]
    pub pgn: String,
    pub rules: String,
    pub time_class: String,
    pub time_control: String,
    pub end_time: i64,
    pub rated: bool,
    pub white: Player,
    pub black: Player,
}
pub async fn month(username: &str, month: &str) -> Result<Vec<Game>, String> {
    if !valid_username(username) || !valid_month(month) {
        return Err("Chess.com 账号或月份格式无效".into());
    }
    let value = request(&format!("{username}/games/{month}")).await?;
    serde_json::from_value(value["games"].clone())
        .map_err(|e| format!("Chess.com 对局响应无效：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_actual_public_game_schema_and_identity() {
        let game: Game = serde_json::from_str(include_str!(
            "../../tests/fixtures/games/chesscom-public-game.json"
        ))
        .unwrap();
        assert_eq!(game.rules, "chess");
        assert_eq!(game.black.username, "Hikaru");
        assert_eq!(game_id(&game.url).as_deref(), Some("live:132168079769"));
        assert_eq!(pgn_game_id(&game.pgn), game_id(&game.url));
    }
    #[test]
    fn validates_months_and_archive_origin() {
        for value in [
            "2026/00",
            "2026/13",
            "2026/1",
            "2026/12/extra",
            "../../x",
            "😀/12",
        ] {
            assert!(!valid_month(value));
        }
        assert!(valid_month("2026/12"));
        let good = serde_json::json!({"archives":["https://api.chess.com/pub/player/Trainer/games/2026/02","https://api.chess.com/pub/player/trainer/games/2026/01"]});
        assert_eq!(
            parse_archives(good, "TRAINER").unwrap(),
            vec!["2026/01", "2026/02"]
        );
        for url in [
            "https://evil.test/pub/player/trainer/games/2026/01",
            "https://api.chess.com/pub/player/other/games/2026/01",
        ] {
            assert!(parse_archives(serde_json::json!({"archives":[url]}), "trainer").is_err());
        }
    }
}

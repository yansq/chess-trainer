pub mod credentials;
use reqwest::{header, Client, RequestBuilder, StatusCode};
use std::sync::LazyLock;
use std::time::Duration;

pub(crate) fn valid_username(username: &str) -> bool {
    let n = username.len();
    (2..=30).contains(&n)
        && username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
fn client() -> Result<Client, String> {
    static CLIENT: LazyLock<Result<Client, String>> = LazyLock::new(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent("ChessTrainer/0.1 personal desktop app")
            .build()
            .map_err(|e| e.to_string())
    });
    CLIENT.clone()
}
async fn export_text(request: RequestBuilder, username: &str) -> Result<String, String> {
    for attempt in 0..3 {
        let req = request.try_clone().ok_or("无法重试 Lichess 请求")?;
        match req.send().await {
            Ok(res) => {
                if !res.status().is_server_error() || attempt == 2 {
                    // Rate limiting is reported immediately; don't amplify it with retries.
                    check_status(res.status(), username)?;
                    if let Ok(text) = res.text().await {
                        return Ok(text);
                    }
                }
            }
            Err(_) => {}
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
        }
    }
    Err("Lichess 网络连接中断，请检查网络后继续同步".into())
}
fn check_status(status: StatusCode, username: &str) -> Result<(), String> {
    match status {
        StatusCode::NOT_FOUND => Err(format!(
            "未找到 Lichess 用户「{}」（HTTP 404），请核对个人主页中的用户名",
            username
        )),
        StatusCode::TOO_MANY_REQUESTS => Err("Lichess API 限流，请稍后重试".into()),
        _ if status.is_success() => Ok(()),
        _ => Err(format!("Lichess HTTP {}", status)),
    }
}
pub async fn test_connection(username: &str, token: Option<&str>) -> Result<(), String> {
    if !valid_username(username) {
        return Err("Lichess 用户名格式无效".into());
    }
    let client = client()?;
    let url = format!("https://lichess.org/api/user/{}", username);
    let mut req = client.get(url).header(header::ACCEPT, "application/json");
    if let Some(t) = token {
        req = req.bearer_auth(t)
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    check_status(res.status(), username)
}
pub const SYNC_BATCH_SIZE: usize = 100;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportGame {
    pub id: String,
    pub created_at: i64,
    pub pgn: String,
    pub status: String,
}
fn parse_export_batch(text: &str) -> Result<Vec<ExportGame>, String> {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).map_err(|e| format!("Lichess 对局响应无效：{e}")))
        .collect()
}

pub async fn export_batch(
    username: &str,
    since: Option<i64>,
    until: i64,
    token: Option<&str>,
) -> Result<Vec<ExportGame>, String> {
    if !valid_username(username) {
        return Err("Lichess 用户名格式无效".into());
    }
    let client = client()?;
    let url = format!("https://lichess.org/api/games/user/{}", username);
    let mut req = client
        .get(url)
        .header(header::ACCEPT, "application/x-ndjson")
        .query(&[
            ("max", SYNC_BATCH_SIZE.to_string()),
            ("until", until.to_string()),
            ("pgnInJson", "true".into()),
            ("opening", "true".into()),
            ("tags", "true".into()),
            ("moves", "true".into()),
            ("ongoing", "true".into()),
            ("finished", "true".into()),
            // Avoid search-backed filters: that endpoint orders by last move,
            // while time bounds use creation time, which can skip older games.
            ("sort", "dateDesc".into()),
        ]);
    if let Some(ms) = since {
        req = req.query(&[("since", ms.to_string())]);
    }
    if let Some(t) = token {
        req = req.bearer_auth(t)
    }
    parse_export_batch(&export_text(req, username).await?)
}

pub async fn refresh_games(ids: Vec<String>) -> Result<Vec<ExportGame>, String> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    if ids.len() > SYNC_BATCH_SIZE
        || ids
            .iter()
            .any(|id| id.len() != 8 || !id.chars().all(|c| c.is_ascii_alphanumeric()))
    {
        return Err("待检查的对局 ID 无效".into());
    }
    let req = client()?
        .post("https://lichess.org/api/games/export/_ids")
        .header(header::ACCEPT, "application/x-ndjson")
        .header(header::CONTENT_TYPE, "text/plain")
        .query(&[
            ("pgnInJson", "true"),
            ("opening", "true"),
            ("tags", "true"),
            ("moves", "true"),
        ])
        .body(ids.join(","));
    parse_export_batch(&export_text(req, "").await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn http_server(statuses: Vec<&'static str>) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            for status in statuses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut buffer = [0; 4096];
                stream.read(&mut buffer).unwrap();
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
                )
                .unwrap();
            }
        });
        (url, thread)
    }
    #[tokio::test]
    async fn retries_temporary_server_errors() {
        let (url, server) = http_server(vec!["503 Service Unavailable", "200 OK"]);
        let client = Client::builder().no_proxy().build().unwrap();
        assert_eq!(export_text(client.get(url), "Trainer").await.unwrap(), "ok");
        server.join().unwrap();
    }
    #[tokio::test]
    async fn rate_limit_does_not_trigger_immediate_retries() {
        let (url, server) = http_server(vec!["429 Too Many Requests"]);
        let client = Client::builder().no_proxy().build().unwrap();
        let started = std::time::Instant::now();
        assert!(export_text(client.get(url), "Trainer")
            .await
            .unwrap_err()
            .contains("限流"));
        assert!(started.elapsed() < Duration::from_secs(1));
        server.join().unwrap();
    }
    #[test]
    fn ndjson_handles_keepalives_but_rejects_incomplete_records() {
        let games = parse_export_batch("\n{\"id\":\"abcdefgh\",\"createdAt\":1700000000123,\"status\":\"mate\",\"pgn\":\"[Event \\\"Game\\\"]\\n\\n1. e4\"}\r\n\n").unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].created_at, 1700000000123);
        assert!(games[0].pgn.contains("[Event"));
        assert!(parse_export_batch("{\"id\":\"broken\"}").is_err());
        assert!(parse_export_batch("truncated").is_err());
        assert!(parse_export_batch("\n\n").unwrap().is_empty());
    }
}

//! Headless verification bridge that serves Tauri commands over loopback HTTP
//! against an isolated SQLite database without launching the native window.
#[path = "../src/chesscom.rs"]
mod chesscom;
#[path = "../src/commands/mod.rs"]
mod commands;
#[path = "../src/db/mod.rs"]
mod db;
#[path = "../src/engine/mod.rs"]
mod engine;
#[path = "../src/lichess/mod.rs"]
mod lichess;

use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::Manager;

fn arg<T: DeserializeOwned>(args: &Value, camel: &str, snake: &str) -> Result<T, String> {
    let value = args
        .get(camel)
        .or_else(|| args.get(snake))
        .cloned()
        .unwrap_or(Value::Null);
    serde_json::from_value(value).map_err(|e| format!("参数 {camel} 解析失败: {e}"))
}

fn opt_arg<T: DeserializeOwned>(
    args: &Value,
    camel: &str,
    snake: &str,
) -> Result<Option<T>, String> {
    match args.get(camel).or_else(|| args.get(snake)) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|e| format!("参数 {camel} 解析失败: {e}")),
    }
}

fn ok_json<T: serde::Serialize>(result: Result<T, String>) -> Result<(Value, Vec<Value>), String> {
    result.and_then(|v| {
        serde_json::to_value(v)
            .map(|val| (val, Vec::new()))
            .map_err(|e| e.to_string())
    })
}

fn dispatch(
    app: &tauri::AppHandle,
    cmd: &str,
    args: &Value,
) -> Result<(Value, Vec<Value>), String> {
    let db = app.state::<commands::Database>();
    let manager = app.state::<engine::EngineManager>();
    match cmd {
        "repertoire_list" => ok_json(commands::repertoire_list(db)),
        "repertoire_get" => ok_json(commands::repertoire_get(db, arg(args, "id", "id")?)),
        "repertoire_save" => ok_json(commands::repertoire_save(db, arg(args, "book", "book")?)),
        "repertoire_add_move" => ok_json(tauri::async_runtime::block_on(
            commands::repertoire_add_move(
                db,
                arg(args, "id", "id")?,
                arg(args, "revision", "revision")?,
                arg(args, "node", "node")?,
                arg(args, "notes", "notes")?,
            ),
        )),
        "repertoire_delete" => ok_json(commands::repertoire_delete(
            db,
            arg(args, "id", "id")?,
            arg(args, "revision", "revision")?,
        )),
        "import_games" => ok_json(commands::import_games(db, arg(args, "games", "games")?)),
        "list_games" => ok_json(commands::list_games(db, arg(args, "filter", "filter")?)),
        "game_offset" => ok_json(commands::game_offset(
            db,
            arg(args, "filter", "filter")?,
            arg(args, "gameId", "game_id")?,
        )),
        "get_game" => ok_json(commands::get_game(db, arg(args, "id", "id")?)),
        "get_review_variations" => ok_json(commands::get_review_variations(
            db,
            arg(args, "gameId", "game_id")?,
        )),
        "save_review_variations" => ok_json(commands::save_review_variations(
            db,
            arg(args, "gameId", "game_id")?,
            arg(args, "variations", "variations")?,
        )),
        "delete_review_variation" => ok_json(commands::delete_review_variation(
            db,
            arg(args, "gameId", "game_id")?,
            arg(args, "moveId", "move_id")?,
        )),
        "save_annotation" => ok_json(commands::save_annotation(
            db,
            arg(args, "gameId", "game_id")?,
            opt_arg(args, "moveId", "move_id")?,
            arg(args, "content", "content")?,
        )),
        "get_annotations" => ok_json(commands::get_annotations(
            db,
            arg(args, "gameId", "game_id")?,
        )),
        "set_reviewed" => ok_json(commands::set_reviewed(
            db,
            arg(args, "id", "id")?,
            arg(args, "reviewed", "reviewed")?,
        )),
        "next_puzzle_title" => ok_json(commands::next_puzzle_title(
            db,
            arg(args, "gameId", "game_id")?,
            arg(args, "category", "category")?,
        )),
        "save_puzzle" => ok_json(commands::save_puzzle(db, arg(args, "puzzle", "puzzle")?)),
        "list_puzzles" => ok_json(commands::list_puzzles(
            db,
            arg(args, "due", "due")?,
            opt_arg(args, "category", "category")?,
        )),
        "puzzle_page" => ok_json(commands::puzzle_page(
            db,
            opt_arg(args, "category", "category")?,
            arg(args, "limit", "limit")?,
            arg(args, "offset", "offset")?,
        )),
        "get_puzzle" => ok_json(commands::get_puzzle(db, arg(args, "id", "id")?)),
        "delete_puzzle" => ok_json(commands::delete_puzzle(db, arg(args, "id", "id")?)),
        "get_schedule" => ok_json(commands::get_schedule(db, arg(args, "id", "id")?)),
        "get_due_forecast" => ok_json(commands::get_due_forecast(
            db,
            arg(args, "boundaries", "boundaries")?,
        )),
        "record_review" => ok_json(commands::record_review(db, arg(args, "input", "input")?)),
        "get_setting" => ok_json(commands::get_setting(db, arg(args, "key", "key")?)),
        "set_setting" => ok_json(commands::set_setting(
            db,
            arg(args, "key", "key")?,
            arg(args, "value", "value")?,
        )),
        "opening_stats" => ok_json(commands::opening_stats(
            db,
            opt_arg(args, "color", "color")?,
            opt_arg(args, "speed", "speed")?,
            opt_arg(args, "from", "from")?,
            opt_arg(args, "to", "to")?,
            opt_arg(args, "opponentType", "opponent_type")?,
            opt_arg(args, "source", "source")?,
        )),
        "chesscom_test" => ok_json(tauri::async_runtime::block_on(commands::chesscom_test(
            arg(args, "username", "username")?,
        ))),
        "chesscom_archives" => ok_json(tauri::async_runtime::block_on(
            commands::chesscom_archives(arg(args, "username", "username")?),
        )),
        "chesscom_month" => ok_json(tauri::async_runtime::block_on(commands::chesscom_month(
            arg(args, "username", "username")?,
            arg(args, "month", "month")?,
        ))),
        "import_chesscom_batch" => ok_json(commands::import_chesscom_batch(
            db,
            arg(args, "username", "username")?,
            arg(args, "games", "games")?,
            arg(args, "checkpoint", "checkpoint")?,
        )),
        "lichess_test" => ok_json(tauri::async_runtime::block_on(commands::lichess_test(arg(
            args, "username", "username",
        )?))),
        "lichess_export_batch" => ok_json(tauri::async_runtime::block_on(
            commands::lichess_export_batch(
                arg(args, "username", "username")?,
                opt_arg(args, "since", "since")?,
                arg(args, "until", "until")?,
            ),
        )),
        "lichess_refresh_games" => ok_json(tauri::async_runtime::block_on(
            commands::lichess_refresh_games(arg(args, "ids", "ids")?),
        )),
        "import_sync_batch" => ok_json(commands::import_sync_batch(
            db,
            arg(args, "username", "username")?,
            arg(args, "games", "games")?,
            arg(args, "checkpoint", "checkpoint")?,
        )),
        "engine_analyze" => {
            let updates: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
            let sink = Arc::clone(&updates);
            let channel = Channel::new(move |body| {
                if let InvokeResponseBody::Json(raw) = body {
                    if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
                        if let Ok(mut list) = sink.lock() {
                            list.push(parsed);
                        }
                    }
                }
                Ok(())
            });
            let result = tauri::async_runtime::block_on(commands::engine_analyze(
                db,
                manager,
                arg(args, "path", "path")?,
                arg(args, "fen", "fen")?,
                arg(args, "depth", "depth")?,
                opt_arg(args, "requestId", "request_id")?,
                opt_arg(args, "multipv", "multipv")?,
                channel,
            ))?;
            let value = serde_json::to_value(result).map_err(|e| e.to_string())?;
            let collected = updates.lock().map(|g| g.clone()).unwrap_or_default();
            Ok((value, collected))
        }
        "engine_stop" => {
            commands::engine_stop(manager, opt_arg(args, "requestId", "request_id")?);
            Ok((Value::Null, Vec::new()))
        }
        "save_lichess_token" => ok_json(commands::save_lichess_token(
            arg(args, "username", "username")?,
            arg(args, "token", "token")?,
        )),
        "engine_validate" => ok_json(commands::engine_validate(arg(args, "path", "path")?)),
        "export_backup" => ok_json(tauri::async_runtime::block_on(commands::export_backup(
            app.clone(),
            db,
            arg(args, "preferences", "preferences")?,
        ))),
        "inspect_backup" => ok_json(tauri::async_runtime::block_on(commands::inspect_backup(
            db,
            arg(args, "rawJson", "raw_json")?,
        ))),
        "import_backup" => ok_json(tauri::async_runtime::block_on(commands::import_backup(
            db,
            manager,
            arg(args, "rawJson", "raw_json")?,
        ))),
        "plugin:app|version" => Ok((
            Value::String(env!("CARGO_PKG_VERSION").to_string()),
            Vec::new(),
        )),
        other => Err(format!("未知命令: {other}")),
    }
}

fn write_http(mut stream: TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn handle_client(stream: TcpStream, app: &tauri::AppHandle, db_path: &str) {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() || request_line.is_empty() {
        return;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/");
    let mut content_length = 0usize;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).is_err() {
            return;
        }
        if header == "\r\n" || header == "\n" || header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }
    let mut body = vec![0u8; content_length];
    if content_length > 0 && reader.read_exact(&mut body).is_err() {
        return;
    }
    let stream = reader.into_inner();
    if method == "OPTIONS" {
        write_http(stream, "204 No Content", "");
        return;
    }
    if method == "GET" && path == "/health" {
        let payload = json!({
            "ok": true,
            "db": db_path,
            "pid": std::process::id(),
        });
        write_http(stream, "200 OK", &payload.to_string());
        return;
    }
    if method == "POST" && path == "/invoke" {
        let parsed: Value = match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => {
                write_http(
                    stream,
                    "400 Bad Request",
                    &json!({ "ok": false, "error": e.to_string() }).to_string(),
                );
                return;
            }
        };
        let cmd = parsed.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
        let args = parsed.get("args").cloned().unwrap_or_else(|| json!({}));
        match dispatch(app, cmd, &args) {
            Ok((result, updates)) => write_http(
                stream,
                "200 OK",
                &json!({ "ok": true, "result": result, "updates": updates }).to_string(),
            ),
            Err(error) => write_http(
                stream,
                "200 OK",
                &json!({ "ok": false, "error": error }).to_string(),
            ),
        }
        return;
    }
    write_http(
        stream,
        "404 Not Found",
        &json!({ "ok": false, "error": "Not Found" }).to_string(),
    );
}

fn parse_flag(name: &str) -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == name {
            return args.next();
        }
    }
    None
}

fn main() {
    let db_path = PathBuf::from(parse_flag("--db").expect("Pass --db <sqlite-path>"));
    let port: u16 = parse_flag("--port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(0);
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create DB directory");
    }
    let export_dir = db_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("exports");
    let db_string = db_path.to_string_lossy().into_owned();
    let conn = rusqlite::Connection::open(&db_path).expect("Failed to open verification SQLite DB");
    db::migrations::migrate(&conn).expect("Failed to migrate verification DB");

    let listener = TcpListener::bind(("127.0.0.1", port)).expect("Failed to bind bridge listener");
    let bound_port = listener.local_addr().unwrap().port();

    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();

    tauri::Builder::default()
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            app.manage(commands::Database::new(conn));
            app.manage(engine::EngineManager::new());
            app.manage(commands::BackupExportDir(export_dir));
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                println!("BRIDGE_PORT={bound_port}");
                println!("BRIDGE_DB={db_string}");
                let _ = std::io::stdout().flush();
                for stream in listener.incoming().flatten() {
                    let handle = handle.clone();
                    let db_string = db_string.clone();
                    std::thread::spawn(move || handle_client(stream, &handle, &db_string));
                }
            });
            Ok(())
        })
        .run(context)
        .expect("Verification bridge failed");
}

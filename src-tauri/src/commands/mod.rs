use crate::db::repository::{
    self, Game, GameFilter, GamePage, OpponentType, Puzzle, ReviewInput, Schedule, SyncCheckpoint,
};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

pub struct Database(pub Mutex<Connection>);
fn db<'a>(state: &'a State<'_, Database>) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state.0.lock().map_err(|_| "数据库锁已损坏".into())
}
#[tauri::command]
pub fn import_games(state: State<Database>, games: Vec<Game>) -> Result<usize, String> {
    repository::import_games(&mut *db(&state)?, games)
}
#[tauri::command]
pub fn list_games(state: State<Database>, filter: GameFilter) -> Result<GamePage, String> {
    repository::list_games(&*db(&state)?, filter)
}
#[tauri::command]
pub fn get_game(state: State<Database>, id: String) -> Result<Game, String> {
    repository::get_game(&*db(&state)?, &id)
}
#[tauri::command]
pub fn save_annotation(
    state: State<Database>,
    game_id: String,
    move_id: Option<String>,
    content: String,
) -> Result<(), String> {
    repository::save_annotation(&*db(&state)?, &game_id, move_id.as_deref(), &content)
}
#[tauri::command]
pub fn get_annotations(
    state: State<Database>,
    game_id: String,
) -> Result<Vec<(Option<String>, String)>, String> {
    repository::annotations(&*db(&state)?, &game_id)
}
#[tauri::command]
pub fn set_reviewed(state: State<Database>, id: String, reviewed: bool) -> Result<(), String> {
    repository::set_reviewed(&*db(&state)?, &id, reviewed)
}
#[tauri::command]
pub fn next_puzzle_title(
    state: State<Database>,
    game_id: String,
    category: String,
) -> Result<String, String> {
    repository::next_puzzle_title(&*db(&state)?, Some(&game_id), &category)
}
#[tauri::command]
pub fn save_puzzle(state: State<Database>, puzzle: Puzzle) -> Result<String, String> {
    repository::save_puzzle(&*db(&state)?, puzzle)
}
#[tauri::command]
pub fn get_puzzle(state: State<Database>, id: String) -> Result<Puzzle, String> {
    repository::get_puzzle(&*db(&state)?, &id)
}
#[tauri::command]
pub fn delete_puzzle(state: State<Database>, id: String) -> Result<(), String> {
    repository::delete_puzzle(&*db(&state)?, &id)
}
#[tauri::command]
pub fn list_puzzles(
    state: State<Database>,
    due: bool,
    category: Option<String>,
) -> Result<Vec<Puzzle>, String> {
    repository::puzzles(&*db(&state)?, due, category.as_deref())
}
#[tauri::command]
pub fn get_schedule(state: State<Database>, id: String) -> Result<Schedule, String> {
    repository::schedule(&*db(&state)?, &id)
}
#[tauri::command]
pub fn record_review(state: State<Database>, input: ReviewInput) -> Result<(), String> {
    repository::record_review(&mut *db(&state)?, input)
}
#[tauri::command]
pub fn get_setting(state: State<Database>, key: String) -> Result<Option<String>, String> {
    repository::get_setting(&*db(&state)?, &key)
}
#[tauri::command]
pub fn set_setting(state: State<Database>, key: String, value: String) -> Result<(), String> {
    if key.to_lowercase().contains("token") {
        return Err("Token 不可写入 SQLite".into());
    }
    repository::set_setting(&*db(&state)?, &key, &value)
}
#[tauri::command]
pub fn opening_stats(
    state: State<Database>,
    color: Option<String>,
    speed: Option<String>,
    from: Option<String>,
    to: Option<String>,
    opponent_type: Option<OpponentType>,
) -> Result<Vec<serde_json::Value>, String> {
    repository::opening_stats(
        &*db(&state)?,
        color.as_deref(),
        speed.as_deref(),
        from.as_deref(),
        to.as_deref(),
        opponent_type.unwrap_or_default(),
    )
}
#[tauri::command]
pub async fn lichess_test(username: String) -> Result<(), String> {
    {
        let token = crate::lichess::credentials::load(&username);
        crate::lichess::test_connection(&username, token.as_deref()).await
    }
}
#[tauri::command]
pub async fn lichess_export_batch(
    username: String,
    since: Option<i64>,
    until: i64,
) -> Result<Vec<crate::lichess::ExportGame>, String> {
    let token = crate::lichess::credentials::load(&username);
    crate::lichess::export_batch(&username, since, until, token.as_deref()).await
}
#[tauri::command]
pub fn import_sync_batch(
    state: State<Database>,
    username: String,
    games: Vec<Game>,
    checkpoint: SyncCheckpoint,
) -> Result<SyncCheckpoint, String> {
    if !crate::lichess::valid_username(&username) {
        return Err("Lichess 用户名格式无效".into());
    }
    repository::import_sync_batch(&mut *db(&state)?, &username, games, checkpoint)
}

#[tauri::command]
pub async fn lichess_refresh_games(
    ids: Vec<String>,
) -> Result<Vec<crate::lichess::ExportGame>, String> {
    crate::lichess::refresh_games(ids).await
}

#[tauri::command]
pub async fn engine_analyze(
    state: State<'_, Database>,
    manager: State<'_, crate::engine::EngineManager>,
    path: String,
    fen: String,
    depth: u32,
    request_id: Option<String>,
    on_update: tauri::ipc::Channel<crate::engine::Analysis>,
) -> Result<crate::engine::Analysis, String> {
    crate::engine::validate(&path)?;
    let depth = depth.clamp(4, 30);
    let version = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default();
    if let Some(cached) = repository::engine_cache_get(&*db(&state)?, &fen, &path, &version, depth)?
    {
        return Ok(cached);
    }
    let result = crate::engine::analyze(
        &manager,
        &path,
        &fen,
        depth,
        request_id.as_deref(),
        |analysis| {
            let _ = on_update.send(analysis);
        },
    )
    .await?;
    repository::engine_cache_save(&*db(&state)?, &path, &version, &result)?;
    Ok(result)
}
#[tauri::command]
pub fn engine_stop(manager: State<'_, crate::engine::EngineManager>, request_id: Option<String>) {
    manager.stop(request_id.as_deref())
}

#[tauri::command]
pub fn save_lichess_token(username: String, token: String) -> Result<(), String> {
    crate::lichess::credentials::save(&username, &token)
}

#[tauri::command]
pub fn engine_validate(path: String) -> Result<(), String> {
    crate::engine::validate(&path)
}

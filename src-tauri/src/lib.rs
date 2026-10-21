mod commands;
mod db;
mod engine;
mod lichess;
use commands::Database;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = rusqlite::Connection::open(dir.join("chess-trainer.db"))?;
            db::migrations::migrate(&db)?;
            app.manage(Database(std::sync::Mutex::new(db)));
            app.manage(engine::EngineManager::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_games,
            commands::list_games,
            commands::get_game,
            commands::save_annotation,
            commands::get_annotations,
            commands::set_reviewed,
            commands::next_puzzle_title,
            commands::save_puzzle,
            commands::list_puzzles,
            commands::get_puzzle,
            commands::delete_puzzle,
            commands::get_schedule,
            commands::get_due_forecast,
            commands::record_review,
            commands::get_setting,
            commands::set_setting,
            commands::opening_stats,
            commands::lichess_test,
            commands::lichess_export_batch,
            commands::lichess_refresh_games,
            commands::import_sync_batch,
            commands::engine_analyze,
            commands::engine_stop,
            commands::save_lichess_token,
            commands::engine_validate
        ])
        .run(tauri::generate_context!())
        .expect("Chess Trainer failed to start");
}

CREATE TABLE IF NOT EXISTS games (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, external_game_id TEXT, white_player TEXT NOT NULL,
 black_player TEXT NOT NULL, user_color TEXT CHECK(user_color IN ('white','black') OR user_color IS NULL),
 result TEXT NOT NULL CHECK(result IN ('white','black','draw','unknown')),
 played_at TEXT, time_control TEXT, speed TEXT, rated INTEGER, eco TEXT, opening_name TEXT,
 pgn TEXT NOT NULL, review_status INTEGER NOT NULL DEFAULT 0, reviewed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_synced_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS games_source_external ON games(source,external_game_id) WHERE external_game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_date ON games(played_at DESC,id);
CREATE INDEX IF NOT EXISTS games_filters ON games(user_color,result,speed,review_status);
CREATE TABLE IF NOT EXISTS moves (
 id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
 ply INTEGER NOT NULL CHECK(ply>0), san TEXT NOT NULL, uci TEXT NOT NULL,
 fen_before TEXT NOT NULL, fen_after TEXT NOT NULL, UNIQUE(game_id,ply)
);
CREATE TABLE IF NOT EXISTS annotations (
 id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
 move_id TEXT REFERENCES moves(id) ON DELETE CASCADE, content TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS annotations_target ON annotations(game_id,COALESCE(move_id,''));
CREATE TABLE IF NOT EXISTS engine_analyses (
 id INTEGER PRIMARY KEY, fen TEXT NOT NULL, engine_name TEXT NOT NULL, engine_version TEXT NOT NULL,
 analysis_config TEXT NOT NULL, depth INTEGER NOT NULL, score_type TEXT NOT NULL,
 score_value INTEGER NOT NULL, principal_variation TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(fen,engine_name,engine_version,analysis_config,depth)
);
CREATE TABLE IF NOT EXISTS puzzles (
 id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
 source_move_id TEXT REFERENCES moves(id) ON DELETE SET NULL, fen TEXT NOT NULL,
 side_to_move TEXT NOT NULL CHECK(side_to_move IN ('white','black')), title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '', original_move TEXT, expected_moves TEXT NOT NULL,
 solution_line TEXT NOT NULL DEFAULT '[]', error_category TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS puzzles_auto_source ON puzzles(source_game_id,source_move_id) WHERE source_type='auto';
CREATE TABLE IF NOT EXISTS review_schedules (
 puzzle_id TEXT PRIMARY KEY REFERENCES puzzles(id) ON DELETE CASCADE,
 due_at TEXT NOT NULL, interval_days REAL NOT NULL DEFAULT 0, ease_factor REAL NOT NULL DEFAULT 2.5,
 repetitions INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0, last_reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS review_due ON review_schedules(due_at);
CREATE TABLE IF NOT EXISTS review_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, puzzle_id TEXT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
 reviewed_at TEXT NOT NULL, played_move TEXT, is_correct INTEGER NOT NULL,
 rating TEXT NOT NULL, time_spent_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
PRAGMA user_version=1;

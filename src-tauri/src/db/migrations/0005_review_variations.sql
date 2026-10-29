CREATE TABLE review_variations (
 id TEXT PRIMARY KEY,
 game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
 parent_id TEXT,
 ply INTEGER NOT NULL CHECK(ply > 0),
 san TEXT NOT NULL, uci TEXT NOT NULL,
 fen_before TEXT NOT NULL, fen_after TEXT NOT NULL,
 content TEXT NOT NULL DEFAULT ''
);
CREATE INDEX review_variations_game ON review_variations(game_id, ply);

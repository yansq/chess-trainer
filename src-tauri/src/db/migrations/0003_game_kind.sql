ALTER TABLE games ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0 CHECK(is_bot IN (0,1));
CREATE INDEX games_opponent_type_date ON games(is_bot,played_at DESC,id);

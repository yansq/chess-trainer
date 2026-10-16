ALTER TABLE puzzles ADD COLUMN category TEXT NOT NULL DEFAULT 'opening'
 CHECK(category IN ('opening','tactics','endgame','other'));
CREATE INDEX puzzles_category ON puzzles(category);

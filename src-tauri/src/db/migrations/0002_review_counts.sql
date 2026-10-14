ALTER TABLE review_schedules ADD COLUMN total_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE review_schedules ADD COLUMN correct_count INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version=2;

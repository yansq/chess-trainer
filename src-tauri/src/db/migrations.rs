use rusqlite::{Connection, Result};

pub fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")?;
    let version: i64 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 {
        db.execute_batch(include_str!("migrations/0001_initial.sql"))?;
    }
    if version < 2 {
        db.execute_batch(include_str!("migrations/0002_review_counts.sql"))?;
    }
    if version < 3 {
        let tx = db.unchecked_transaction()?;
        tx.execute_batch(include_str!("migrations/0003_game_kind.sql"))?;
        {
            let mut stmt = tx.prepare("SELECT id,pgn,white_player,black_player FROM games")?;
            let games = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?;
            for game in games {
                let (id, pgn, white, black) = game?;
                if super::game_kind::is_bot_game(&pgn, &white, &black) {
                    tx.execute("UPDATE games SET is_bot=1 WHERE id=?1", [id])?;
                }
            }
        }
        tx.pragma_update(None, "user_version", 3)?;
        tx.commit()?;
    }
    if version < 4 {
        let tx = db.unchecked_transaction()?;
        tx.execute_batch(include_str!("migrations/0004_puzzle_category.sql"))?;
        tx.pragma_update(None, "user_version", 4)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upgrades_v2_and_classifies_existing_games_without_changing_review_data() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("migrations/0001_initial.sql"))
            .unwrap();
        db.execute_batch(include_str!("migrations/0002_review_counts.sql"))
            .unwrap();
        for (id, pgn, black) in [
            ("human", "[Event \"Casual game\"]", "RobotFan"),
            ("bot", "[BlackTitle \"BOT\"]", "Engine"),
            ("ai", "[Event \"Casual game\"]", "Stockfish level 4"),
        ] {
            db.execute("INSERT INTO games(id,source,white_player,black_player,result,pgn,review_status) VALUES (?1,'local','Trainer',?2,'white',?3,1)", rusqlite::params![id, black, pgn]).unwrap();
        }
        db.execute(
            "INSERT INTO annotations(id,game_id,content) VALUES ('note','bot','keep this note')",
            [],
        )
        .unwrap();
        migrate(&db).unwrap();
        migrate(&db).unwrap();
        for (id, expected) in [("human", false), ("bot", true), ("ai", true)] {
            let (is_bot, reviewed): (bool, bool) = db
                .query_row(
                    "SELECT is_bot,review_status FROM games WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(is_bot, expected);
            assert!(reviewed);
        }
        let note: String = db
            .query_row("SELECT content FROM annotations WHERE id='note'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(note, "keep this note");
    }

    #[test]
    fn upgrades_v3_puzzle_to_opening_and_preserves_training_data() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("migrations/0001_initial.sql"))
            .unwrap();
        db.execute_batch(include_str!("migrations/0002_review_counts.sql"))
            .unwrap();
        db.execute_batch(include_str!("migrations/0003_game_kind.sql"))
            .unwrap();
        db.pragma_update(None, "user_version", 3).unwrap();
        db.execute_batch(r#"INSERT INTO puzzles(id,source_type,fen,side_to_move,title,expected_moves,solution_line) VALUES ('existing','manual','fen','white','原有题目','["e2e4"]','["e2e4","e7e5"]');
            INSERT INTO review_schedules(puzzle_id,due_at,repetitions,total_attempts,correct_count) VALUES ('existing','2026-10-20',3,5,4);
            INSERT INTO review_logs(puzzle_id,reviewed_at,played_move,is_correct,rating,time_spent_ms) VALUES ('existing','2026-10-16','e2e4',1,'Good',1234);"#).unwrap();
        migrate(&db).unwrap();
        migrate(&db).unwrap();
        let (category, title, moves, line): (String, String, String, String) = db.query_row("SELECT category,title,expected_moves,solution_line FROM puzzles WHERE id='existing'", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
        assert_eq!(category, "opening");
        assert_eq!(title, "原有题目");
        assert_eq!(moves, r#"["e2e4"]"#);
        assert_eq!(line, r#"["e2e4","e7e5"]"#);
        let counts: (i64, i64, i64) = db.query_row("SELECT repetitions,total_attempts,correct_count FROM review_schedules WHERE puzzle_id='existing'", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(counts, (3, 5, 4));
        let logs: i64 = db.query_row("SELECT COUNT(*) FROM review_logs WHERE puzzle_id='existing' AND played_move='e2e4' AND time_spent_ms=1234", [], |r| r.get(0)).unwrap();
        assert_eq!(logs, 1);
        assert!(db
            .execute("UPDATE puzzles SET category='invalid'", [])
            .is_err());
    }

    #[test]
    fn upgrades_existing_v1_and_can_repeat() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("migrations/0001_initial.sql"))
            .unwrap();
        migrate(&db).unwrap();
        migrate(&db).unwrap();
        let version: i64 = db
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 4);
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM pragma_table_info('review_schedules') WHERE name IN ('total_attempts','correct_count')", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }
}

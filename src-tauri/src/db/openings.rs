use rusqlite::{params, Connection, Result};
use std::{collections::HashMap, sync::OnceLock};

type Opening = (String, String);

fn catalogue() -> &'static HashMap<String, Opening> {
    static CATALOGUE: OnceLock<HashMap<String, Opening>> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../src/shared/chess/lichess-openings.json"
        ))
        .expect("bundled Lichess opening catalogue must be valid")
    })
}

// Callers supply positions newest first. Ignore move counters, retain turn,
// castling and legal en-passant rights, just like the shared chess.js index.
pub fn classify<'a>(positions: impl IntoIterator<Item = &'a str>) -> Option<&'static Opening> {
    for fen in positions {
        let key = fen.split_whitespace().take(4).collect::<Vec<_>>().join(" ");
        if let Some(entry) = catalogue().get(&key) {
            return Some(entry);
        }
    }
    None
}

// Only opening metadata is rewritten. Stored games, original PGN, annotations,
// review variations, ownership and training records keep their identities.
pub fn reclassify_existing(db: &Connection) -> Result<()> {
    let mut games = db.prepare("SELECT id FROM games")?;
    let ids = games.query_map([], |row| row.get::<_, String>(0))?;
    let mut moves =
        db.prepare("SELECT fen_before,fen_after FROM moves WHERE game_id=?1 ORDER BY ply DESC")?;
    let mut update = db.prepare("UPDATE games SET eco=?1,opening_name=?2 WHERE id=?3")?;
    for id in ids {
        let id = id?;
        let mut positions = Vec::new();
        let mut initial = None;
        for item in moves.query_map([&id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })? {
            let (before, after) = item?;
            positions.push(after);
            initial = Some(before);
        }
        positions.extend(initial);
        let opening = classify(positions.iter().map(String::as_str));
        update.execute(params![opening.map(|o| &o.0), opening.map(|o| &o.1), id])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        migrations::migrate,
        repository::{self, Game, OpponentType},
    };
    use serde_json::{json, Value};

    fn fixtures() -> Vec<Value> {
        serde_json::from_str(include_str!("../../../tests/fixtures/openings.json")).unwrap()
    }
    fn game(fixture: &Value, id: &str, source: &str) -> Game {
        let moves: Vec<Value> = fixture["moves"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| {
                let mut m = m.clone();
                m["id"] = json!(format!("{id}:{}", m["ply"]));
                m["gameId"] = json!(id);
                m
            })
            .collect();
        serde_json::from_value(json!({
            "id":id,"source":source,"externalGameId":null,
            "whitePlayer":"Trainer","blackPlayer":"Opponent","userColor":"white",
            "result":"white","playedAt":"2026-10-01","timeControl":null,
            "speed":"rapid","rated":true,"eco":"A00","openingName":"Platform-specific wrong name",
            "pgn":fixture["pgn"],"reviewStatus":false,"isOwnGame":true,"moves":moves,
        }))
        .unwrap()
    }
    #[test]
    fn native_import_matches_shared_cases_and_never_trusts_platform_labels() {
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&db).unwrap();
        for fixture in fixtures() {
            let id = fixture["id"].as_str().unwrap();
            repository::import_games(&mut db, vec![game(&fixture, id, "local")]).unwrap();
            let saved = repository::get_game(&db, id).unwrap();
            assert_eq!(json!(saved.eco), fixture["expected"]["eco"], "{id}");
            assert_eq!(
                json!(saved.opening_name),
                fixture["expected"]["openingName"],
                "{id}"
            );
            assert_eq!(json!(saved.pgn), fixture["pgn"]);
        }
    }
    #[test]
    fn migration_merges_platform_statistics_preserves_review_data_and_reimport_stays_canonical() {
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&db).unwrap();
        let f = fixtures();
        repository::import_games(
            &mut db,
            vec![
                game(&f[0], "chess", "chesscom"),
                game(&f[1], "lichess", "lichess"),
                game(&f[3], "other", "local"),
            ],
        )
        .unwrap();
        db.execute_batch("UPDATE games SET eco='B40',opening_name=CASE id WHEN 'chess' THEN 'Sicilian Defense: French Variation 3.Nc3 Nc6 4.Bb5 Qc7' ELSE 'Old label' END,review_status=1;
            UPDATE games SET is_own_game=0 WHERE id='other';
            INSERT INTO annotations(id,game_id,move_id,content) VALUES ('note','chess','chess:1','Keep my note'),('summary','chess',NULL,'Keep my summary');
            INSERT INTO review_variations(id,game_id,parent_id,ply,san,uci,fen_before,fen_after,content) VALUES ('branch','chess','chess:1',2,'d5','d7d5','before','after','Branch note');
            INSERT INTO puzzles(id,source_type,source_game_id,source_move_id,fen,side_to_move,title,expected_moves) VALUES ('p','manual','chess','chess:1','before','white','Custom title','[]');
            INSERT INTO review_schedules(puzzle_id,due_at) VALUES ('p','2026-10-01');
            INSERT INTO review_logs(puzzle_id,reviewed_at,is_correct,rating,time_spent_ms) VALUES ('p','2026-10-01',1,'good',1000);
            PRAGMA user_version=6;").unwrap();
        let before = repository::get_game(&db, "chess").unwrap();
        migrate(&db).unwrap();
        migrate(&db).unwrap();
        let after = repository::get_game(&db, "chess").unwrap();
        assert_eq!(before.pgn, after.pgn);
        assert_eq!(
            serde_json::to_value(before.moves).unwrap(),
            serde_json::to_value(after.moves).unwrap()
        );
        assert!(after.review_status);
        assert!(!repository::get_game(&db, "other").unwrap().is_own_game);
        assert_eq!(repository::annotations(&db, "chess").unwrap().len(), 3);
        let branch: String = db
            .query_row(
                "SELECT content FROM review_variations WHERE id='branch'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(branch, "Branch note");
        let training: (String, i64, i64) = db.query_row("SELECT title,(SELECT COUNT(*) FROM review_schedules),(SELECT COUNT(*) FROM review_logs) FROM puzzles WHERE id='p'", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(training, ("Custom title".into(), 1, 1));
        let stats = repository::opening_stats(&db, None, None, None, None, OpponentType::All, None)
            .unwrap();
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0]["opening"], "Sicilian Defense: French Variation");
        assert_eq!(stats[0]["total"], 2);
        for source in ["chesscom", "lichess"] {
            let stats = repository::opening_stats(
                &db,
                None,
                None,
                None,
                None,
                OpponentType::All,
                Some(source),
            )
            .unwrap();
            assert_eq!(stats[0]["total"], 1);
        }
        // A later sync cannot restore a platform-specific label or erase review work.
        repository::import_games(&mut db, vec![game(&f[0], "chess", "chesscom")]).unwrap();
        assert_eq!(
            repository::get_game(&db, "chess")
                .unwrap()
                .opening_name
                .as_deref(),
            Some("Sicilian Defense: French Variation")
        );
        assert_eq!(repository::annotations(&db, "chess").unwrap().len(), 3);
        assert!(repository::get_game(&db, "chess").unwrap().review_status);
    }
    #[test]
    fn failed_migration_rolls_back_all_labels_and_version_then_can_retry() {
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&db).unwrap();
        let f = fixtures();
        repository::import_games(
            &mut db,
            vec![game(&f[0], "a", "local"), game(&f[1], "b", "local")],
        )
        .unwrap();
        db.execute_batch("UPDATE games SET opening_name='Old label'; PRAGMA user_version=6;
            CREATE TRIGGER fail_openings BEFORE UPDATE OF opening_name ON games WHEN OLD.id='b' BEGIN SELECT RAISE(FAIL,'simulated write failure'); END;").unwrap();
        assert!(migrate(&db).is_err());
        assert_eq!(
            db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            6
        );
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM games WHERE opening_name='Old label'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            2
        );
        db.execute_batch("DROP TRIGGER fail_openings;").unwrap();
        migrate(&db).unwrap();
        assert_eq!(db.query_row("SELECT COUNT(*) FROM games WHERE opening_name='Sicilian Defense: French Variation'",[],|r|r.get::<_,i64>(0)).unwrap(),2);
    }
}

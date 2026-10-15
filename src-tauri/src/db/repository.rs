use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Move {
    pub id: String,
    pub game_id: String,
    pub ply: i64,
    pub san: String,
    pub uci: String,
    pub fen_before: String,
    pub fen_after: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub source: String,
    pub external_game_id: Option<String>,
    pub white_player: String,
    pub black_player: String,
    pub user_color: Option<String>,
    pub result: String,
    pub played_at: Option<String>,
    pub time_control: Option<String>,
    pub speed: Option<String>,
    pub rated: Option<bool>,
    pub eco: Option<String>,
    pub opening_name: Option<String>,
    pub pgn: String,
    pub review_status: bool,
    #[serde(skip_deserializing)]
    pub is_bot: bool,
    pub moves: Vec<Move>,
}
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpponentType {
    #[default]
    Human,
    Bot,
    All,
}
impl OpponentType {
    fn is_bot(&self) -> Option<bool> {
        match self {
            Self::Human => Some(false),
            Self::Bot => Some(true),
            Self::All => None,
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameFilter {
    #[serde(default)]
    pub opponent_type: OpponentType,
    pub color: Option<String>,
    pub result: Option<String>,
    pub speed: Option<String>,
    pub reviewed: Option<bool>,
    pub opening: Option<String>,
    pub limit: i64,
    pub offset: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePage {
    pub items: Vec<Game>,
    pub total: i64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Puzzle {
    pub id: String,
    pub source_type: String,
    pub source_game_id: Option<String>,
    pub source_move_id: Option<String>,
    pub fen: String,
    pub side_to_move: String,
    pub title: String,
    pub description: String,
    pub original_move: Option<String>,
    pub expected_moves: Vec<String>,
    pub solution_line: Vec<String>,
    pub error_category: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub puzzle_id: String,
    pub due_at: String,
    pub interval_days: f64,
    pub ease_factor: f64,
    pub repetitions: i64,
    pub lapses: i64,
    pub last_reviewed_at: Option<String>,
    pub total_attempts: i64,
    pub correct_count: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewInput {
    pub schedule: Schedule,
    pub played_move: Option<String>,
    pub is_correct: bool,
    pub rating: String,
    pub time_spent_ms: i64,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn game_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Game> {
    Ok(Game {
        id: row.get(0)?,
        source: row.get(1)?,
        external_game_id: row.get(2)?,
        white_player: row.get(3)?,
        black_player: row.get(4)?,
        user_color: row.get(5)?,
        result: row.get(6)?,
        played_at: row.get(7)?,
        time_control: row.get(8)?,
        speed: row.get(9)?,
        rated: row.get(10)?,
        eco: row.get(11)?,
        opening_name: row.get(12)?,
        pgn: row.get(13)?,
        review_status: row.get(14)?,
        is_bot: row.get(15)?,
        moves: vec![],
    })
}
const GAME_SELECT:&str="SELECT id,source,external_game_id,white_player,black_player,user_color,result,played_at,time_control,speed,rated,eco,opening_name,pgn,review_status,is_bot FROM games";
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPending {
    pub since: Option<i64>,
    pub until: i64,
    pub upper_bound: i64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCheckpoint {
    pub completed_through: Option<i64>,
    pub pending: Option<SyncPending>,
    pub read: usize,
    pub added: usize,
    #[serde(default)]
    pub unfinished_ids: Vec<String>,
}
pub fn import_games(db: &mut Connection, games: Vec<Game>) -> Result<usize, String> {
    let tx = db.transaction().map_err(err)?;
    let count = write_games(&tx, games)?;
    tx.commit().map_err(err)?;
    Ok(count)
}
pub fn import_sync_batch(
    db: &mut Connection,
    username: &str,
    games: Vec<Game>,
    mut checkpoint: SyncCheckpoint,
) -> Result<SyncCheckpoint, String> {
    let tx = db.transaction().map_err(err)?;
    let count = write_games(&tx, games)?;
    checkpoint.added += count;
    let value = serde_json::to_string(&checkpoint).map_err(err)?;
    set_setting(
        &tx,
        &format!("lichess_sync_v2:{}", username.trim().to_ascii_lowercase()),
        &value,
    )?;
    tx.commit().map_err(err)?;
    Ok(checkpoint)
}
fn write_games(tx: &Connection, games: Vec<Game>) -> Result<usize, String> {
    let mut count = 0;
    for g in games {
        let existing: Option<String> = if let Some(ref external) = g.external_game_id {
            tx.query_row(
                "SELECT id FROM games WHERE source=?1 AND external_game_id=?2",
                params![g.source, external],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?
        } else {
            tx.query_row("SELECT id FROM games WHERE id=?1", [&g.id], |r| r.get(0))
                .optional()
                .map_err(err)?
        };
        let id = existing.unwrap_or_else(|| g.id.clone());
        let fresh: bool = tx
            .query_row("SELECT 1 FROM games WHERE id=?1", [&id], |r| {
                r.get::<_, i64>(0)
            })
            .optional()
            .map_err(err)?
            .is_none();
        let is_bot = super::game_kind::is_bot_game(&g.pgn, &g.white_player, &g.black_player);
        tx.execute("INSERT INTO games(id,source,external_game_id,white_player,black_player,user_color,result,played_at,time_control,speed,rated,eco,opening_name,pgn,is_bot,last_synced_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET white_player=excluded.white_player,black_player=excluded.black_player,user_color=COALESCE(excluded.user_color,games.user_color),result=excluded.result,played_at=excluded.played_at,time_control=excluded.time_control,speed=excluded.speed,rated=excluded.rated,eco=excluded.eco,opening_name=excluded.opening_name,pgn=excluded.pgn,is_bot=excluded.is_bot,last_synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP",params![id,g.source,g.external_game_id,g.white_player,g.black_player,g.user_color,g.result,g.played_at,g.time_control,g.speed,g.rated,g.eco,g.opening_name,g.pgn,is_bot]).map_err(err)?;
        if fresh {
            for m in g.moves {
                tx.execute("INSERT INTO moves(id,game_id,ply,san,uci,fen_before,fen_after) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![format!("{}:{}",id,m.ply),id,m.ply,m.san,m.uci,m.fen_before,m.fen_after]).map_err(err)?;
            }
            count += 1;
        }
    }
    Ok(count)
}
pub fn list_games(db: &Connection, f: GameFilter) -> Result<GamePage, String> {
    let where_sql=" WHERE (?1 IS NULL OR user_color=?1) AND (?2 IS NULL OR (CASE WHEN result=user_color THEN 'win' WHEN result='draw' THEN 'draw' WHEN result IN ('white','black') THEN 'loss' ELSE 'unknown' END)=?2) AND (?3 IS NULL OR speed=?3) AND (?4 IS NULL OR review_status=?4) AND (?5 IS NULL OR eco LIKE '%'||?5||'%' OR opening_name LIKE '%'||?5||'%') AND (?6 IS NULL OR is_bot=?6)";
    let total = db
        .query_row(
            &format!("SELECT COUNT(*) FROM games{where_sql}"),
            params![
                f.color,
                f.result,
                f.speed,
                f.reviewed,
                f.opening,
                f.opponent_type.is_bot()
            ],
            |r| r.get(0),
        )
        .map_err(err)?;
    let mut stmt = db
        .prepare(&format!(
            "{GAME_SELECT}{where_sql} ORDER BY played_at DESC,id DESC LIMIT ?7 OFFSET ?8"
        ))
        .map_err(err)?;
    let items = stmt
        .query_map(
            params![
                f.color,
                f.result,
                f.speed,
                f.reviewed,
                f.opening,
                f.opponent_type.is_bot(),
                f.limit.clamp(1, 100),
                f.offset.max(0)
            ],
            game_from_row,
        )
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(GamePage { items, total })
}
pub fn get_game(db: &Connection, id: &str) -> Result<Game, String> {
    let mut game = db
        .query_row(&format!("{GAME_SELECT} WHERE id=?1"), [id], game_from_row)
        .map_err(err)?;
    let mut stmt=db.prepare("SELECT id,game_id,ply,san,uci,fen_before,fen_after FROM moves WHERE game_id=?1 ORDER BY ply").map_err(err)?;
    game.moves = stmt
        .query_map([id], |r| {
            Ok(Move {
                id: r.get(0)?,
                game_id: r.get(1)?,
                ply: r.get(2)?,
                san: r.get(3)?,
                uci: r.get(4)?,
                fen_before: r.get(5)?,
                fen_after: r.get(6)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(game)
}
pub fn save_annotation(
    db: &Connection,
    game_id: &str,
    move_id: Option<&str>,
    content: &str,
) -> Result<(), String> {
    let id = format!("{game_id}:{}", move_id.unwrap_or("summary"));
    db.execute("INSERT INTO annotations(id,game_id,move_id,content) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET content=excluded.content,updated_at=CURRENT_TIMESTAMP",params![id,game_id,move_id,content]).map_err(err)?;
    Ok(())
}
pub fn annotations(
    db: &Connection,
    game_id: &str,
) -> Result<Vec<(Option<String>, String)>, String> {
    let mut s = db
        .prepare("SELECT move_id,content FROM annotations WHERE game_id=?1")
        .map_err(err)?;
    {
        let result = s
            .query_map([game_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err);
        result
    }
}
pub fn set_reviewed(db: &Connection, id: &str, reviewed: bool) -> Result<(), String> {
    db.execute("UPDATE games SET review_status=?2,reviewed_at=CASE WHEN ?2 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?1",params![id,reviewed]).map_err(err)?;
    Ok(())
}
pub fn save_puzzle(db: &Connection, p: Puzzle) -> Result<(), String> {
    let moves = serde_json::to_string(&p.expected_moves).map_err(err)?;
    let line = serde_json::to_string(&p.solution_line).map_err(err)?;
    db.execute("INSERT INTO puzzles(id,source_type,source_game_id,source_move_id,fen,side_to_move,title,description,original_move,expected_moves,solution_line,error_category) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,expected_moves=excluded.expected_moves,solution_line=excluded.solution_line,updated_at=CURRENT_TIMESTAMP",params![p.id,p.source_type,p.source_game_id,p.source_move_id,p.fen,p.side_to_move,p.title,p.description,p.original_move,moves,line,p.error_category]).map_err(err)?;
    db.execute("INSERT OR IGNORE INTO review_schedules(puzzle_id,due_at) VALUES (?1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",[&p.id]).map_err(err)?;
    Ok(())
}
fn puzzle_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Puzzle> {
    let expected: String = r.get(9)?;
    let solution: String = r.get(10)?;
    Ok(Puzzle {
        id: r.get(0)?,
        source_type: r.get(1)?,
        source_game_id: r.get(2)?,
        source_move_id: r.get(3)?,
        fen: r.get(4)?,
        side_to_move: r.get(5)?,
        title: r.get(6)?,
        description: r.get(7)?,
        original_move: r.get(8)?,
        expected_moves: serde_json::from_str(&expected).unwrap_or_default(),
        solution_line: serde_json::from_str(&solution).unwrap_or_default(),
        error_category: r.get(11)?,
    })
}
const PUZZLE_SELECT:&str="SELECT id,source_type,source_game_id,source_move_id,fen,side_to_move,title,description,original_move,expected_moves,solution_line,error_category FROM puzzles";
pub fn puzzles(db: &Connection, due: bool) -> Result<Vec<Puzzle>, String> {
    let sql = if due {
        format!("{PUZZLE_SELECT} WHERE id IN (SELECT puzzle_id FROM review_schedules WHERE due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) ORDER BY created_at LIMIT 50")
    } else {
        format!("{PUZZLE_SELECT} ORDER BY created_at DESC LIMIT 200")
    };
    let mut s = db.prepare(&sql).map_err(err)?;
    {
        let result = s
            .query_map([], puzzle_from_row)
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err);
        result
    }
}
pub fn schedule(db: &Connection, id: &str) -> Result<Schedule, String> {
    db.query_row("SELECT puzzle_id,due_at,interval_days,ease_factor,repetitions,lapses,last_reviewed_at,total_attempts,correct_count FROM review_schedules WHERE puzzle_id=?1",[id],|r|Ok(Schedule{puzzle_id:r.get(0)?,due_at:r.get(1)?,interval_days:r.get(2)?,ease_factor:r.get(3)?,repetitions:r.get(4)?,lapses:r.get(5)?,last_reviewed_at:r.get(6)?,total_attempts:r.get(7)?,correct_count:r.get(8)?})).map_err(err)
}
pub fn record_review(db: &mut Connection, input: ReviewInput) -> Result<(), String> {
    let tx = db.transaction().map_err(err)?;
    tx.execute("UPDATE review_schedules SET due_at=?2,interval_days=?3,ease_factor=?4,repetitions=?5,lapses=?6,last_reviewed_at=?7,total_attempts=total_attempts+1,correct_count=correct_count+?8 WHERE puzzle_id=?1",params![input.schedule.puzzle_id,input.schedule.due_at,input.schedule.interval_days,input.schedule.ease_factor,input.schedule.repetitions,input.schedule.lapses,input.schedule.last_reviewed_at,input.is_correct]).map_err(err)?;
    tx.execute("INSERT INTO review_logs(puzzle_id,reviewed_at,played_move,is_correct,rating,time_spent_ms) VALUES (?1,CURRENT_TIMESTAMP,?2,?3,?4,?5)",params![input.schedule.puzzle_id,input.played_move,input.is_correct,input.rating,input.time_spent_ms]).map_err(err)?;
    tx.commit().map_err(err)
}
pub fn get_setting(db: &Connection, key: &str) -> Result<Option<String>, String> {
    db.query_row("SELECT value FROM app_settings WHERE key=?1", [key], |r| {
        r.get(0)
    })
    .optional()
    .map_err(err)
}
pub fn set_setting(db: &Connection, key: &str, value: &str) -> Result<(), String> {
    db.execute("INSERT INTO app_settings(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(err)?;
    Ok(())
}
pub fn opening_stats(
    db: &Connection,
    color: Option<&str>,
    speed: Option<&str>,
    from: Option<&str>,
    to: Option<&str>,
    opponent_type: OpponentType,
) -> Result<Vec<Value>, String> {
    let mut s=db.prepare("SELECT COALESCE(eco,'—'),COALESCE(opening_name,'未知开局'),COUNT(*),SUM(CASE WHEN result=user_color THEN 1 ELSE 0 END),SUM(CASE WHEN result='draw' THEN 1 ELSE 0 END),SUM(CASE WHEN result IN ('white','black') AND result<>user_color THEN 1 ELSE 0 END) FROM games WHERE user_color IS NOT NULL AND result IN ('white','black','draw') AND (?1 IS NULL OR user_color=?1) AND (?2 IS NULL OR speed=?2) AND (?3 IS NULL OR played_at>=?3) AND (?4 IS NULL OR played_at<?4) AND (?5 IS NULL OR is_bot=?5) GROUP BY COALESCE(eco,'—'),COALESCE(opening_name,'未知开局') ORDER BY COUNT(*) DESC").map_err(err)?;
    let result=s.query_map(params![color,speed,from,to,opponent_type.is_bot()],|r|{let count:i64=r.get(2)?;let wins:i64=r.get(3)?;let draws:i64=r.get(4)?;Ok(serde_json::json!({"eco":r.get::<_,String>(0)?,"opening":r.get::<_,String>(1)?,"total":count,"wins":wins,"draws":draws,"losses":r.get::<_,i64>(5)?,"winRate":wins as f64/count as f64,"scoreRate":(wins as f64+draws as f64*0.5)/count as f64}))}).map_err(err)?.collect::<rusqlite::Result<Vec<_>>>().map_err(err);
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    fn filter(opponent_type: OpponentType) -> GameFilter {
        GameFilter {
            opponent_type,
            color: None,
            result: None,
            speed: None,
            reviewed: None,
            opening: None,
            limit: 25,
            offset: 0,
        }
    }

    #[test]
    fn opponent_filter_applies_before_pagination_and_statistics() {
        let mut db = Connection::open_in_memory().unwrap();
        crate::db::migrations::migrate(&db).unwrap();
        let mut human_loss = sample_game();
        human_loss.id = "human-loss".into();
        human_loss.external_game_id = Some("human-loss".into());
        human_loss.result = "black".into();
        let mut bot = sample_game();
        bot.id = "bot".into();
        bot.external_game_id = Some("bot".into());
        bot.pgn = "[BlackTitle \"BOT\"]\n\n1. e4 e5 1-0".into();
        let mut ai = sample_game();
        ai.id = "ai".into();
        ai.external_game_id = Some("ai".into());
        ai.white_player = "Stockfish level 3".into();
        ai.black_player = "Trainer".into();
        ai.user_color = Some("black".into());
        ai.result = "draw".into();
        import_games(&mut db, vec![sample_game(), human_loss, bot, ai]).unwrap();

        // Older callers that omit the new field also default to human games.
        let default_filter: GameFilter =
            serde_json::from_value(serde_json::json!({"limit":25,"offset":0})).unwrap();
        let humans = list_games(&db, default_filter).unwrap();
        assert_eq!(humans.total, 2);
        assert!(humans.items.iter().all(|g| !g.is_bot));
        let mut bots_filter = filter(OpponentType::Bot);
        bots_filter.limit = 1;
        bots_filter.offset = 1;
        let bots = list_games(&db, bots_filter).unwrap();
        assert_eq!(bots.total, 2);
        assert_eq!(bots.items.len(), 1);
        assert!(bots.items[0].is_bot);
        assert_eq!(list_games(&db, filter(OpponentType::All)).unwrap().total, 4);
        let mut wins_filter = filter(OpponentType::Bot);
        wins_filter.color = Some("white".into());
        wins_filter.result = Some("win".into());
        wins_filter.speed = Some("rapid".into());
        wins_filter.opening = Some("C20".into());
        wins_filter.reviewed = Some(false);
        assert_eq!(list_games(&db, wins_filter).unwrap().total, 1);

        let humans = opening_stats(&db, None, None, None, None, OpponentType::Human).unwrap();
        assert_eq!(humans[0]["total"], 2);
        assert_eq!(humans[0]["wins"], 1);
        assert_eq!(humans[0]["losses"], 1);
        assert_eq!(humans[0]["winRate"], 0.5);
        let bots = opening_stats(&db, None, None, None, None, OpponentType::Bot).unwrap();
        assert_eq!(bots[0]["total"], 2);
        assert_eq!(bots[0]["draws"], 1);
        assert_eq!(bots[0]["scoreRate"], 0.75);
        let all = opening_stats(&db, None, None, None, None, OpponentType::All).unwrap();
        assert_eq!(all[0]["total"], 4);
        assert_eq!(all[0]["scoreRate"], 0.625);
        let white_bots = opening_stats(
            &db,
            Some("white"),
            Some("rapid"),
            Some("2026-10-01"),
            Some("2026-10-02"),
            OpponentType::Bot,
        )
        .unwrap();
        assert_eq!(white_bots[0]["total"], 1);
        assert!(
            opening_stats(&db, None, None, Some("2026-10-02"), None, OpponentType::Bot)
                .unwrap()
                .is_empty()
        );
        assert!(get_game(&db, "bot").unwrap().is_bot);
    }

    fn sample_game() -> Game {
        Game {
            id: "lichess:abcdefgh".into(),
            source: "lichess".into(),
            external_game_id: Some("abcdefgh".into()),
            white_player: "Trainer".into(),
            black_player: "Opponent".into(),
            user_color: Some("white".into()),
            result: "white".into(),
            played_at: Some("2026-10-01T10:00:00Z".into()),
            time_control: None,
            speed: Some("rapid".into()),
            rated: None,
            eco: Some("C20".into()),
            opening_name: Some("King's Pawn Game".into()),
            pgn: "1. e4 e5 1-0".into(),
            review_status: false,
            is_bot: false,
            moves: vec![Move {
                id: "lichess:abcdefgh:1".into(),
                game_id: "lichess:abcdefgh".into(),
                ply: 1,
                san: "e4".into(),
                uci: "e2e4".into(),
                fen_before: "start".into(),
                fen_after: "after".into(),
            }],
        }
    }
    #[test]
    fn sync_checkpoint_and_games_commit_atomically_and_preserve_notes() {
        let mut db = Connection::open_in_memory().unwrap();
        crate::db::migrations::migrate(&db).unwrap();
        let checkpoint = || SyncCheckpoint {
            completed_through: None,
            pending: Some(SyncPending {
                since: None,
                until: 1700000000000,
                upper_bound: 1800000000000,
            }),
            read: 1,
            added: 0,
            unfinished_ids: vec![],
        };
        let saved =
            import_sync_batch(&mut db, "Trainer", vec![sample_game()], checkpoint()).unwrap();
        assert_eq!(saved.added, 1);
        save_annotation(&db, "lichess:abcdefgh", None, "keep note").unwrap();
        let repeated =
            import_sync_batch(&mut db, "trainer", vec![sample_game()], checkpoint()).unwrap();
        assert_eq!(repeated.added, 0);
        assert_eq!(
            annotations(&db, "lichess:abcdefgh").unwrap()[0].1,
            "keep note"
        );
        let before = get_setting(&db, "lichess_sync_v2:trainer").unwrap();
        let mut invalid = sample_game();
        invalid.id = "invalid".into();
        invalid.external_game_id = Some("invalid".into());
        invalid.moves[0].ply = 0;
        let result = import_sync_batch(
            &mut db,
            "Trainer",
            vec![invalid],
            SyncCheckpoint {
                completed_through: Some(1800000000000),
                pending: None,
                read: 2,
                added: 0,
                unfinished_ids: vec![],
            },
        );
        assert!(result.is_err());
        assert_eq!(get_setting(&db, "lichess_sync_v2:trainer").unwrap(), before);
        assert!(get_game(&db, "invalid").is_err());
        assert!(get_setting(&db, "lichess_sync_v2:opponent")
            .unwrap()
            .is_none());
    }
    #[test]
    fn sync_preserves_annotations_and_deduplicates() {
        let mut db = Connection::open_in_memory().unwrap();
        crate::db::migrations::migrate(&db).unwrap();
        assert_eq!(import_games(&mut db, vec![sample_game()]).unwrap(), 1);
        save_annotation(
            &db,
            "lichess:abcdefgh",
            Some("lichess:abcdefgh:1"),
            "critical note",
        )
        .unwrap();
        assert_eq!(import_games(&mut db, vec![sample_game()]).unwrap(), 0);
        assert_eq!(
            annotations(&db, "lichess:abcdefgh").unwrap()[0].1,
            "critical note"
        );
        let page = list_games(
            &db,
            GameFilter {
                opponent_type: OpponentType::Human,
                color: Some("white".into()),
                result: None,
                speed: None,
                reviewed: None,
                opening: None,
                limit: 25,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(get_game(&db, "lichess:abcdefgh").unwrap().moves.len(), 1)
    }
    #[test]
    fn due_queue_and_opening_stats() {
        let mut db = Connection::open_in_memory().unwrap();
        crate::db::migrations::migrate(&db).unwrap();
        import_games(&mut db, vec![sample_game()]).unwrap();
        let stat = opening_stats(&db, None, None, None, None, OpponentType::Human).unwrap();
        assert_eq!(stat[0]["wins"], 1);
        assert_eq!(stat[0]["scoreRate"], 1.0);
        let p = Puzzle {
            id: "p".into(),
            source_type: "manual".into(),
            source_game_id: Some("lichess:abcdefgh".into()),
            source_move_id: None,
            fen: "start".into(),
            side_to_move: "white".into(),
            title: "test".into(),
            description: "".into(),
            original_move: None,
            expected_moves: vec!["e2e4".into()],
            solution_line: vec![],
            error_category: None,
        };
        save_puzzle(&db, p).unwrap();
        assert_eq!(puzzles(&db, true).unwrap().len(), 1);
        let mut s = schedule(&db, "p").unwrap();
        s.due_at = "2099-01-01T00:00:00.000Z".into();
        record_review(
            &mut db,
            ReviewInput {
                schedule: s,
                played_move: Some("e2e4".into()),
                is_correct: true,
                rating: "Good".into(),
                time_spent_ms: 1000,
            },
        )
        .unwrap();
        assert!(puzzles(&db, true).unwrap().is_empty());
        let updated = schedule(&db, "p").unwrap();
        assert_eq!(updated.total_attempts, 1);
        assert_eq!(updated.correct_count, 1);
    }
}
pub fn engine_cache_get(
    db: &Connection,
    fen: &str,
    path: &str,
    version: &str,
    depth: u32,
) -> Result<Option<crate::engine::Analysis>, String> {
    let config = format!("multipv={}", crate::engine::MULTIPV);
    let json: Option<String> = db
        .query_row(
            "SELECT principal_variation FROM engine_analyses WHERE fen=?1 AND engine_name=?2 AND engine_version=?3 AND analysis_config=?4 AND depth=?5",
            params![fen, path, version, config, depth],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    json.map(|value| {
        let variations = serde_json::from_str(&value).map_err(err)?;
        crate::engine::Analysis::from_variations(fen, variations)
            .ok_or_else(|| "缓存缺少引擎评价".into())
    })
    .transpose()
}
pub fn engine_cache_save(
    db: &Connection,
    path: &str,
    version: &str,
    a: &crate::engine::Analysis,
) -> Result<(), String> {
    let variations = serde_json::to_string(&a.variations).map_err(err)?;
    let config = format!("multipv={}", crate::engine::MULTIPV);
    db.execute("INSERT OR REPLACE INTO engine_analyses(fen,engine_name,engine_version,analysis_config,depth,score_type,score_value,principal_variation) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",params![a.fen,path,version,config,a.depth,a.score_type,a.score_value,variations]).map_err(err)?;
    Ok(())
}
#[cfg(test)]
mod persistence_test {
    use super::*;
    #[test]
    fn engine_cache_preserves_three_variations_and_ignores_single_pv() {
        let db = Connection::open_in_memory().unwrap();
        crate::db::migrations::migrate(&db).unwrap();
        let fen = "start";
        db.execute("INSERT INTO engine_analyses(fen,engine_name,engine_version,analysis_config,depth,score_type,score_value,principal_variation) VALUES ('start','engine','v1','multipv=1',12,'cp',42,'[\"e2e4\"]')", []).unwrap();
        assert!(engine_cache_get(&db, fen, "engine", "v1", 12)
            .unwrap()
            .is_none());
        let variations = [
            "info depth 12 multipv 1 score cp 42 pv e2e4 e7e5",
            "info depth 12 multipv 2 score cp 30 pv d2d4 d7d5",
            "info depth 12 multipv 3 score cp 20 pv g1f3 g8f6",
        ]
        .iter()
        .map(|line| crate::engine::parse_info(line, "8/8/8/8/8/8/8/8 w - - 0 1").unwrap())
        .collect();
        let analysis = crate::engine::Analysis::from_variations(fen, variations).unwrap();
        engine_cache_save(&db, "engine", "v1", &analysis).unwrap();
        let cached = engine_cache_get(&db, fen, "engine", "v1", 12)
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(cached).unwrap(),
            serde_json::to_value(analysis).unwrap()
        );
    }
    #[test]
    fn note_survives_reopen() {
        let path =
            std::env::temp_dir().join(format!("chess-trainer-test-{}.db", std::process::id()));
        {
            let db = Connection::open(&path).unwrap();
            crate::db::migrations::migrate(&db).unwrap();
            db.execute("INSERT INTO games(id,source,white_player,black_player,result,pgn) VALUES ('g','local','A','B','draw','1. e4')",[]).unwrap();
            save_annotation(&db, "g", None, "persistent summary").unwrap();
        }
        {
            let db = Connection::open(&path).unwrap();
            crate::db::migrations::migrate(&db).unwrap();
            assert_eq!(annotations(&db, "g").unwrap()[0].1, "persistent summary");
        }
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
        let _ = std::fs::remove_file(path);
    }
}

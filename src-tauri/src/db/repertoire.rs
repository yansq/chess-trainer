use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub parent_id: Option<String>,
    pub uci: String,
    pub san: String,
    pub fen_before: String,
    pub fen_after: String,
    pub order: i64,
    pub disabled: bool,
    pub nags: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repertoire {
    pub id: String,
    pub name: String,
    pub side: String,
    pub initial_fen: String,
    pub nodes: Vec<Node>,
    pub notes: HashMap<String, String>,
    pub revision: i64,
}
#[derive(Serialize)]
pub struct Summary {
    id: String,
    name: String,
    side: String,
    count: usize,
    revision: i64,
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn get(db: &Connection, id: &str) -> Result<Repertoire, String> {
    let payload: String = db
        .query_row("SELECT payload FROM repertoires WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .map_err(|_| "开局库不存在".to_string())?;
    serde_json::from_str(&payload).map_err(error)
}
pub fn list(db: &Connection) -> Result<Vec<Summary>, String> {
    let mut s = db
        .prepare("SELECT payload FROM repertoires ORDER BY name,id")
        .map_err(error)?;
    let rows = s.query_map([], |r| r.get::<_, String>(0)).map_err(error)?;
    rows.map(|r| {
        let b: Repertoire = serde_json::from_str(&r.map_err(error)?).map_err(error)?;
        Ok(Summary {
            id: b.id,
            name: b.name,
            side: b.side,
            count: b.nodes.len(),
            revision: b.revision,
        })
    })
    .collect()
}
fn validate(book: &Repertoire) -> Result<(), String> {
    if book.id.is_empty()
        || book.name.trim().is_empty()
        || book.name.len() > 300
        || !["white", "black"].contains(&book.side.as_str())
        || book.initial_fen.split_whitespace().count() != 6
        || book.nodes.len() > 50000
        || book.notes.len() > 50001
    {
        return Err("开局库名称、执棋方、局面或容量无效".into());
    }
    let mut seen: HashMap<&str, &str> = HashMap::new();
    let mut edges = HashSet::new();
    for n in &book.nodes {
        let fen = match n.parent_id.as_deref() {
            Some(parent) => *seen.get(parent).ok_or("开局树父节点不存在或顺序无效")?,
            None => book.initial_fen.as_str(),
        };
        if n.id.is_empty()
            || seen.contains_key(n.id.as_str())
            || fen != n.fen_before
            || n.fen_after.split_whitespace().count() != 6
            || !(4..=5).contains(&n.uci.len())
            || n.san.is_empty()
            || (n.uci == "@fen" && n.parent_id.is_some())
            || !edges.insert((
                n.parent_id.clone(),
                n.uci.clone(),
                if n.uci == "@fen" {
                    n.fen_after
                        .split_whitespace()
                        .take(4)
                        .collect::<Vec<_>>()
                        .join(" ")
                } else {
                    String::new()
                },
            ))
        {
            return Err("开局树含重复、循环或不一致招法".into());
        }
        seen.insert(&n.id, &n.fen_after);
    }
    if book.notes.values().any(|n| n.len() > 2000000) {
        return Err("单个局面评注过长".into());
    }
    Ok(())
}
pub fn save(db: &Connection, mut book: Repertoire) -> Result<Repertoire, String> {
    validate(&book)?;
    book.name = book.name.trim().into();
    let tx = db.unchecked_transaction().map_err(error)?;
    let current: Option<i64> = tx
        .query_row(
            "SELECT revision FROM repertoires WHERE id=?1",
            [&book.id],
            |r| r.get(0),
        )
        .optional()
        .map_err(error)?;
    if current.unwrap_or(0) != book.revision || (current.is_none() && book.revision != 0) {
        return Err("开局库已在其他窗口更新，请重新打开后再编辑".into());
    }
    book.revision = book.revision.checked_add(1).ok_or("版本号超出范围")?;
    let payload = serde_json::to_string(&book).map_err(error)?;
    if payload.len() > 50_000_000 {
        return Err("开局库过大，请拆分保存".into());
    }
    tx.execute("INSERT INTO repertoires(id,name,payload,revision) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,revision=excluded.revision,updated_at=CURRENT_TIMESTAMP",params![book.id,book.name,payload,book.revision]).map_err(error)?;
    tx.commit().map_err(error)?;
    Ok(book)
}
pub fn add_move(
    db: &Connection,
    id: &str,
    revision: i64,
    node: Node,
    notes: HashMap<String, String>,
) -> Result<i64, String> {
    let mut book = get(db, id)?;
    if book.revision != revision {
        return Err("开局库已在其他窗口更新，请重新打开后再编辑".into());
    }
    book.nodes.push(node);
    book.notes.extend(notes);
    save(db, book).map(|saved| saved.revision)
}
pub fn delete(db: &Connection, id: &str, revision: i64) -> Result<(), String> {
    if db
        .execute(
            "DELETE FROM repertoires WHERE id=?1 AND revision=?2",
            params![id, revision],
        )
        .map_err(error)?
        != 1
    {
        return Err("开局库已更新或不存在，请重新打开后操作".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn book(id: &str) -> Repertoire {
        Repertoire {
            id: id.into(),
            name: "Anti Caro-Kann".into(),
            side: "white".into(),
            initial_fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".into(),
            nodes: vec![],
            notes: HashMap::new(),
            revision: 0,
        }
    }
    fn node(b: &Repertoire) -> Node {
        Node {
            id: "e4".into(),
            parent_id: None,
            uci: "e2e4".into(),
            san: "e4".into(),
            fen_before: b.initial_fen.clone(),
            fen_after: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1".into(),
            order: 0,
            disabled: false,
            nags: vec![],
        }
    }
    #[test]
    fn repertoire_persists_reopens_and_does_not_modify_game_or_puzzle_tables() {
        let path = std::env::temp_dir().join(format!(
            "chess-repertoire-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let db = Connection::open(&path).unwrap();
            crate::db::migrations::migrate(&db).unwrap();
            let mut b = book("one");
            b.nodes.push(node(&b));
            b.nodes[0].disabled = true;
            b.notes.insert("position".into(), "纯文本\n评注".into());
            let saved = save(&db, b).unwrap();
            assert_eq!(saved.revision, 1);
            let mut other = book("two");
            other.notes.insert("position".into(), "独立评注".into());
            save(&db, other).unwrap();
            assert_eq!(
                db.query_row("SELECT COUNT(*) FROM games", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                db.query_row("SELECT COUNT(*) FROM puzzles", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        {
            let db = Connection::open(&path).unwrap();
            crate::db::migrations::migrate(&db).unwrap();
            let b = get(&db, "one").unwrap();
            assert!(b.nodes[0].disabled);
            assert_eq!(b.notes["position"], "纯文本\n评注");
            assert_eq!(list(&db).unwrap().len(), 2);
            delete(&db, "one", b.revision).unwrap();
            assert!(get(&db, "one").is_err());
            assert_eq!(get(&db, "two").unwrap().notes["position"], "独立评注");
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn separate_analysis_roots_and_null_moves_persist_without_false_duplicate_edges() {
        let db = Connection::open_in_memory().unwrap();
        crate::db::migrations::migrate(&db).unwrap();
        let mut b = book("analysis");
        let mut first = node(&b);
        first.id = "setup-one".into();
        first.uci = "@fen".into();
        first.san = "分析起点".into();
        let mut second = first.clone();
        second.id = "setup-two".into();
        second.fen_after = b.initial_fen.replace(" w ", " b ");
        let mut pass = first.clone();
        pass.id = "null".into();
        pass.parent_id = Some(first.id.clone());
        pass.uci = "0000".into();
        pass.san = "--".into();
        pass.fen_before = first.fen_after.clone();
        pass.fen_after = first.fen_after.replace(" b ", " w ");
        b.nodes = vec![first.clone(), pass, second];
        let saved = save(&db, b).unwrap();
        assert_eq!(get(&db, &saved.id).unwrap().nodes.len(), 3);
        let mut duplicate = saved.clone();
        let mut root = first;
        root.id = "duplicate".into();
        duplicate.nodes.push(root);
        assert!(save(&db, duplicate).is_err());
        assert_eq!(get(&db, &saved.id).unwrap().revision, saved.revision);
    }
    #[test]
    fn incremental_move_save_preserves_notes_and_rejects_stale_or_duplicate_writes() {
        let db = Connection::open_in_memory().unwrap();
        crate::db::migrations::migrate(&db).unwrap();
        let mut b = book("delta");
        b.notes.insert("existing".into(), "keep".into());
        let saved = save(&db, b).unwrap();
        let revision = add_move(
            &db,
            &saved.id,
            saved.revision,
            node(&saved),
            HashMap::from([("draft".into(), "new note".into())]),
        )
        .unwrap();
        let updated = get(&db, &saved.id).unwrap();
        assert_eq!(revision, 2);
        assert_eq!(updated.nodes.len(), 1);
        assert_eq!(updated.notes["existing"], "keep");
        assert_eq!(updated.notes["draft"], "new note");
        assert!(add_move(&db, &saved.id, saved.revision, node(&saved), HashMap::new()).is_err());
        assert!(add_move(&db, &saved.id, revision, node(&saved), HashMap::new()).is_err());
        assert_eq!(get(&db, &saved.id).unwrap().revision, revision);
        db.execute_batch("CREATE TRIGGER fail_delta BEFORE UPDATE ON repertoires BEGIN SELECT RAISE(FAIL,'simulated failure'); END;").unwrap();
        let mut other = node(&saved);
        other.id = "different".into();
        other.uci = "d2d4".into();
        assert!(add_move(&db, &saved.id, revision, other, HashMap::new()).is_err());
        assert_eq!(get(&db, &saved.id).unwrap().nodes.len(), 1);
    }
    #[test]
    fn stale_windows_cannot_overwrite_or_delete_newer_versions() {
        let db = Connection::open_in_memory().unwrap();
        crate::db::migrations::migrate(&db).unwrap();
        let first = save(&db, book("one")).unwrap();
        let mut newer = first.clone();
        newer.name = "新名称".into();
        let newer = save(&db, newer).unwrap();
        assert!(save(&db, first.clone()).is_err());
        assert!(delete(&db, "one", first.revision).is_err());
        assert_eq!(get(&db, "one").unwrap().name, "新名称");
        delete(&db, "one", newer.revision).unwrap();
        assert!(save(&db, newer).is_err());
    }
    #[test]
    fn invalid_tree_and_failed_transactions_leave_the_original_unchanged() {
        let db = Connection::open_in_memory().unwrap();
        crate::db::migrations::migrate(&db).unwrap();
        let saved = save(&db, book("one")).unwrap();
        let mut invalid = saved.clone();
        let mut n = node(&saved);
        n.parent_id = Some("missing".into());
        invalid.nodes.push(n);
        assert!(save(&db, invalid).is_err());
        let mut duplicate = saved.clone();
        duplicate.nodes = vec![
            node(&saved),
            Node {
                id: "duplicate".into(),
                ..node(&saved)
            },
        ];
        assert!(save(&db, duplicate).is_err());
        db.execute_batch("CREATE TRIGGER fail_repertoire BEFORE UPDATE ON repertoires BEGIN SELECT RAISE(FAIL,'simulated failure'); END;").unwrap();
        let mut changed = saved;
        changed.name = "不应保存".into();
        assert!(save(&db, changed).is_err());
        assert_eq!(get(&db, "one").unwrap().revision, 1);
        assert_eq!(get(&db, "one").unwrap().name, "Anti Caro-Kann");
    }
}

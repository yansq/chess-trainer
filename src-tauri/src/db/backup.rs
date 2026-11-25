use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::db::migrations::CURRENT_SCHEMA_VERSION;
use crate::db::repertoire::{self, Repertoire};
use crate::db::repository::{ChessComCheckpoint, SyncCheckpoint};

pub const BACKUP_FORMAT_VERSION: u32 = 1;
const BACKUP_APP_ID: &str = "com.yansiqi.chesstrainer";
const MAX_BACKUP_BYTES: usize = 256 * 1024 * 1024;
const START_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

#[cfg(test)]
const INCLUDED_TABLES: &[&str] = &[
    "games",
    "moves",
    "annotations",
    "review_variations",
    "puzzles",
    "review_schedules",
    "review_logs",
    "repertoires",
    "app_settings",
];
#[cfg(test)]
const EXCLUDED_TABLES: &[&str] = &["engine_analyses"];

const PORTABLE_CONFIG_KEYS: &[&str] = &[
    "lichess_username",
    "chesscom_username",
    "engine_preanalysis_depth",
    "engine_position_depth",
    "engine_depth",
    "engine_threads",
    "engine_hash_mb",
    "loss_inaccuracy",
    "loss_mistake",
    "loss_blunder",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingScope {
    PortableConfig,
    PortableLichessSync,
    PortableChessComSync,
    MachineLocal,
    Forbidden,
    Unknown,
}

impl SettingScope {
    pub fn is_portable(self) -> bool {
        matches!(
            self,
            Self::PortableConfig | Self::PortableLichessSync | Self::PortableChessComSync
        )
    }
}

fn is_lowercase_username(suffix: &str, valid: fn(&str) -> bool) -> bool {
    valid(suffix) && suffix == suffix.to_ascii_lowercase()
}

pub fn classify_setting_key(key: &str) -> SettingScope {
    if key.to_ascii_lowercase().contains("token") {
        return SettingScope::Forbidden;
    }
    if key == "engine_path" {
        return SettingScope::MachineLocal;
    }
    if PORTABLE_CONFIG_KEYS.contains(&key) {
        return SettingScope::PortableConfig;
    }
    if let Some(suffix) = key.strip_prefix("lichess_sync_v2:") {
        if is_lowercase_username(suffix, crate::lichess::valid_username) {
            return SettingScope::PortableLichessSync;
        }
    }
    if let Some(suffix) = key.strip_prefix("chesscom_sync_v1:") {
        if is_lowercase_username(suffix, crate::chesscom::valid_username) {
            return SettingScope::PortableChessComSync;
        }
    }
    SettingScope::Unknown
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppearancePreference {
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SoundPreference {
    pub enabled: bool,
    pub volume: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientPreferences {
    pub appearance: AppearancePreference,
    pub sidebar_collapsed: bool,
    pub sound: SoundPreference,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCounts {
    pub games: usize,
    pub moves: usize,
    pub annotations: usize,
    pub review_variations: usize,
    pub puzzles: usize,
    pub review_schedules: usize,
    pub review_logs: usize,
    pub repertoires: usize,
    pub settings: usize,
}

impl BackupCounts {
    pub fn has_user_data(&self) -> bool {
        self.games > 0
            || self.annotations > 0
            || self.review_variations > 0
            || self.puzzles > 0
            || self.review_logs > 0
            || self.repertoires > 0
            || self.settings > 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BackupWarningCode {
    OverwritesExistingData,
    LichessTokenNotIncluded,
    EnginePathPreservedLocally,
    EngineCacheNotIncluded,
    AppVersionMismatch,
    MissingClientPreferences,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupWarning {
    pub code: BackupWarningCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupExport {
    pub filename: String,
    pub saved_path: String,
    pub exported_at: String,
    pub format_version: u32,
    pub db_schema_version: i64,
    pub counts: BackupCounts,
}

struct BackupSnapshot {
    stem: String,
    exported_at: String,
    counts: BackupCounts,
    payload_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInspection {
    pub format_version: u32,
    pub db_schema_version: i64,
    pub app_version: String,
    pub exported_at: String,
    pub backup_counts: BackupCounts,
    pub current_counts: BackupCounts,
    pub has_client_preferences: bool,
    pub warnings: Vec<BackupWarning>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreResult {
    pub restored_counts: BackupCounts,
    pub client_preferences: Option<ClientPreferences>,
    pub warnings: Vec<BackupWarning>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupHeaderProbe {
    app_id: Option<String>,
    format_version: Option<u32>,
    db_schema_version: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupEnvelopeV1 {
    app_id: String,
    format_version: u32,
    db_schema_version: i64,
    app_version: String,
    exported_at: String,
    #[serde(default)]
    client_preferences: Option<ClientPreferences>,
    database: BackupDatabaseV1,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupDatabaseV1 {
    games: Vec<BackupGameRow>,
    annotations: Vec<BackupAnnotationRow>,
    review_variations: Vec<BackupReviewVariationRow>,
    puzzles: Vec<BackupPuzzleRow>,
    review_schedules: Vec<BackupReviewScheduleRow>,
    review_logs: Vec<BackupReviewLogRow>,
    repertoires: Vec<BackupRepertoireRow>,
    app_settings: Vec<BackupSettingRow>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupMoveRow {
    id: String,
    ply: i64,
    san: String,
    uci: String,
    fen_before: String,
    fen_after: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupGameRow {
    id: String,
    source: String,
    external_game_id: Option<String>,
    white_player: String,
    black_player: String,
    user_color: Option<String>,
    result: String,
    played_at: Option<String>,
    time_control: Option<String>,
    speed: Option<String>,
    rated: Option<bool>,
    eco: Option<String>,
    opening_name: Option<String>,
    pgn: String,
    review_status: bool,
    reviewed_at: Option<String>,
    created_at: String,
    updated_at: String,
    last_synced_at: Option<String>,
    is_bot: bool,
    is_own_game: bool,
    moves: Vec<BackupMoveRow>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupAnnotationRow {
    id: String,
    game_id: String,
    move_id: Option<String>,
    content: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupReviewVariationRow {
    id: String,
    game_id: String,
    parent_id: Option<String>,
    ply: i64,
    san: String,
    uci: String,
    fen_before: String,
    fen_after: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupPuzzleRow {
    id: String,
    category: String,
    source_type: String,
    source_game_id: Option<String>,
    source_move_id: Option<String>,
    fen: String,
    side_to_move: String,
    title: String,
    description: String,
    original_move: Option<String>,
    expected_moves: Vec<String>,
    solution_line: Vec<String>,
    error_category: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupReviewScheduleRow {
    puzzle_id: String,
    due_at: String,
    interval_days: f64,
    ease_factor: f64,
    repetitions: i64,
    lapses: i64,
    last_reviewed_at: Option<String>,
    total_attempts: i64,
    correct_count: i64,
    stability: f64,
    difficulty: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupReviewLogRow {
    id: i64,
    puzzle_id: String,
    reviewed_at: String,
    played_move: Option<String>,
    is_correct: bool,
    rating: String,
    time_spent_ms: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupRepertoireRow {
    id: String,
    name: String,
    book: Repertoire,
    revision: i64,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupSettingRow {
    key: String,
    value: String,
}

mod validated {
    use super::*;

    pub(super) struct ValidatedBackup {
        envelope: BackupEnvelopeV1,
        counts: BackupCounts,
    }

    impl ValidatedBackup {
        pub(super) fn into_parts(self) -> (BackupEnvelopeV1, BackupCounts) {
            (self.envelope, self.counts)
        }

        pub(super) fn envelope(&self) -> &BackupEnvelopeV1 {
            &self.envelope
        }
    }

    pub(super) fn parse_and_validate(raw_json: &str) -> Result<ValidatedBackup, String> {
        if raw_json.trim().is_empty() {
            return Err("备份文件为空".into());
        }
        if raw_json.len() > MAX_BACKUP_BYTES {
            return Err("备份文件超过 256 MB 上限".into());
        }

        let envelope: BackupEnvelopeV1 = match serde_json::from_str(raw_json) {
            Ok(env) => env,
            Err(parse_err) => {
                let probe: BackupHeaderProbe = serde_json::from_str(raw_json)
                    .map_err(|_| "备份文件不是有效的 JSON 格式".to_string())?;
                validate_header(
                    probe.app_id.as_deref(),
                    probe.format_version,
                    probe.db_schema_version,
                )?;
                return Err(format!("备份文件内容校验失败：{parse_err}"));
            }
        };
        validate_header(
            Some(envelope.app_id.as_str()),
            Some(envelope.format_version),
            Some(envelope.db_schema_version),
        )?;

        if let Some(prefs) = &envelope.client_preferences {
            validate_client_preferences(prefs)?;
        }

        let (game_ids, move_game_map, game_first_fen) =
            validate_games_and_moves(&envelope.database.games)?;
        validate_annotations(&envelope.database.annotations, &game_ids, &move_game_map)?;
        validate_review_variations(
            &envelope.database.review_variations,
            &game_ids,
            &move_game_map,
            &game_first_fen,
        )?;
        validate_puzzles_and_reviews(&envelope.database, &game_ids, &move_game_map)?;
        validate_repertoires(&envelope.database.repertoires)?;
        validate_settings(&envelope.database.app_settings)?;

        let counts = count_from_envelope(&envelope);
        Ok(ValidatedBackup { envelope, counts })
    }
}

fn validate_header(
    app_id: Option<&str>,
    format_version: Option<u32>,
    db_schema_version: Option<i64>,
) -> Result<(), String> {
    if app_id != Some(BACKUP_APP_ID) {
        return Err("该文件不是 Chess Trainer 备份文件".into());
    }
    match format_version {
        Some(v) if v == BACKUP_FORMAT_VERSION => {}
        Some(v) if v > BACKUP_FORMAT_VERSION => {
            return Err(format!(
                "备份格式版本过高（v{v}），请升级 Chess Trainer 后再导入"
            ));
        }
        _ => return Err("备份文件缺少有效的格式版本号".into()),
    }
    match db_schema_version {
        Some(v) if v == CURRENT_SCHEMA_VERSION => {}
        Some(v) if v > CURRENT_SCHEMA_VERSION => {
            return Err(format!(
                "备份数据库版本过高（v{v}，当前支持 v{CURRENT_SCHEMA_VERSION}），请升级应用后再导入"
            ));
        }
        Some(v) => {
            return Err(format!(
                "备份数据库版本不兼容（v{v}，当前需要 v{CURRENT_SCHEMA_VERSION}）"
            ));
        }
        None => return Err("备份文件缺少数据库版本信息".into()),
    }
    Ok(())
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn validate_client_preferences(preferences: &ClientPreferences) -> Result<(), String> {
    if preferences.sound.volume > 100 {
        return Err("音量偏好须在 0～100 之间".into());
    }
    Ok(())
}

fn count_from_envelope(envelope: &BackupEnvelopeV1) -> BackupCounts {
    let db = &envelope.database;
    BackupCounts {
        games: db.games.len(),
        moves: db.games.iter().map(|g| g.moves.len()).sum(),
        annotations: db.annotations.len(),
        review_variations: db.review_variations.len(),
        puzzles: db.puzzles.len(),
        review_schedules: db.review_schedules.len(),
        review_logs: db.review_logs.len(),
        repertoires: db.repertoires.len(),
        settings: db.app_settings.len(),
    }
}

fn query_table_count(db: &Connection, table: &str) -> Result<usize, String> {
    let count: i64 = db
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .map_err(err)?;
    usize::try_from(count).map_err(err)
}

fn query_live_counts(db: &Connection) -> Result<BackupCounts, String> {
    let mut settings_stmt = db.prepare("SELECT key FROM app_settings").map_err(err)?;
    let setting_keys = settings_stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?;
    let mut settings = 0usize;
    for key in setting_keys {
        let key = key.map_err(err)?;
        if classify_setting_key(&key).is_portable() {
            settings += 1;
        }
    }

    Ok(BackupCounts {
        games: query_table_count(db, "games")?,
        moves: query_table_count(db, "moves")?,
        annotations: query_table_count(db, "annotations")?,
        review_variations: query_table_count(db, "review_variations")?,
        puzzles: query_table_count(db, "puzzles")?,
        review_schedules: query_table_count(db, "review_schedules")?,
        review_logs: query_table_count(db, "review_logs")?,
        repertoires: query_table_count(db, "repertoires")?,
        settings,
    })
}

fn collect_warnings(
    envelope: &BackupEnvelopeV1,
    current_counts: Option<&BackupCounts>,
) -> Vec<BackupWarning> {
    let mut warnings = Vec::new();
    if let Some(counts) = current_counts {
        if counts.has_user_data() {
            warnings.push(BackupWarning {
                code: BackupWarningCode::OverwritesExistingData,
                message: "恢复将清空并覆盖当前本地对局、笔记、题库、训练进度与开局库数据。".into(),
            });
        }
    }
    let has_lichess_user = envelope
        .database
        .app_settings
        .iter()
        .any(|s| s.key == "lichess_username" && !s.value.trim().is_empty());
    if has_lichess_user {
        warnings.push(BackupWarning {
            code: BackupWarningCode::LichessTokenNotIncluded,
            message: "出于安全原因，Lichess Token 保存在系统钥匙串中，不包含在备份文件内；更换设备后需重新填写。".into(),
        });
    }
    warnings.push(BackupWarning {
        code: BackupWarningCode::EnginePathPreservedLocally,
        message: "本机 Stockfish 可执行文件路径不会被备份覆盖，将保留当前设备配置。".into(),
    });
    if current_counts.is_some() {
        warnings.push(BackupWarning {
            code: BackupWarningCode::EngineCacheNotIncluded,
            message: "引擎分析缓存未包含在备份中，导入后首次打开对局将按需重新计算。".into(),
        });
    }
    let current_app_version = env!("CARGO_PKG_VERSION");
    if envelope.app_version != current_app_version {
        warnings.push(BackupWarning {
            code: BackupWarningCode::AppVersionMismatch,
            message: format!(
                "该备份由 Chess Trainer v{} 导出，当前应用版本为 v{}。",
                envelope.app_version, current_app_version
            ),
        });
    }
    if envelope.client_preferences.is_none() {
        warnings.push(BackupWarning {
            code: BackupWarningCode::MissingClientPreferences,
            message: "该备份未包含外观、侧栏与音效偏好，将保留当前界面设置。".into(),
        });
    }
    warnings
}

fn validate_games_and_moves<'a>(
    games: &'a [BackupGameRow],
) -> Result<(HashSet<&'a str>, HashMap<&'a str, (&'a str, i64, &'a str)>, HashMap<&'a str, &'a str>), String> {
    let mut game_ids = HashSet::new();
    let mut external_keys = HashSet::new();
    let mut move_ids = HashSet::new();
    let mut move_game_map = HashMap::new();
    let mut game_first_fen = HashMap::new();

    for game in games {
        if game.id.trim().is_empty() || game.source.trim().is_empty() {
            return Err("备份中的对局记录缺少有效标识".into());
        }
        if !game_ids.insert(game.id.as_str()) {
            return Err(format!("备份中包含重复的对局 ID：{}", game.id));
        }
        if let Some(ext) = &game.external_game_id {
            if !external_keys.insert((game.source.as_str(), ext.as_str())) {
                return Err(format!("备份中包含重复的外部对局标识：{}:{ext}", game.source));
            }
        }
        if let Some(color) = &game.user_color {
            if !matches!(color.as_str(), "white" | "black") {
                return Err(format!("备份中的执棋方无效：{color}"));
            }
        }
        if !matches!(game.result.as_str(), "white" | "black" | "draw" | "unknown") {
            return Err(format!("备份中的对局结果无效：{}", game.result));
        }

        let mut plies = HashSet::new();
        let mut first_move: Option<(i64, &'a str)> = None;
        for mv in &game.moves {
            if mv.id.trim().is_empty() || mv.ply <= 0 {
                return Err(format!("对局 {} 包含无效招法记录", game.id));
            }
            if !move_ids.insert(mv.id.as_str()) {
                return Err(format!("备份中包含重复的招法 ID：{}", mv.id));
            }
            if !plies.insert(mv.ply) {
                return Err(format!("对局 {} 包含重复的步数 ply={}", game.id, mv.ply));
            }
            move_game_map.insert(mv.id.as_str(), (game.id.as_str(), mv.ply, mv.fen_after.as_str()));
            if first_move.is_none_or(|(min_ply, _)| mv.ply < min_ply) {
                first_move = Some((mv.ply, mv.fen_before.as_str()));
            }
        }
        game_first_fen.insert(
            game.id.as_str(),
            first_move.map(|(_, fen)| fen).unwrap_or(START_FEN),
        );
    }

    Ok((game_ids, move_game_map, game_first_fen))
}

fn validate_annotations(
    annotations: &[BackupAnnotationRow],
    game_ids: &HashSet<&str>,
    move_game_map: &HashMap<&str, (&str, i64, &str)>,
) -> Result<(), String> {
    let mut ann_ids = HashSet::new();
    let mut ann_targets = HashSet::new();
    for ann in annotations {
        if ann.id.trim().is_empty() || !ann_ids.insert(ann.id.as_str()) {
            return Err("备份中的笔记 ID 无效或重复".into());
        }
        if !game_ids.contains(ann.game_id.as_str()) {
            return Err(format!("笔记 {} 引用了不存在的对局 {}", ann.id, ann.game_id));
        }
        if let Some(move_id) = &ann.move_id {
            let Some((move_game_id, _, _)) = move_game_map.get(move_id.as_str()) else {
                return Err(format!("笔记 {} 引用了不存在的招法 {move_id}", ann.id));
            };
            if *move_game_id != ann.game_id {
                return Err(format!("笔记 {} 跨对局引用了招法 {move_id}", ann.id));
            }
        }
        if !ann_targets.insert((ann.game_id.as_str(), ann.move_id.as_deref().unwrap_or(""))) {
            return Err(format!("对局 {} 存在重复的目标笔记", ann.game_id));
        }
    }
    Ok(())
}

fn variations_in_parent_order(
    variations: &[BackupReviewVariationRow],
) -> Vec<&BackupReviewVariationRow> {
    let mut ordered: Vec<&BackupReviewVariationRow> = variations.iter().collect();
    ordered.sort_by(|a, b| {
        a.game_id
            .cmp(&b.game_id)
            .then(a.ply.cmp(&b.ply))
            .then(a.id.cmp(&b.id))
    });
    ordered
}

fn validate_review_variations(
    variations: &[BackupReviewVariationRow],
    game_ids: &HashSet<&str>,
    move_game_map: &HashMap<&str, (&str, i64, &str)>,
    game_first_fen: &HashMap<&str, &str>,
) -> Result<(), String> {
    let mut var_ids = HashSet::new();
    for v in variations {
        if !v.id.starts_with("variation:") || !var_ids.insert(v.id.as_str()) {
            return Err(format!("复盘分支 ID 无效或重复：{}", v.id));
        }
        if v.ply <= 0 || !game_ids.contains(v.game_id.as_str()) {
            return Err(format!("复盘分支 {} 步数或所属对局无效", v.id));
        }
        if v.parent_id.as_deref() == Some(v.id.as_str()) {
            return Err(format!("复盘分支 {} 不能将自身作为父节点", v.id));
        }
    }

    let ordered = variations_in_parent_order(variations);

    let mut validated_vars: HashMap<&str, (&str, i64, &str)> = HashMap::new();
    for v in ordered {
        match &v.parent_id {
            None => {
                let first_fen = *game_first_fen
                    .get(v.game_id.as_str())
                    .ok_or_else(|| format!("复盘分支 {} 所属对局不存在", v.id))?;
                if v.ply != 1 || v.fen_before != first_fen {
                    return Err(format!("复盘分支 {} 根局面与首步不一致", v.id));
                }
            }
            Some(pid) => {
                let parent = move_game_map
                    .get(pid.as_str())
                    .copied()
                    .or_else(|| validated_vars.get(pid.as_str()).copied());
                let Some((parent_game, parent_ply, parent_fen_after)) = parent else {
                    return Err(format!("复盘分支 {} 的父节点不存在或存在循环引用", v.id));
                };
                if parent_game != v.game_id {
                    return Err(format!("复盘分支 {} 跨对局引用父节点 {pid}", v.id));
                }
                if v.ply != parent_ply + 1 || v.fen_before != parent_fen_after {
                    return Err(format!("复盘分支 {} 与父节点步数或局面不一致", v.id));
                }
            }
        }
        validated_vars.insert(v.id.as_str(), (v.game_id.as_str(), v.ply, v.fen_after.as_str()));
    }
    Ok(())
}

fn validate_puzzles_and_reviews(
    db: &BackupDatabaseV1,
    game_ids: &HashSet<&str>,
    move_game_map: &HashMap<&str, (&str, i64, &str)>,
) -> Result<(), String> {
    let mut puzzle_ids = HashSet::new();
    let mut auto_sources = HashSet::new();
    for p in &db.puzzles {
        if p.id.trim().is_empty() || !puzzle_ids.insert(p.id.as_str()) {
            return Err("备份中的题目 ID 无效或重复".into());
        }
        if !matches!(
            p.category.as_str(),
            "opening" | "tactics" | "endgame" | "other"
        ) {
            return Err(format!("题目 {} 分类无效：{}", p.id, p.category));
        }
        if !matches!(p.source_type.as_str(), "manual" | "auto") {
            return Err(format!("题目 {} 来源类型无效：{}", p.id, p.source_type));
        }
        if !matches!(p.side_to_move.as_str(), "white" | "black") {
            return Err(format!("题目 {} 执棋方无效：{}", p.id, p.side_to_move));
        }
        if let Some(gid) = &p.source_game_id {
            if !game_ids.contains(gid.as_str()) {
                return Err(format!("题目 {} 引用了不存在的对局 {gid}", p.id));
            }
        }
        if let Some(mid) = &p.source_move_id {
            let Some((move_game_id, _, _)) = move_game_map.get(mid.as_str()) else {
                return Err(format!("题目 {} 引用了不存在的招法 {mid}", p.id));
            };
            if p.source_game_id.as_deref() != Some(*move_game_id) {
                return Err(format!("题目 {} 的来源对局与招法不一致", p.id));
            }
        }
        if p.source_type == "auto" {
            if let (Some(gid), Some(mid)) = (&p.source_game_id, &p.source_move_id) {
                if !auto_sources.insert((gid.as_str(), mid.as_str())) {
                    return Err(format!("自动生成题目存在重复来源：{gid}/{mid}"));
                }
            }
        }
    }

    let mut schedule_puzzles = HashSet::new();
    for s in &db.review_schedules {
        if !puzzle_ids.contains(s.puzzle_id.as_str()) {
            return Err(format!("复习计划引用了不存在的题目 {}", s.puzzle_id));
        }
        if !schedule_puzzles.insert(s.puzzle_id.as_str()) {
            return Err(format!("题目 {} 存在重复复习计划", s.puzzle_id));
        }
        if !(s.interval_days.is_finite()
            && s.ease_factor.is_finite()
            && s.stability.is_finite()
            && s.difficulty.is_finite())
        {
            return Err(format!("题目 {} 的复习计划数值无效", s.puzzle_id));
        }
    }
    if schedule_puzzles.len() != puzzle_ids.len() {
        return Err("部分题目缺少对应的复习计划".into());
    }

    let mut log_ids = HashSet::new();
    for log in &db.review_logs {
        if log.id <= 0 || !log_ids.insert(log.id) {
            return Err(format!("训练记录 ID 无效或重复：{}", log.id));
        }
        if !puzzle_ids.contains(log.puzzle_id.as_str()) {
            return Err(format!("训练记录 {} 引用了不存在的题目 {}", log.id, log.puzzle_id));
        }
        if log.time_spent_ms < 0 {
            return Err(format!("训练记录 {} 的耗时无效", log.id));
        }
    }
    Ok(())
}

fn validate_repertoires(repertoires: &[BackupRepertoireRow]) -> Result<(), String> {
    let mut rep_ids = HashSet::new();
    for row in repertoires {
        if row.id.trim().is_empty() || !rep_ids.insert(row.id.as_str()) {
            return Err("备份中的开局库 ID 无效或重复".into());
        }
        if row.id != row.book.id
            || row.name != row.book.name.trim()
            || row.revision != row.book.revision
        {
            return Err(format!("开局库 {} 的元数据与内容不一致", row.id));
        }
        repertoire::validate(&row.book)?;
    }
    Ok(())
}

fn validate_settings(settings: &[BackupSettingRow]) -> Result<(), String> {
    let mut keys = HashSet::new();
    for row in settings {
        if !keys.insert(row.key.as_str()) {
            return Err(format!("备份中包含重复的设置项：{}", row.key));
        }
        match classify_setting_key(&row.key) {
            SettingScope::PortableConfig => {}
            SettingScope::PortableLichessSync => {
                serde_json::from_str::<SyncCheckpoint>(&row.value)
                    .map_err(|e| format!("Lichess 同步进度 {} 格式无效：{e}", row.key))?;
            }
            SettingScope::PortableChessComSync => {
                serde_json::from_str::<ChessComCheckpoint>(&row.value)
                    .map_err(|e| format!("Chess.com 同步进度 {} 格式无效：{e}", row.key))?;
            }
            SettingScope::Forbidden => {
                return Err(format!("备份文件包含禁止导入的凭据字段：{}", row.key));
            }
            SettingScope::MachineLocal => {
                return Err(format!("备份文件包含本机路径设置：{}", row.key));
            }
            SettingScope::Unknown => {
                return Err(format!("备份文件包含未识别的设置项：{}", row.key));
            }
        }
    }
    Ok(())
}

fn export_snapshot(
    db: &Connection,
    app_version: &str,
    preferences: ClientPreferences,
) -> Result<BackupSnapshot, String> {
    validate_client_preferences(&preferences)?;
    let tx = db.unchecked_transaction().map_err(err)?;

    let (exported_at, file_stamp): (String, String) = tx
        .query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y%m%d-%H%M%SZ', 'now')",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;

    let mut moves_by_game: HashMap<String, Vec<BackupMoveRow>> = HashMap::new();
    {
        let mut stmt = tx
            .prepare("SELECT id,game_id,ply,san,uci,fen_before,fen_after FROM moves ORDER BY game_id,ply,id")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(1)?,
                    BackupMoveRow {
                        id: r.get(0)?,
                        ply: r.get(2)?,
                        san: r.get(3)?,
                        uci: r.get(4)?,
                        fen_before: r.get(5)?,
                        fen_after: r.get(6)?,
                    },
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (game_id, mv) = row.map_err(err)?;
            moves_by_game.entry(game_id).or_default().push(mv);
        }
    }

    let games = {
        let mut stmt = tx
            .prepare("SELECT id,source,external_game_id,white_player,black_player,user_color,result,played_at,time_control,speed,rated,eco,opening_name,pgn,review_status,reviewed_at,created_at,updated_at,last_synced_at,is_bot,is_own_game FROM games ORDER BY id")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                let id: String = r.get(0)?;
                Ok(BackupGameRow {
                    moves: moves_by_game.remove(&id).unwrap_or_default(),
                    id,
                    source: r.get(1)?,
                    external_game_id: r.get(2)?,
                    white_player: r.get(3)?,
                    black_player: r.get(4)?,
                    user_color: r.get(5)?,
                    result: r.get(6)?,
                    played_at: r.get(7)?,
                    time_control: r.get(8)?,
                    speed: r.get(9)?,
                    rated: r.get(10)?,
                    eco: r.get(11)?,
                    opening_name: r.get(12)?,
                    pgn: r.get(13)?,
                    review_status: r.get(14)?,
                    reviewed_at: r.get(15)?,
                    created_at: r.get(16)?,
                    updated_at: r.get(17)?,
                    last_synced_at: r.get(18)?,
                    is_bot: r.get(19)?,
                    is_own_game: r.get(20)?,
                })
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
    };

    let annotations = {
        let mut stmt = tx
            .prepare("SELECT id,game_id,move_id,content,created_at,updated_at FROM annotations ORDER BY game_id,id")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(BackupAnnotationRow {
                    id: r.get(0)?,
                    game_id: r.get(1)?,
                    move_id: r.get(2)?,
                    content: r.get(3)?,
                    created_at: r.get(4)?,
                    updated_at: r.get(5)?,
                })
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
    };

    let review_variations = {
        let mut stmt = tx
            .prepare("SELECT id,game_id,parent_id,ply,san,uci,fen_before,fen_after,content FROM review_variations ORDER BY game_id,ply,id")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(BackupReviewVariationRow {
                    id: r.get(0)?,
                    game_id: r.get(1)?,
                    parent_id: r.get(2)?,
                    ply: r.get(3)?,
                    san: r.get(4)?,
                    uci: r.get(5)?,
                    fen_before: r.get(6)?,
                    fen_after: r.get(7)?,
                    content: r.get(8)?,
                })
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
    };

    let puzzles = {
        let mut stmt = tx
            .prepare("SELECT id,category,source_type,source_game_id,source_move_id,fen,side_to_move,title,description,original_move,expected_moves,solution_line,error_category,created_at,updated_at FROM puzzles ORDER BY id")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                let expected_raw: String = r.get(10)?;
                let solution_raw: String = r.get(11)?;
                let expected_moves: Vec<String> = serde_json::from_str(&expected_raw)
                    .map_err(|e| rusqlite::Error::FromSqlConversionFailure(10, rusqlite::types::Type::Text, Box::new(e)))?;
                let solution_line: Vec<String> = serde_json::from_str(&solution_raw)
                    .map_err(|e| rusqlite::Error::FromSqlConversionFailure(11, rusqlite::types::Type::Text, Box::new(e)))?;
                Ok(BackupPuzzleRow {
                    id: r.get(0)?,
                    category: r.get(1)?,
                    source_type: r.get(2)?,
                    source_game_id: r.get(3)?,
                    source_move_id: r.get(4)?,
                    fen: r.get(5)?,
                    side_to_move: r.get(6)?,
                    title: r.get(7)?,
                    description: r.get(8)?,
                    original_move: r.get(9)?,
                    expected_moves,
                    solution_line,
                    error_category: r.get(12)?,
                    created_at: r.get(13)?,
                    updated_at: r.get(14)?,
                })
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
    };

    let review_schedules = {
        let mut stmt = tx
            .prepare("SELECT puzzle_id,due_at,interval_days,ease_factor,repetitions,lapses,last_reviewed_at,total_attempts,correct_count,stability,difficulty FROM review_schedules ORDER BY puzzle_id")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(BackupReviewScheduleRow {
                    puzzle_id: r.get(0)?,
                    due_at: r.get(1)?,
                    interval_days: r.get(2)?,
                    ease_factor: r.get(3)?,
                    repetitions: r.get(4)?,
                    lapses: r.get(5)?,
                    last_reviewed_at: r.get(6)?,
                    total_attempts: r.get(7)?,
                    correct_count: r.get(8)?,
                    stability: r.get(9)?,
                    difficulty: r.get(10)?,
                })
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
    };

    let review_logs = {
        let mut stmt = tx
            .prepare("SELECT id,puzzle_id,reviewed_at,played_move,is_correct,rating,time_spent_ms FROM review_logs ORDER BY id")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(BackupReviewLogRow {
                    id: r.get(0)?,
                    puzzle_id: r.get(1)?,
                    reviewed_at: r.get(2)?,
                    played_move: r.get(3)?,
                    is_correct: r.get(4)?,
                    rating: r.get(5)?,
                    time_spent_ms: r.get(6)?,
                })
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
    };

    let repertoires = {
        let mut stmt = tx
            .prepare("SELECT id,name,payload,revision,updated_at FROM repertoires ORDER BY id")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })
            .map_err(err)?;
        let mut out = Vec::new();
        for row in rows {
            let (id, name, payload, revision, updated_at) = row.map_err(err)?;
            let book: Repertoire = serde_json::from_str(&payload).map_err(err)?;
            out.push(BackupRepertoireRow {
                id,
                name,
                book,
                revision,
                updated_at,
            });
        }
        out
    };

    let app_settings = {
        let mut stmt = tx
            .prepare("SELECT key,value FROM app_settings ORDER BY key")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?;
        let mut out = Vec::new();
        for row in rows {
            let (key, value) = row.map_err(err)?;
            if classify_setting_key(&key).is_portable() {
                out.push(BackupSettingRow { key, value });
            }
        }
        out
    };

    tx.finish().map_err(err)?;

    let envelope = BackupEnvelopeV1 {
        app_id: BACKUP_APP_ID.to_string(),
        format_version: BACKUP_FORMAT_VERSION,
        db_schema_version: CURRENT_SCHEMA_VERSION,
        app_version: app_version.to_string(),
        exported_at: exported_at.clone(),
        client_preferences: Some(preferences),
        database: BackupDatabaseV1 {
            games,
            annotations,
            review_variations,
            puzzles,
            review_schedules,
            review_logs,
            repertoires,
            app_settings,
        },
    };
    let counts = count_from_envelope(&envelope);
    let payload_json = serde_json::to_string(&envelope).map_err(err)?;
    if payload_json.len() > MAX_BACKUP_BYTES {
        return Err("导出数据超过 256 MB 上限".into());
    }

    Ok(BackupSnapshot {
        stem: format!("chess-trainer-backup-{file_stamp}"),
        exported_at,
        counts,
        payload_json,
    })
}

static TEMP_FILE_SEQ: AtomicU64 = AtomicU64::new(0);

struct TempFileGuard(PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn create_temp_file(target_dir: &Path) -> Result<(std::fs::File, TempFileGuard), String> {
    let pid = std::process::id();
    for _ in 0..64 {
        let seq = TEMP_FILE_SEQ.fetch_add(1, Ordering::Relaxed);
        let tmp_path = target_dir.join(format!(".chess-trainer-backup.{pid}.{seq}.tmp"));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
        {
            Ok(file) => return Ok((file, TempFileGuard(tmp_path))),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("创建临时备份文件失败：{e}")),
        }
    }
    Err("创建临时备份文件失败：重试次数过多".into())
}

fn write_backup_atomically(
    target_dir: &Path,
    stem: &str,
    payload_json: &str,
) -> Result<(String, PathBuf), String> {
    std::fs::create_dir_all(target_dir).map_err(|e| format!("创建导出目录失败：{e}"))?;
    let (mut file, guard) = create_temp_file(target_dir)?;
    file.write_all(payload_json.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("写入备份文件失败：{e}"))?;
    drop(file);

    for idx in 0..10_000u32 {
        let filename = if idx == 0 {
            format!("{stem}.json")
        } else {
            format!("{stem}-{idx}.json")
        };
        let dest_path = target_dir.join(&filename);
        match std::fs::hard_link(&guard.0, &dest_path) {
            Ok(()) => return Ok((filename, dest_path)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("写入备份文件失败：{e}")),
        }
    }
    Err("生成唯一备份文件名失败：目标目录同名文件过多".into())
}

pub fn export_to_dir(
    db: &Connection,
    app_version: &str,
    preferences: ClientPreferences,
    target_dir: &Path,
) -> Result<BackupExport, String> {
    let snapshot = export_snapshot(db, app_version, preferences)?;
    let (filename, dest_path) =
        write_backup_atomically(target_dir, &snapshot.stem, &snapshot.payload_json)?;

    Ok(BackupExport {
        filename,
        saved_path: dest_path.to_string_lossy().into_owned(),
        exported_at: snapshot.exported_at,
        format_version: BACKUP_FORMAT_VERSION,
        db_schema_version: CURRENT_SCHEMA_VERSION,
        counts: snapshot.counts,
    })
}

pub fn inspect(db: &Connection, raw_json: &str) -> Result<BackupInspection, String> {
    let validated = validated::parse_and_validate(raw_json)?;
    let current_counts = query_live_counts(db)?;
    let warnings = collect_warnings(validated.envelope(), Some(&current_counts));
    let (envelope, backup_counts) = validated.into_parts();
    Ok(BackupInspection {
        format_version: envelope.format_version,
        db_schema_version: envelope.db_schema_version,
        app_version: envelope.app_version,
        exported_at: envelope.exported_at,
        backup_counts,
        current_counts,
        has_client_preferences: envelope.client_preferences.is_some(),
        warnings,
    })
}

pub fn import(db: &mut Connection, raw_json: &str) -> Result<BackupRestoreResult, String> {
    let validated = validated::parse_and_validate(raw_json)?;
    let warnings = collect_warnings(validated.envelope(), None);
    let (envelope, restored_counts) = validated.into_parts();
    db.execute_batch("PRAGMA foreign_keys=ON;").map_err(err)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;

    tx.execute_batch(
        "DELETE FROM review_logs;
         DELETE FROM review_schedules;
         DELETE FROM puzzles;
         DELETE FROM review_variations;
         DELETE FROM annotations;
         DELETE FROM moves;
         DELETE FROM games;
         DELETE FROM repertoires;
         DELETE FROM sqlite_sequence WHERE name='review_logs';",
    )
    .map_err(err)?;

    {
        let existing_keys: Vec<String> = {
            let mut stmt = tx.prepare("SELECT key FROM app_settings").map_err(err)?;
            let rows = stmt.query_map([], |r| r.get(0)).map_err(err)?;
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
        };
        let mut del_stmt = tx
            .prepare("DELETE FROM app_settings WHERE key=?1")
            .map_err(err)?;
        for key in existing_keys {
            if classify_setting_key(&key) != SettingScope::MachineLocal {
                del_stmt.execute([key]).map_err(err)?;
            }
        }
    }

    let data = &envelope.database;
    {
        let mut game_stmt = tx
            .prepare("INSERT INTO games(id,source,external_game_id,white_player,black_player,user_color,result,played_at,time_control,speed,rated,eco,opening_name,pgn,review_status,reviewed_at,created_at,updated_at,last_synced_at,is_bot,is_own_game) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)")
            .map_err(err)?;
        let mut move_stmt = tx
            .prepare("INSERT INTO moves(id,game_id,ply,san,uci,fen_before,fen_after) VALUES (?1,?2,?3,?4,?5,?6,?7)")
            .map_err(err)?;
        for g in &data.games {
            game_stmt
                .execute(params![
                    g.id,
                    g.source,
                    g.external_game_id,
                    g.white_player,
                    g.black_player,
                    g.user_color,
                    g.result,
                    g.played_at,
                    g.time_control,
                    g.speed,
                    g.rated,
                    g.eco,
                    g.opening_name,
                    g.pgn,
                    g.review_status,
                    g.reviewed_at,
                    g.created_at,
                    g.updated_at,
                    g.last_synced_at,
                    g.is_bot,
                    g.is_own_game,
                ])
                .map_err(err)?;
            for mv in &g.moves {
                move_stmt
                    .execute(params![
                        mv.id,
                        g.id,
                        mv.ply,
                        mv.san,
                        mv.uci,
                        mv.fen_before,
                        mv.fen_after,
                    ])
                    .map_err(err)?;
            }
        }
    }

    {
        let mut ann_stmt = tx
            .prepare("INSERT INTO annotations(id,game_id,move_id,content,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6)")
            .map_err(err)?;
        for a in &data.annotations {
            ann_stmt
                .execute(params![
                    a.id,
                    a.game_id,
                    a.move_id,
                    a.content,
                    a.created_at,
                    a.updated_at,
                ])
                .map_err(err)?;
        }
    }

    {
        let ordered_vars = variations_in_parent_order(&data.review_variations);
        let mut var_stmt = tx
            .prepare("INSERT INTO review_variations(id,game_id,parent_id,ply,san,uci,fen_before,fen_after,content) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)")
            .map_err(err)?;
        for v in ordered_vars {
            var_stmt
                .execute(params![
                    v.id,
                    v.game_id,
                    v.parent_id,
                    v.ply,
                    v.san,
                    v.uci,
                    v.fen_before,
                    v.fen_after,
                    v.content,
                ])
                .map_err(err)?;
        }
    }

    {
        let mut puzzle_stmt = tx
            .prepare("INSERT INTO puzzles(id,category,source_type,source_game_id,source_move_id,fen,side_to_move,title,description,original_move,expected_moves,solution_line,error_category,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)")
            .map_err(err)?;
        for p in &data.puzzles {
            let expected_json = serde_json::to_string(&p.expected_moves).map_err(err)?;
            let solution_json = serde_json::to_string(&p.solution_line).map_err(err)?;
            puzzle_stmt
                .execute(params![
                    p.id,
                    p.category,
                    p.source_type,
                    p.source_game_id,
                    p.source_move_id,
                    p.fen,
                    p.side_to_move,
                    p.title,
                    p.description,
                    p.original_move,
                    expected_json,
                    solution_json,
                    p.error_category,
                    p.created_at,
                    p.updated_at,
                ])
                .map_err(err)?;
        }
    }

    {
        let mut sched_stmt = tx
            .prepare("INSERT INTO review_schedules(puzzle_id,due_at,interval_days,ease_factor,repetitions,lapses,last_reviewed_at,total_attempts,correct_count,stability,difficulty) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)")
            .map_err(err)?;
        for s in &data.review_schedules {
            sched_stmt
                .execute(params![
                    s.puzzle_id,
                    s.due_at,
                    s.interval_days,
                    s.ease_factor,
                    s.repetitions,
                    s.lapses,
                    s.last_reviewed_at,
                    s.total_attempts,
                    s.correct_count,
                    s.stability,
                    s.difficulty,
                ])
                .map_err(err)?;
        }
    }

    {
        let mut log_stmt = tx
            .prepare("INSERT INTO review_logs(id,puzzle_id,reviewed_at,played_move,is_correct,rating,time_spent_ms) VALUES (?1,?2,?3,?4,?5,?6,?7)")
            .map_err(err)?;
        for l in &data.review_logs {
            log_stmt
                .execute(params![
                    l.id,
                    l.puzzle_id,
                    l.reviewed_at,
                    l.played_move,
                    l.is_correct,
                    l.rating,
                    l.time_spent_ms,
                ])
                .map_err(err)?;
        }
    }

    {
        let mut rep_stmt = tx
            .prepare("INSERT INTO repertoires(id,name,payload,revision,updated_at) VALUES (?1,?2,?3,?4,?5)")
            .map_err(err)?;
        for r in &data.repertoires {
            let payload = serde_json::to_string(&r.book).map_err(err)?;
            rep_stmt
                .execute(params![r.id, r.name, payload, r.revision, r.updated_at])
                .map_err(err)?;
        }
    }

    {
        let mut set_stmt = tx
            .prepare("INSERT INTO app_settings(key,value) VALUES (?1,?2)")
            .map_err(err)?;
        for s in &data.app_settings {
            set_stmt.execute(params![s.key, s.value]).map_err(err)?;
        }
    }

    {
        let mut fk_stmt = tx.prepare("PRAGMA foreign_key_check").map_err(err)?;
        let mut fk_rows = fk_stmt.query([]).map_err(err)?;
        if fk_rows.next().map_err(err)?.is_some() {
            return Err("恢复后外键完整性校验失败，已回滚所有更改".into());
        }
    }

    tx.commit().map_err(err)?;
    let _ = db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");

    Ok(BackupRestoreResult {
        restored_counts,
        client_preferences: envelope.client_preferences,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrate;
    use crate::db::repertoire::{self, Node};

    fn sample_prefs() -> ClientPreferences {
        ClientPreferences {
            appearance: AppearancePreference::Dark,
            sidebar_collapsed: true,
            sound: SoundPreference {
                enabled: true,
                volume: 65,
            },
        }
    }

    fn populate_full_fixture(db: &mut Connection) {
        db.execute(
            "INSERT INTO games(id,source,external_game_id,white_player,black_player,user_color,result,played_at,time_control,speed,rated,eco,opening_name,pgn,review_status,reviewed_at,created_at,updated_at,last_synced_at,is_bot,is_own_game)
             VALUES ('g1','lichess','ext1','Alice','Bob','white','white','2026-10-01T10:00:00Z','600+0','rapid',1,'B00','Caro-Kann','1. e4 c6 1-0',1,'2026-10-02T00:00:00Z','2026-10-01T10:05:00Z','2026-10-02T00:00:00Z','2026-10-01T10:05:00Z',0,1)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO moves(id,game_id,ply,san,uci,fen_before,fen_after)
             VALUES ('g1:1','g1',1,'e4','e2e4',?1,'fen_after_1'),
                    ('g1:2','g1',2,'c6','c7c6','fen_after_1','fen_after_2')",
            [START_FEN],
        )
        .unwrap();
        db.execute(
            "INSERT INTO annotations(id,game_id,move_id,content,created_at,updated_at)
             VALUES ('g1:summary','g1',NULL,'Good opening','2026-10-02T00:00:00Z','2026-10-02T00:00:00Z'),
                    ('g1:g1:1','g1','g1:1','Mainline e4','2026-10-02T00:00:00Z','2026-10-02T00:00:00Z')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO review_variations(id,game_id,parent_id,ply,san,uci,fen_before,fen_after,content)
             VALUES ('variation:1','g1',NULL,1,'d4','d2d4',?1,'var_fen_1','Try d4'),
                    ('variation:2','g1','variation:1',2,'d5','d7d5','var_fen_1','var_fen_2','Reply d5')",
            [START_FEN],
        )
        .unwrap();
        db.execute(
            "INSERT INTO puzzles(id,category,source_type,source_game_id,source_move_id,fen,side_to_move,title,description,original_move,expected_moves,solution_line,error_category,created_at,updated_at)
             VALUES ('p1','opening','auto','g1','g1:2','fen_after_1','black','Caro-Kann · 1','Find c6','e7e5','[\"c7c6\"]','[\"c7c6\"]','mistake','2026-10-02T00:00:00Z','2026-10-02T00:00:00Z')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO review_schedules(puzzle_id,due_at,interval_days,ease_factor,repetitions,lapses,last_reviewed_at,total_attempts,correct_count,stability,difficulty)
             VALUES ('p1','2026-10-10T00:00:00Z',6.0,2.5,2,0,'2026-10-04T00:00:00Z',2,2,6.0,3.2)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO review_logs(id,puzzle_id,reviewed_at,played_move,is_correct,rating,time_spent_ms)
             VALUES (7,'p1','2026-10-04T00:00:00Z','c7c6',1,'Good',1500)",
            [],
        )
        .unwrap();
        let book = Repertoire {
            id: "rep1".into(),
            name: "Main White".into(),
            side: "white".into(),
            initial_fen: START_FEN.into(),
            nodes: vec![Node {
                id: "n1".into(),
                parent_id: None,
                uci: "e2e4".into(),
                san: "e4".into(),
                fen_before: START_FEN.into(),
                fen_after: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1".into(),
                order: 0,
                disabled: false,
                nags: vec!["!".into()],
            }],
            notes: HashMap::from([(START_FEN.into(), "Start note".into())]),
            revision: 3,
        };
        db.execute(
            "INSERT INTO repertoires(id,name,payload,revision,updated_at) VALUES (?1,?2,?3,?4,'2026-10-02T00:00:00Z')",
            params![book.id, book.name, serde_json::to_string(&book).unwrap(), book.revision],
        )
        .unwrap();
        let lichess_cp = serde_json::to_string(&SyncCheckpoint {
            completed_through: Some(1000),
            pending: None,
            read: 5,
            added: 2,
            unfinished_ids: vec![],
        })
        .unwrap();
        let chesscom_cp = serde_json::to_string(&ChessComCheckpoint {
            completed_months: vec!["2026/09".into()],
            pending: None,
            read: 10,
            added: 3,
        })
        .unwrap();
        for (k, v) in [
            ("lichess_username", "Alice"),
            ("chesscom_username", "alice_cc"),
            ("engine_path", "/source/stockfish"),
            ("engine_threads", "4"),
            ("lichess_sync_v2:alice", &lichess_cp),
            ("chesscom_sync_v1:alice_cc", &chesscom_cp),
        ] {
            db.execute("INSERT INTO app_settings(key,value) VALUES (?1,?2)", [k, v])
                .unwrap();
        }
        db.execute(
            "INSERT INTO engine_analyses(fen,engine_name,engine_version,analysis_config,depth,score_type,score_value,principal_variation)
             VALUES (?1,'stockfish','1','d=14',14,'cp',30,'e2e4')",
            [START_FEN],
        )
        .unwrap();
    }

    #[test]
    fn every_schema_table_is_classified() {
        let db = Connection::open_in_memory().unwrap();
        migrate(&db).unwrap();
        let mut stmt = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap();
        let actual: HashSet<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        let mut expected: HashSet<String> = INCLUDED_TABLES
            .iter()
            .chain(EXCLUDED_TABLES.iter())
            .map(|s| (*s).to_string())
            .collect();
        expected.insert("sqlite_sequence".into());

        assert_eq!(actual, expected);
    }

    #[test]
    fn classify_setting_key_distinguishes_all_scopes() {
        assert_eq!(
            classify_setting_key("lichess_username"),
            SettingScope::PortableConfig
        );
        assert_eq!(
            classify_setting_key("lichess_sync_v2:alice_1"),
            SettingScope::PortableLichessSync
        );
        assert_eq!(
            classify_setting_key("chesscom_sync_v1:bob-99"),
            SettingScope::PortableChessComSync
        );
        assert_eq!(
            classify_setting_key("engine_path"),
            SettingScope::MachineLocal
        );
        assert_eq!(
            classify_setting_key("lichess_token"),
            SettingScope::Forbidden
        );
        assert_eq!(
            classify_setting_key("API_TOKEN_SECRET"),
            SettingScope::Forbidden
        );
        assert_eq!(
            classify_setting_key("lichess_sync_v2:Alice"),
            SettingScope::Unknown
        );
        assert_eq!(
            classify_setting_key("unknown_custom_key"),
            SettingScope::Unknown
        );
    }

    #[test]
    fn export_import_roundtrip_preserves_all_data_and_sequence_idempotently() {
        let mut src = Connection::open_in_memory().unwrap();
        migrate(&src).unwrap();
        populate_full_fixture(&mut src);

        let exported = export_snapshot(&src, env!("CARGO_PKG_VERSION"), sample_prefs()).unwrap();
        assert_eq!(exported.counts.games, 1);
        assert_eq!(exported.counts.moves, 2);
        assert_eq!(exported.counts.annotations, 2);
        assert_eq!(exported.counts.review_variations, 2);
        assert_eq!(exported.counts.puzzles, 1);
        assert_eq!(exported.counts.review_schedules, 1);
        assert_eq!(exported.counts.review_logs, 1);
        assert_eq!(exported.counts.repertoires, 1);
        assert_eq!(exported.counts.settings, 5);
        assert!(!exported.payload_json.contains("/source/stockfish"));

        let mut dst = Connection::open_in_memory().unwrap();
        migrate(&dst).unwrap();
        dst.execute_batch(
            "INSERT INTO app_settings(key,value) VALUES ('engine_path','/local/bin/stockfish');
             INSERT INTO engine_analyses(fen,engine_name,engine_version,analysis_config,depth,score_type,score_value,principal_variation)
             VALUES ('local_fen','stockfish','2','d=18',18,'cp',12,'d2d4');
             INSERT INTO games(id,source,white_player,black_player,result,pgn) VALUES ('old_g','local','X','Y','draw','1. d4');
             INSERT INTO puzzles(id,source_type,fen,side_to_move,title,expected_moves) VALUES ('old_p','manual','f','white','Old','[\"d2d4\"]');
             INSERT INTO review_schedules(puzzle_id,due_at) VALUES ('old_p','2026-10-01');
             INSERT INTO review_logs(id,puzzle_id,reviewed_at,played_move,is_correct,rating,time_spent_ms) VALUES (99,'old_p','2026-10-01','d2d4',1,'Good',100);",
        )
        .unwrap();

        let inspection = inspect(&dst, &exported.payload_json).unwrap();
        assert_eq!(inspection.backup_counts, exported.counts);
        assert!(inspection.current_counts.has_user_data());
        assert!(inspection
            .warnings
            .iter()
            .any(|w| w.code == BackupWarningCode::OverwritesExistingData));
        assert!(inspection
            .warnings
            .iter()
            .any(|w| w.code == BackupWarningCode::LichessTokenNotIncluded));

        let restored_1 = import(&mut dst, &exported.payload_json).unwrap();
        let restored_2 = import(&mut dst, &exported.payload_json).unwrap();
        assert_eq!(restored_1.restored_counts, exported.counts);
        assert_eq!(restored_2.restored_counts, exported.counts);
        assert_eq!(restored_1.client_preferences, Some(sample_prefs()));

        let local_engine: String = dst
            .query_row(
                "SELECT value FROM app_settings WHERE key='engine_path'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(local_engine, "/local/bin/stockfish");

        let local_cache_fen: String = dst
            .query_row("SELECT fen FROM engine_analyses", [], |r| r.get(0))
            .unwrap();
        assert_eq!(local_cache_fen, "local_fen");

        let seq: i64 = dst
            .query_row(
                "SELECT seq FROM sqlite_sequence WHERE name='review_logs'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(seq, 7);

        let rep = repertoire::get(&dst, "rep1").unwrap();
        assert_eq!(rep.revision, 3);
        assert_eq!(rep.notes[START_FEN], "Start note");
    }

    #[test]
    fn rejects_invalid_format_schema_token_cross_game_variation_cycle_and_rolls_back_atomically() {
        let mut src = Connection::open_in_memory().unwrap();
        migrate(&src).unwrap();
        populate_full_fixture(&mut src);
        let exported = export_snapshot(&src, env!("CARGO_PKG_VERSION"), sample_prefs()).unwrap();

        let mut target = Connection::open_in_memory().unwrap();
        migrate(&target).unwrap();
        target
            .execute(
                "INSERT INTO games(id,source,white_player,black_player,result,pgn) VALUES ('keep','local','A','B','white','1. e4')",
                [],
            )
            .unwrap();

        assert!(import(&mut target, "not json").is_err());

        let mut bad_app: serde_json::Value = serde_json::from_str(&exported.payload_json).unwrap();
        bad_app["appId"] = serde_json::json!("other.app");
        assert!(import(&mut target, &bad_app.to_string()).is_err());

        let mut bad_schema: serde_json::Value =
            serde_json::from_str(&exported.payload_json).unwrap();
        bad_schema["dbSchemaVersion"] = serde_json::json!(CURRENT_SCHEMA_VERSION + 1);
        assert!(import(&mut target, &bad_schema.to_string()).is_err());

        let mut with_token: serde_json::Value =
            serde_json::from_str(&exported.payload_json).unwrap();
        with_token["database"]["appSettings"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({"key": "lichess_token", "value": "lip_secret"}));
        assert!(import(&mut target, &with_token.to_string()).is_err());

        let mut with_engine_path: serde_json::Value =
            serde_json::from_str(&exported.payload_json).unwrap();
        with_engine_path["database"]["appSettings"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({"key": "engine_path", "value": "/evil/path"}));
        assert!(import(&mut target, &with_engine_path.to_string()).is_err());

        let mut cycle: serde_json::Value = serde_json::from_str(&exported.payload_json).unwrap();
        cycle["database"]["reviewVariations"] = serde_json::json!([
            {
                "id": "variation:a",
                "gameId": "g1",
                "parentId": "variation:b",
                "ply": 1,
                "san": "d4",
                "uci": "d2d4",
                "fenBefore": START_FEN,
                "fenAfter": "f1",
                "content": ""
            },
            {
                "id": "variation:b",
                "gameId": "g1",
                "parentId": "variation:a",
                "ply": 2,
                "san": "d5",
                "uci": "d7d5",
                "fenBefore": "f1",
                "fenAfter": "f2",
                "content": ""
            }
        ]);
        assert!(import(&mut target, &cycle.to_string()).is_err());

        let mut cross_game_ann: serde_json::Value =
            serde_json::from_str(&exported.payload_json).unwrap();
        let mut g2 = cross_game_ann["database"]["games"][0].clone();
        g2["id"] = serde_json::json!("g2");
        g2["externalGameId"] = serde_json::json!("ext2");
        g2["moves"] = serde_json::json!([]);
        cross_game_ann["database"]["games"]
            .as_array_mut()
            .unwrap()
            .push(g2);
        cross_game_ann["database"]["annotations"] = serde_json::json!([
            {
                "id": "bad_ann",
                "gameId": "g2",
                "moveId": "g1:1",
                "content": "cross game",
                "createdAt": "2026-10-02T00:00:00Z",
                "updatedAt": "2026-10-02T00:00:00Z"
            }
        ]);
        assert!(import(&mut target, &cross_game_ann.to_string()).is_err());

        let remaining_games: i64 = target
            .query_row("SELECT COUNT(*) FROM games WHERE id='keep'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining_games, 1);
    }

    struct TempDirGuard(PathBuf);

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn export_to_dir_writes_valid_backup_and_avoids_filename_collisions() {
        let mut src = Connection::open_in_memory().unwrap();
        migrate(&src).unwrap();
        populate_full_fixture(&mut src);

        let seq = TEMP_FILE_SEQ.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "chess-trainer-backup-test-{}-{seq}",
            std::process::id()
        ));
        let _cleanup = TempDirGuard(root.clone());
        let nested_dir = root.join("nested");

        let exported =
            export_to_dir(&src, env!("CARGO_PKG_VERSION"), sample_prefs(), &nested_dir).unwrap();
        assert_eq!(exported.format_version, BACKUP_FORMAT_VERSION);
        assert_eq!(exported.db_schema_version, CURRENT_SCHEMA_VERSION);
        assert!(exported.filename.ends_with(".json"));

        let saved_path = PathBuf::from(&exported.saved_path);
        assert_eq!(
            saved_path.file_name().and_then(|n| n.to_str()),
            Some(exported.filename.as_str())
        );
        assert_eq!(saved_path.parent(), Some(nested_dir.as_path()));

        let raw_json = std::fs::read_to_string(&saved_path).unwrap();
        let mut dst = Connection::open_in_memory().unwrap();
        migrate(&dst).unwrap();
        let inspection = inspect(&dst, &raw_json).unwrap();
        assert_eq!(inspection.backup_counts, exported.counts);
        let restored = import(&mut dst, &raw_json).unwrap();
        assert_eq!(restored.restored_counts, exported.counts);
        assert_eq!(restored.client_preferences, Some(sample_prefs()));

        let stem = exported.filename.strip_suffix(".json").unwrap();
        let (dup1_name, dup1_path) =
            write_backup_atomically(&nested_dir, stem, "{\"sentinel\":1}").unwrap();
        assert_eq!(dup1_name, format!("{stem}-1.json"));
        assert_eq!(std::fs::read_to_string(&dup1_path).unwrap(), "{\"sentinel\":1}");
        assert_eq!(std::fs::read_to_string(&saved_path).unwrap(), raw_json);

        let (dup2_name, dup2_path) =
            write_backup_atomically(&nested_dir, stem, "{\"sentinel\":2}").unwrap();
        assert_eq!(dup2_name, format!("{stem}-2.json"));
        assert_eq!(std::fs::read_to_string(&dup2_path).unwrap(), "{\"sentinel\":2}");

        let entries: Vec<String> = std::fs::read_dir(&nested_dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().all(|name| !name.ends_with(".tmp")));
    }
}

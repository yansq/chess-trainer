# SQLite 数据库

数据库位于 macOS 应用数据目录的 `chess-trainer.db`。Tauri 启动时按 `user_version` 依次运行 `src-tauri/src/db/migrations/` 下的编号迁移，当前版本为 3，可重复启动。未来结构变更新增编号 migration，不能改写已发布 migration。版本 3 新增 `is_bot`，根据原有 PGN 和双方名称回填历史对局类型。

- `games`：来源、外部 ID、双方、用户执棋颜色、结果（获胜方 `white` / `black` 或 `draw` / `unknown`）、时间、时限、开局、PGN、复盘状态、是否包含 bot（`is_bot`）。识别 PGN 的 `WhiteTitle` / `BlackTitle` 为 `BOT`、`WhiteType` / `BlackType` 为 `program`，以及 Lichess 内置电脑的 `Stockfish level 1–8` / `lichess AI level 1–8` 名称；缺少这些标记的棋谱按真人对局处理。列表和开局统计默认筛选真人，也可选择 bot 或全部对局。`(source, external_game_id)` 非空时唯一；本地 PGN 使用确定性内容 ID。
- `moves`：主线 ply 从 1 开始，稳定 ID `gameId:ply`，SAN/UCI、`fen_before`/`fen_after`。初始局面是第一步的 `fen_before`。
- `annotations`：`move_id IS NULL` 表示整局总结，否则关联一步招法；唯一目标索引阻止重复。同步不会修改此表。
- `engine_analyses`：按 FEN、引擎路径与文件修改时间、`multipv=1`、深度缓存。评价统一为白方视角，`score_type` 为 `cp` 或 `mate`，`score_value` 保留原单位。
- `puzzles`：标准答案 JSON 数组允许多招法；自动题记录失误招法、失误前 FEN、推荐变化。来源 ID 可空，以便未来独立题目。
- `review_schedules`：SM-2 当前状态；`review_logs`：每次评级与作答记录。日程还累计总尝试次数、正确次数。`due_at` 采用 ISO 8601 UTC。
- `app_settings`：用户名、引擎路径/深度、失误阈值和同步游标。`lichess_sync_v2:<小写用户名>` 保存 `completedThrough`（完整同步范围的上界）、`pending`（当前任务的 `since`、分页 `until` 与固定 `upperBound`）、读取/新增计数及 `unfinishedIds`（已发现但尚未结束的对局 ID）。每次同步先按 ID 检查这些长对局，结束后补入数据库；无需扩大增量时间范围。首次同步的 `since` 为空；后续从完整范围上界往前 24 小时增量补齐。分页保留相同时间的边界重叠，按 ID 去重。每批对局和进度在同一 SQLite 事务提交，失败不会越过未保存的数据。旧 `lichess_last_sync` 不用于新流程。Lichess Token 只存入 macOS Keychain。

外键已启用。对局列表和到期题目有索引；列表筛选与分页在 SQLite 内执行。

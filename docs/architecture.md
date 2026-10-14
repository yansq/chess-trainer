# Chess Trainer 架构

Local-first macOS 应用。React 处理交互；`chess.js` 解析 PGN、生成逐步 FEN 和校验走法；Rust commands 提供窄接口；Rust repository 使用 SQLite 持久化。所有数据在本机，Lichess 只用于用户主动同步。页面不调用 `invoke` 或 SQL。

数据流：PGN 文件或 Lichess API → PGN parser → 规范化 Game/Move → Rust import service → SQLite → 分页查询 → 复盘。注释按稳定的 move ID 保存。题目保存失误前或指定的 FEN，并由独立 scheduler 更新复习状态与历史。

模块：`features/games` 导入、列表；`analysis` 复盘；`puzzles` 出题和作答；`review` 调度；`statistics` 查询展示；`settings` 用户配置。`shared/api` 是 Tauri 调用边界。Rust `db` 管理迁移和仓储，`lichess` 专管网络，`engine` 专管 UCI 进程。长期扩展见 roadmap。

错误边界：导入先完整解析再逐局事务写入；同步 upsert 不触及注释；引擎异常不会影响数据库或复盘。Token 使用 macOS Keychain，不进 SQLite。引擎缓存评价统一用白方视角。

## 引擎与错题

每次分析由 `EngineManager` 管理取消代数；新局面分析会通知旧任务，旧进程由 Tokio 退出路径释放。前端同时按请求序号与 FEN 验证结果。`engine_analyses` 以路径、文件修改时间、深度和 MultiPV 缓存。对局批量分析只抽取用户执棋的 ply，比较走棋前后白方视角评价，再转换为执棋方胜率损失。候选题保存 `move.fen_before`，用户确认后才入题。

## 训练

题目保存 UCI 标准答案数组。训练时 `chess.js` 校验实际落子，作答后显示答案；scheduler 为纯函数并返回新状态，Rust 在一个事务内更新 schedule 和插入 review log。之后可以替换成 FSRS 而不改训练页面的数据契约。

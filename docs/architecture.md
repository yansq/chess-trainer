# Chess Trainer 架构

Local-first macOS 应用。React 处理交互；`chess.js` 解析 PGN、生成逐步 FEN 和校验走法；Rust commands 提供窄接口；Rust repository 使用 SQLite 持久化。所有数据在本机，Lichess 只用于用户主动同步。页面不调用 `invoke` 或 SQL。

数据流：PGN 文件或 Lichess API → PGN parser → 规范化 Game/Move → Rust 导入命令 → SQLite → 分页查询 → 复盘。解析直接使用 `chess.js` 历史招法提供的前后 FEN。注释按稳定的 move ID 保存。题目保存失误前或指定的 FEN，并由 scheduler 更新复习状态与历史。

模块：`features/games` 导入、列表；`analysis` 复盘和出题；`puzzles` 题库管理；`review` 作答和调度；`statistics` 查询展示；`settings` 用户配置。`shared/api` 是 Tauri 调用边界。Rust `db` 管理迁移和仓储，`lichess` 专管网络，`engine` 专管 UCI 进程。界面样式统一使用 Tailwind CSS 4，颜色和字体在 `src/style.css` 的 `@theme` 中定义，基础元素通过 `@layer base` 和 `@apply` 统一；布局、响应式及交互状态在组件中用工具类表达，下拉组件使用 Radix。

错误边界：导入先完整解析再逐局事务写入；同步 upsert 不触及注释；引擎异常不会影响数据库或复盘。Token 使用 macOS Keychain，不进 SQLite。引擎缓存评价统一用白方视角。

## 引擎与错题

`EngineManager` 持有一个可复用 UCI 进程，分析任务串行执行，各任务通过请求 ID 独立取消；取消时先读取旧搜索的结束消息，再复用进程。前端等待局面稳定 180 毫秒后启动分析，按请求生命周期和 FEN 过滤迟到结果，逐步显示完整的 MultiPV 结果。引擎响应只保存 FEN 和排序后的候选数组，最优招法、评价和深度直接读取首项，避免维护重复摘要。`engine_analyses` 以路径、文件修改时间、深度和 MultiPV 缓存，缓存表与候选 JSON 格式保持不变。对局批量分析只抽取用户执棋的 ply，比较走棋前后白方视角评价，再转换为执棋方胜率损失。失误候选只保留创建题目需要的招法、答案、参考变化、损失和分类；候选题保存 `move.fen_before`，用户确认后才入题。

## 训练

题目持久化分类 `opening/tactics/endgame/other`，v4 迁移将已有题目归为开局并保留内容和复习记录。开局题名称使用来源对局的开局类型（冒号前名称）和递增序号，缺失开局时使用「未知开局」；其他分类分别使用「战术 / 残局 / 其他」和各自的序号。题库按分类在 SQL 中先筛选再限制返回数量。表单预览下一名称；未修改名称时，由 Rust 在持有数据库锁的保存过程中从完整题库计算序号，重复保存同一题目保留原名称。题目保存 UCI 标准答案数组。手动连续多步题将首步保存在 `expectedMoves`，整段双方走法保存在 `solutionLine`；旧手动题的变化为空，自动题的变化继续作为参考。录入时逐步更新局面并校验整条答案。训练时 `chess.js` 校验落子，多步题在正确落子后自动走出对手应手；完成整段或答错后才展示答案、来源注释和评级。作答状态记录当前 FEN、已走序列及完成结果，复习日志记录答题方的走法。scheduler 为纯函数并返回新状态，Rust 在一个事务内更新 schedule 和插入 review log。

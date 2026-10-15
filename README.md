# Chess Trainer

macOS 本地优先的国际象棋复盘与训练应用。界面为简体中文。数据保存在本机 SQLite；离线可复盘已导入对局并完成训练。

## 环境

- macOS、Xcode Command Line Tools 或完整 Xcode
- Node.js 20.19+（或 22.12+）、pnpm 10+、Rust stable 与 Cargo
- 可选：本机 Stockfish 可执行文件，例如 Homebrew `brew install stockfish` 后的 `/opt/homebrew/bin/stockfish`

## 安装与启动

```bash
pnpm install
pnpm tauri dev
```

首次启动自动创建数据库。设置 Lichess 用户名后，在「对局」点击「同步对局」，首次补齐全部已结束的标准棋历史（包含真人和 bot），以后点击同一按钮只同步增量范围。每批最多获取 100 局，后台线程解析棋谱，分批写入 SQLite；进度与对局在同一事务内保存，可暂停、关闭应用后继续。切换页面时同步仍会继续。也可直接导入 `.pgn`；可用样例：`tests/fixtures/games/sample.pgn`。从对局列表进入复盘，逐步查看局面并保存 Markdown 笔记。在任一局面填写 SAN 或 UCI 正确招法创建题目，再到「今日训练」在棋盘上走棋并评级。题目默认在创建后立即到期。

## 检查与构建

```bash
pnpm typecheck
pnpm lint
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build --bundles app
```

应用包位于 `src-tauri/target/release/bundle/macos/Chess Trainer.app`。本机开发配置中不内置 Stockfish 二进制；设置中填写可执行文件路径和深度。复盘页面会分析当前 FEN，也可批量分析自己的招法，确认候选后加入题库。批量分析按近似胜率变化分类，阈值可在设置中调整；复杂局面需要人工确认。

## 样式

统一使用 Tailwind CSS 4，由 `@tailwindcss/vite` 编译。共用颜色和字体定义在 `src/style.css` 的 `@theme` 中，基础表单和表格使用 `@layer base` / `@apply`；页面和组件使用 Tailwind 工具类，包括响应式、Radix 状态和 Markdown 后代样式。动态音量只传入 CSS 变量；棋盘和图表通过组件的样式接口引用同一套主题颜色。

## 数据和隐私

Lichess 用户名、各账号的同步进度、引擎路径存入 SQLite；可选 PAT 由 macOS Keychain 保存。同步复用网络连接，每批请求超时为 30 秒，临时网络失败或服务端错误最多尝试 3 次；收到 429 会显示限流信息并保留进度，不连续重试。首次历史同步不设总局数上限；增量同步会分批补齐整个时间范围，完整成功后才推进同步时间。增量保留 24 小时重叠窗口，通过对局 ID 去重并保留笔记和复盘状态。旧版全局游标不作为历史完整的依据，升级后的第一次同步会补齐历史。未同步时所有已保存数据仍可使用。

## 当前限制

导入仅解析 PGN 主线。复盘支持拖动或点击棋盘试走分支，可在招法列表切换线路；分支及其笔记仅在当前页面临时保留，离开后清除，不写回原棋谱。同步导入已结束的标准棋，不包含变体；进行中的对局仅记录 ID，后续逐批检查，结束后再导入，不需要重新扫描全部历史。恢复被中断的同步会先完成原来的时间范围，新发生的对局在下一次增量同步获取。自动失误判断使用 `1/(1+exp(-cp/150))` 将白方视角厘兵近似映射为胜率，mate 用极值处理；这不是引擎的精确 WDL。题目可以保存并编辑多个标准答案，其他合理招法暂不会用引擎容差自动接受。训练可逐步播放引擎提供的标准变化；手动题目若未填写变化则只显示标准答案。Lichess 令牌仅用于可选鉴权，公开对局可不填。首次发布尚未做签名或公证。

## 依赖与许可证

初始化时核对 npm 稳定版本与包许可证：Tauri 2 为 MIT / Apache-2.0，React、Tailwind、react-chessboard、Zustand、Recharts 为 MIT，chess.js 为 BSD-2-Clause。Stockfish 18 为 GPL-3.0；本项目仅调用用户本机安装的程序，不打包其二进制。日后若分发 Stockfish，需履行 GPL 对应源代码与许可证义务。详见官方 [Tauri 文档](https://v2.tauri.app/start/create-project/)、[Lichess API](https://lichess.org/api#tag/Games/operation/apiGamesUser) 和 [Stockfish 授权](https://github.com/official-stockfish/Stockfish/blob/master/Copying.txt)。

架构见 `docs/architecture.md`，数据库见 `docs/database.md`，后续计划见 `docs/roadmap.md`。

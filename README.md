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

首次启动自动创建数据库。设置 Lichess 用户名后，在「对局」点击「同步对局」，首次补齐全部已结束的标准棋历史（包含真人和 bot），以后点击同一按钮只同步增量范围。每批最多获取 100 局，后台线程解析棋谱，分批写入 SQLite；进度与对局在同一事务内保存，可暂停、关闭应用后继续。切换页面时同步仍会继续。也可直接导入 `.pgn`；可用样例：`tests/fixtures/games/sample.pgn`。从对局列表进入复盘，逐步查看局面并保存 Markdown 笔记。在任一局面填写 SAN 或 UCI 正确招法创建题目，可选择「开局 / 战术 / 残局 / 其他」分类；开局题名称沿用开局类型编号（如 `Sicilian Defense · 1`），其他分类按分类名编号（如 `战术 · 1`），仍可手动修改；开启「连续多步」后，可输入双方依次走棋的完整答案，如 `e4 e5 Nf3`（用空格分隔）。训练时对手自动应手，完成答题方的全部走法后再展示答案与来源注释。再到「今日训练」在棋盘上走棋并评级。题目默认在创建后立即到期。到期预告采用累计口径：1 / 2 / 3 天后分别统计截至对应本地日期当天结束的到期题数，包含今天及已逾期的题目；假设期间不再训练。

## 检查与构建

```bash
pnpm typecheck
pnpm lint
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build --bundles app
```

应用包位于 `src-tauri/target/release/bundle/macos/Chess Trainer.app`。本机开发配置中不内置 Stockfish 二进制；设置中填写可执行文件路径和深度。复盘页顶部提供「引擎」开关，默认开启；关闭后暂停主线、分支与批量分析，隐藏推荐招法及棋盘、招法表上的质量标识，仍可走棋、记笔记和手动出题。开启时会分析当前 FEN，也可批量分析自己的招法，确认候选后加入题库。批量分析按近似胜率变化分类，阈值可在设置中调整；复杂局面需要人工确认。

## 发布与应用内更新

从 0.2.0 开始，「设置 → 应用更新」可检查 GitHub 正式版本，下载、验证签名、安装并重启。检查最新清单的地址为 `https://github.com/yansq/chess-trainer/releases/latest/download/latest.json`。当前发布目标为 macOS Apple Silicon；下载或签名失败不会安装，安装失败不会重启，重启失败可单独重试。

旧版 0.1.0 尚无更新入口，需要先从 Releases 下载 `.app.zip`，解压并把应用放入「应用程序」。此后的更新在应用内完成，应用数据仍保存在原来的 SQLite 目录，不随应用包替换。本版使用 ad-hoc 代码签名，尚未进行 Apple 公证，首次打开可能需要在系统「隐私与安全性」中允许。

自动发布由 `.github/workflows/release.yml` 负责：每次推送到 `main` 或在 Actions 手动运行，自动测试、构建 Apple Silicon 应用、签名、检查应用图标、生成更新清单并发布 GitHub Release。签名私钥存放在仓库 Actions Secret `TAURI_SIGNING_PRIVATE_KEY`，可选密码为 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；只在签名步骤写入临时文件，步骤结束即清除。

版本由源代码基准 `主版本.次版本.补丁偏移` 加该工作流的 `github.run_number` 得到（例如基准 `0.2.0` 的第 1、2 次运行生成 `0.2.1`、`0.2.2`）。失败运行可以留下版本空档；重新运行同一次构建沿用相同版本，已发布附件不会被覆盖。无需每次手工改版本或提交机器生成的版本更改，因此不会循环触发。升级主/次版本时，同步调整 package、Cargo 与 Tauri 三处基准版本；不要在同一主/次版本内降低补丁偏移。

自动版本记录在构建包和更新清单，Release 标签指向本次推送的准确源码提交；源码中的基准版本保持不变。各推送独立构建，发布前先上传草稿、下载回读并逐项核对哈希，再按语义版本交由 GitHub 选择 latest，避免较旧构建覆盖更新版本。

本地仍可运行 `pnpm release:prepare` 验证图标、签名与产物；它使用当前源码版本和 `docs/releases/v版本.md`，不会自动发布。自动流程会为每次推送生成独立更新说明。产物包含 `.app.tar.gz`、首次安装 `.app.zip`、`.sig`、`latest.json` 和 `SHA256SUMS.txt`。

Updater 私钥默认读取本机 `~/.tauri/chess-trainer.key`（权限 0600），也可用 `TAURI_SIGNING_PRIVATE_KEY` 指定文件路径；相邻 `.pub` 必须与配置中公钥一致。私钥不进仓库、不上传 Release，需自行安全备份；更换或遗失密钥会影响已安装应用的后续更新验证。需要密码时通过 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 提供，不要写入代码。

可用隔离的旧版应用副本验证真实官方 Updater 安装：`cargo run --manifest-path src-tauri/Cargo.toml --example verify_update -- /private/tmp/测试目录/Chess\ Trainer.app release/latest.json`。省略清单参数时从真实 GitHub 端点下载。该工具只允许替换临时目录中的 `.app`，验证签名、篡改拒绝、安装后版本和代码签名，不启动应用也不访问用户数据库。

## 样式

界面使用 [Radix Themes](https://www.radix-ui.com/themes/docs/overview/getting-started)，在应用根部配置深色 `Theme`。按钮、表单、表格、卡片、切换、滑块和提示使用主题组件，页面布局使用 `Box` / `Flex` / `Grid`；外观优先通过组件的 `size`、`variant`、`color` 等属性控制。Tailwind CSS 4 保留用于棋盘容器缩放、应用导航、响应式与 Markdown 样式。CSS 按 base → radix → components → utilities 分层，避免基础样式覆盖主题控件。棋盘通过组件的样式接口引用 `src/style.css` 中的语义颜色。

### UI lint 配置

`@shadcn/lint` 已注册到 `eslint.config.js`，运行 `pnpm lint` 即可加载。沿用现有 TypeScript/TSX parser，启用任意值、内联样式、原始颜色、组件重设样式检查，并对未知工具类发出警告。

规则在该配置的 `rules` 中维护；参阅[可用规则](https://github.com/shadcn-ui/lint#rules)与[配置示例](https://github.com/shadcn-ui/lint#settings)。`settings.shadcn.ui` 指向 `@/shared/ui`（`src/shared/ui`）；主题由插件自动发现 `src/style.css`，无需创建 `components.json`。

## 数据和隐私

Lichess 用户名、各账号的同步进度、引擎路径存入 SQLite；可选 PAT 由 macOS Keychain 保存。同步复用网络连接，每批请求超时为 30 秒，临时网络失败或服务端错误最多尝试 3 次；收到 429 会显示限流信息并保留进度，不连续重试。首次历史同步不设总局数上限；增量同步会分批补齐整个时间范围，完整成功后才推进同步时间。增量保留 24 小时重叠窗口，通过对局 ID 去重并保留笔记和复盘状态。旧版全局游标不作为历史完整的依据，升级后的第一次同步会补齐历史。未同步时所有已保存数据仍可使用。

## 当前限制

导入仅解析 PGN 主线。复盘支持拖动或点击棋盘试走分支，可在招法列表切换线路；分支及其笔记仅在当前页面临时保留，离开后清除，不写回原棋谱。同步导入已结束的标准棋，不包含变体；进行中的对局仅记录 ID，后续逐批检查，结束后再导入，不需要重新扫描全部历史。恢复被中断的同步会先完成原来的时间范围，新发生的对局在下一次增量同步获取。自动失误判断使用 `1/(1+exp(-cp/150))` 将白方视角厘兵近似映射为胜率，mate 用极值处理；这不是引擎的精确 WDL。题目可以保存并编辑多个标准答案，其他合理招法暂不会用引擎容差自动接受。题库支持按题目分类筛选和编辑分类，升级时已有题目归为「开局」。手动题目支持单步多答案或一条连续多步答案，可在题库中编辑；训练结束后可逐步播放完整答案或引擎参考变化。Lichess 令牌仅用于可选鉴权，公开对局可不填。当前发布采用 ad-hoc 签名和 Updater 验签，尚未进行 Apple 公证。

## 依赖与许可证

初始化时核对 npm 稳定版本与包许可证：Tauri 2 为 MIT / Apache-2.0，React、Tailwind、react-chessboard、Zustand 为 MIT，chess.js 为 BSD-2-Clause。Stockfish 18 为 GPL-3.0；本项目仅调用用户本机安装的程序，不打包其二进制。日后若分发 Stockfish，需履行 GPL 对应源代码与许可证义务。详见官方 [Tauri 文档](https://v2.tauri.app/start/create-project/)、[Lichess API](https://lichess.org/api#tag/Games/operation/apiGamesUser) 和 [Stockfish 授权](https://github.com/official-stockfish/Stockfish/blob/master/Copying.txt)。

架构见 `docs/architecture.md`，数据库见 `docs/database.md`，后续计划见 `docs/roadmap.md`。

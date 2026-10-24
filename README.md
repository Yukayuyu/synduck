# AI Context Canvas

在一张大画布上组织对话、摘取文字、延伸提问，并检查每次 AI 回答实际使用了哪些上下文。支持 ChatGPT / Codex 登录、模型与思考深度选择、本地项目工具、MCP 和可追溯的 Windows 窗口操作。

## 从这里开始

| 你的目标                             | 阅读说明                                              |
| ------------------------------------ | ----------------------------------------------------- |
| 在 Windows 上安装，或从源码启动      | [安装与配置指南](docs/setup.md)                       |
| 登录 ChatGPT、选择模型或配置 API key | [模型与登录配置](docs/setup.md#连接-ai)               |
| 用 iPhone／iPad 访问电脑上的画布     | [Windows 与 iOS 访问](docs/windows-ios.md)            |
| 连接 MCP、使用桌面控制、回看操作     | [MCP 与桌面控制](docs/mcp-desktop-traces.md)          |
| 升级、保留数据、恢复失败的安装       | [本地执行器与版本更新](docs/local-runtime-updates.md) |
| 为开源项目设置 GitHub 发布与自动更新 | [GitHub 发布配置](docs/github-updates.md)             |

**当前状态（0.5.2，2026-10-24）：** 仓库仍为私有，已加入 MIT 许可证，尚未发布正式 Release。更新器与发布工作流仍采用独立发布仓库；计划中的“公开主仓库 + 同仓库 Releases”尚未切换。当前可从源码运行，或使用维护者提供的完整 Windows 测试 ZIP。安装和更新状态请以[发布配置说明](docs/github-updates.md#当前状态)为准。

## 从源码快速启动

需要 Git、Node.js **24.19.0** 和 pnpm **11.19.0**。目前克隆私有仓库需要 GitHub 访问权限；公开后可以匿名克隆。首次在 Windows PowerShell 中执行：

```powershell
git clone --branch main https://github.com/Yukayuyu/synduck.git
cd synduck
pnpm install --frozen-lockfile
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
pnpm db:migrate
pnpm build
pnpm start:local
```

macOS／Linux 只需把创建配置文件的那一行换成：

```sh
if [ ! -f .env ]; then cp .env.example .env; fi
```

保持启动器终端开启，在**运行后端的电脑**上打开浏览器，访问本机 `3001` 端口。首次默认是 **Demo 模式**，不需要任何密钥，也不会调用真实 AI。已有 `.env` 和 `data/` 会保留。

使用真实 AI：打开「模型與登入」→「使用 ChatGPT 帳號登入」→完成官方授权→选择「ChatGPT / Codex」、有效模型和思考深度→「使用此模式」。这条路径不需要另外填写 OpenAI API key。直接 API 模式、常见错误及完整命令见[配置指南](docs/setup.md)。

## 开发与验证

后续开发和交付都进入 `main`。开发时用 `pnpm dev`，前端端口为 `3000`，API 为 `3001`；与上面的日常启动方式择一运行，避免端口冲突。

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

浏览器测试前先运行 `build`。没有 Chromium 时，先执行 `pnpm exec playwright install chromium`；WebKit 手机布局测试另用 `pnpm exec playwright install webkit` 和 `pnpm exec playwright test --config playwright.webkit.config.ts`。Linux 还需 Playwright 对应的系统依赖。测试使用隔离数据库和受控模型，不会调用付费模型。

生成 Windows 包：

```sh
pnpm package:windows
pnpm test:portable
```

输出在忽略跟踪的 `release-output/`。编译包包含前端、后端、启动器、Windows 桌面桥接、MIT 许可证和固定版本的运行依赖清单；依赖在目标电脑首次启动时安装。真实 `.env`、画布、登录数据和开发用 `node_modules` 不进入安装包。JavaScript 编译文件仍可被分析。

## 日常使用

1. 双击画布空白处，或点「提問」创建对话；输入和输出以相邻分块呈现。
2. 输入问题，可先预览上下文，检查包含／排除项、来源和预算，再发送。
3. 选中已保存的文字，选择「摘录」或「延伸提問」，创建保留来源的分支。
4. 拖动卡片标题移动位置；在正文中拖动用于选择文字。右键／卡片菜单提供复制、删除、恢复等操作。
5. 「本地任務」用于项目文件、命令、MCP 和桌面工具；命令、写入及外部工具按具体操作确认。
6. 「备份与恢复」可导出画布项目；完整数据与登录备份请见[配置指南](docs/setup.md#保存数据与升级)。

画布是视图，领域数据和来源记录是事实依据。每个 AI 回答保留对应的不可变输入上下文包；摘录保留原文、范围和内容 hash。普通画布回答与本地工具任务各有明确入口，工具结果不会悄悄写入已封存的上下文。

## 平台与数据

- Windows 可运行完整后端和目标窗口控制；Linux／macOS 可从源码运行画布、模型和本地工具，当前桌面驱动仅支持 Windows。
- iOS 通过 Safari 访问持续运行的后端，需要配置可信 HTTPS 和工作区密码。它不能独立运行后端或控制手机其他 App。
- 数据保存在后端的 `data/`，包括 SQLite、模型设置、ChatGPT 登录和本地任务记录。密钥只放后端 `.env` 或安全环境设置，不能放到前端 `VITE_*` 变量。
- 这是单一拥有者的工作区；同一后端连接的设备共享画布和模型账号。

已通过的自动化覆盖包括 Windows／Linux 的编译包安装、升级与回退、窗口枚举，以及 Linux 上的 Chromium／WebKit 浏览器测试。实体 Windows 的截图／输入、真实账号生成和实体 iOS 的操作体验仍需实机验证。

## 项目说明

- [产品与设计规范](docs/product-spec.md)、[原始需求](docs/source-spec.md)、[开发进度](docs/progress.md)
- [上下文编译](docs/context-compiler.md)、[数据模型](docs/data-model.md)、[数据迁移](docs/migrations.md)
- [对话分块](docs/conversation-blocks.md)、[画布菜单](docs/canvas-actions.md)、[文本输入](docs/editor-input.md)
- [公开前检查与分支清理](docs/public-readiness.md)：旧分支已清理，历史提交仍保留；公开状态和发布流程没有因此自动改变。

## 许可证

项目代码采用 [MIT License](LICENSE)。第三方依赖和资产保留各自的许可证。`package.json` 的 `private: true` 只防止误发 npm 包，不控制 GitHub 的公开状态。

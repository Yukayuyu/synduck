# 安装与配置指南

适用版本：0.7.0；0.5.3—0.6.0 的安装与登录步骤相同。先完成“启动程序”，再从 Demo、ChatGPT 登录、直接 API 三种模型模式中选一种。MCP、桌面控制和 iOS 都是可选配置。

## 需要准备什么

| 使用方式        | 需要准备                                                              |
| --------------- | --------------------------------------------------------------------- |
| Windows 安装包  | 维护者发布或提供的完整 Windows ZIP；首次启动需要网络，支持 x64／ARM64 |
| 从源码运行      | Git、Node.js 24.19.0、pnpm 11.19.0，公开仓库地址；无需 GitHub token   |
| ChatGPT / Codex | 具有相应 Codex 使用资格的 ChatGPT 账号；不需要另外填写 API key        |
| OpenAI API      | 可使用 Responses API 的 API key、账号可用的结构化输出模型             |
| iPhone／iPad    | 持续运行的后端、可访问它的可信 HTTPS 地址、独立工作区密码             |

Windows 安装包与源码统一位于 [Yukayuyu/synduck](https://github.com/Yukayuyu/synduck)。从 [Releases](https://github.com/Yukayuyu/synduck/releases) 下载 `ContextCanvas-Windows-<版本>.zip`；如果首次发布尚未完成、暂时没有附件，可先从源码运行或使用维护者提供的完整测试 ZIP。更新器从同一个公开仓库匿名下载，不需要用户填写 GitHub token。

## 启动程序

### Windows：使用安装包

1. 取得 `ContextCanvas-Windows-<版本>.zip`，完整解压到你希望长期保留的位置。正式发布后应下载 Release 附件中的这个 ZIP，而不是 GitHub 自动生成的 Source code ZIP。
2. 双击 `Start-ContextCanvas.cmd`。
3. 等待启动器准备 Node.js 24 和固定版本依赖；首次启动会下载所需文件，不要求预先安装 Git 或自行克隆源码。
4. 出现 `Context Canvas is ready` 后，使用自动打开的浏览器；也可以在后端电脑打开本机 `3001` 端口。
5. 保持启动器窗口开启。关闭程序时按 `Ctrl+C`；不要同时启动同一安装的多个启动器。

新安装默认是 Demo。第一次启动时通常不需要修改 `.env`。如需修改，使用**安装根目录**的 `.env`，与 `Start-ContextCanvas.cmd` 同级，不要编辑 `versions/` 下的副本。

### Windows：从源码运行

先安装 Git 和 Node.js 24.19.0。没有 pnpm 时，可通过 npm 安装固定版本：

```powershell
npm install --global pnpm@11.19.0
node --version
pnpm --version
```

在准备存放项目的位置执行：

```powershell
git clone --branch main https://github.com/Yukayuyu/synduck.git
cd synduck
pnpm install --frozen-lockfile
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
pnpm db:migrate
pnpm build
pnpm start:local
```

仓库公开后可匿名克隆；公开前需要源仓库访问权限。已有 checkout 时，在没有未提交修改的情况下使用 `git switch main` 和 `git pull --ff-only origin main`，再执行安装、迁移、构建与启动；不必重新克隆或覆盖 `.env`。

### macOS／Linux：从源码运行

使用相同的 Git、Node.js 和 pnpm 版本，创建配置文件的命令改为 shell 写法：

```sh
git clone --branch main https://github.com/Yukayuyu/synduck.git
cd synduck
pnpm install --frozen-lockfile
if [ ! -f .env ]; then cp .env.example .env; fi
pnpm db:migrate
pnpm build
pnpm start:local
```

上述源码启动器会保留 Git checkout，不提供安装包那样的一键覆盖切版。开发 UI 时，先停止启动器，再运行 `pnpm dev`：前端使用 `3000`，API 使用 `3001`。

默认端口均绑定本机；检查启动是否成功，可在后端电脑查看 `/api/health`，应返回 `service: context-canvas` 和当前版本。本文中的本机端口只供同一台电脑访问；从手机或远端访问需按 [HTTPS 配置](windows-ios.md#在-iphoneipad-上打开)设置。

## 连接 AI

### Demo：先确认程序可以使用

保留 `.env.example` 的默认 `LLM_PROVIDER=demo`。界面生成的内容会标为“本地演示”，不会调用真实模型或消耗模型额度。

如果之前已在界面保存其他模式，在「模型與登入」选择「示範模式（不呼叫 AI）」并点「使用此模式」。已保存的界面选择优先于 `.env` 中的初始模式。

### ChatGPT / Codex：通过账号登录

1. 打开「模型與登入」。
2. 点「使用 ChatGPT 帳號登入」，打开显示的官方授权链接，完成账号登录和一次性设备码确认。
3. 等待程序显示已连接。
4. 选择「ChatGPT / Codex」，刷新并从「Codex 模型」选择当前账号可用的模型。
5. 选择「思考深度」，或保留「模型預設」，再点「使用此模式」。
6. 回到画布提交一条简短问题，确认真正完成回答。

官方 Codex 已作为依赖提供，不需要另装自己的 Codex CLI 或注册一个 OAuth 应用。模型清单来自官方目录；不同模型支持的深度不同，旧模型失效时重新选择即可。账号模型权限、组织策略和额度仍以服务实际返回为准，显示已连接本身不代表一次生成已成功。

模型、深度和模式保存在 `data/model-settings.json`，ChatGPT 凭证在应用自己的 `data/codex/`。不要把其他 Codex 安装的凭证复制过来，也不要为了切换模式删除整个 `data/`。

### OpenAI API：使用独立 API key

在后端 `.env` 填入：

```dotenv
LLM_PROVIDER=openai
LLM_MODEL=<你的账号可用且支持结构化输出的 Responses API 模型>
LLM_API_KEY=<仅在自己的后端填写 API key>
```

保存后停止并重新启动后端，再到「模型與登入」选择「OpenAI API」并点「使用此模式」。这会覆盖先前保存在界面的模式选择。

ChatGPT 账号登录与 API key 是两种独立接入方式。直接 API 模式不复用 ChatGPT 登录凭证，模型由 `LLM_MODEL` 指定。密钥不进入浏览器，也不要填入 `VITE_*` 变量或提交 Git。

## 常用配置

多数设置可以保留默认值。修改 `.env` 后需要**重新启动后端／整个 Windows 启动器**；更改前端构建相关配置后重新执行 `pnpm build`。

| 配置项                                  | 默认值或作用                                | 什么时候需要修改                 |
| --------------------------------------- | ------------------------------------------- | -------------------------------- |
| `LLM_PROVIDER`                          | `demo`，只作尚未保存模式时的初始值          | 想配置初始模型模式时             |
| `LLM_MODEL`、`LLM_API_KEY`              | 直接 OpenAI API 的模型与密钥                | 使用 API 模式时                  |
| `CODEX_MODEL`                           | 尚未保存 Codex 模型时的初始值               | 通常直接使用界面模型菜单         |
| `API_PORT`                              | `3001`                                      | 该端口已被其他程序占用时         |
| `APP_PORT`                              | `3000`，用于开发服务器                      | 开发端口冲突时                   |
| `API_HOST`                              | `127.0.0.1`                                 | 反向代理与后端不同主机时另行配置 |
| `PUBLIC_ORIGIN`、`APP_PASSWORD`         | HTTPS 访问地址与至少 16 字符的工作区密码    | 在手机／另一台设备访问时         |
| `DATABASE_PATH`、`ASSET_PATH`           | `data/context-canvas.sqlite`、`data/assets` | 源码部署有自定义数据目录时       |
| `MODEL_SETTINGS_PATH`、`APP_CODEX_HOME` | `data/model-settings.json`、`data/codex`    | 源码部署有自定义目录时           |
| `LOCAL_RUNTIME_PATH`                    | `data/local-runtime`，保存任务和操作证据    | 源码部署有自定义目录时           |
| `LOCAL_PROJECT_ROOT`                    | 可选的首次项目目录                          | 通常在「本地任務」保存           |
| `MCP_*`                                 | 外部 MCP 服务需要的后端凭证变量             | 对应 MCP 服务要求授权时          |

Windows 管理式安装需要把画布、模型设置、认证和本地任务保留在安装根目录的 `data/` 中，以支持完整回退。不要把这些路径移到 `versions/`。完整目录和恢复流程见[版本更新说明](local-runtime-updates.md)。

### 各种登录和 token 分别用于什么

| 项目           | 用途                     | 普通用户是否需要            |
| -------------- | ------------------------ | --------------------------- |
| ChatGPT 登录   | 授权 Codex 模型访问      | 使用 ChatGPT / Codex 时需要 |
| `LLM_API_KEY`  | 直接 OpenAI API          | 使用 API 模式时需要         |
| `APP_PASSWORD` | 保护远端访问的画布工作区 | 配置跨设备访问时需要        |
| `MCP_*`        | 授权某个外部工具服务     | 由该 MCP 服务决定           |
| GitHub token   | 维护者的发布工作权限     | 安装和匿名更新不需要        |

`/api/session` 的 `authenticated: true` 只描述工作区访问状态，不能用于判断 ChatGPT 是否登录、模型是否可用或是否有额度。

## 可选：项目工具、MCP 和桌面控制

先打开「本地任務」，填入**后端电脑**上的项目目录，启用并保存。可先用手动读取文件确认路径，再提出命令或写入操作；操作需要在界面确认。

在「整合設定」中可以添加 stdio／Streamable HTTP MCP，或选择 Windows 应用窗口。MCP 的启动／探索和每次调用均需确认；需要凭证时，只保存 `MCP_` 环境变量名称，值留在后端。桌面控制需要后端运行于 Windows 的交互式桌面，重启后重新选择窗口。

完整操作、浏览器 MCP 预设和记录导出见 [MCP 与桌面控制](mcp-desktop-traces.md)。ChatGPT 登录不会自动授权 MCP 服务；iPhone 页面控制的是后端窗口。

## 保存数据与升级

- 画布快速备份：使用顶部「备份与恢复」导出项目文件，包含文本、分支、来源和历史上下文包。
- 完整备份：先停止后端，保存安装根目录 `.env` 和完整 `data/`。这还包含模型登录、本地任务和操作截图；画布项目 JSON 不包含这些额外目录。
- Windows 包升级：在「版本與更新」匯入可信的新版本 ZIP，结束任务并保存／清空未发送文字，再点安装；更新保留数据，并在启动失败时恢复旧版本。
- 源码升级：停止后端，在 `main` 拉取修改，保留 `.env` 与 `data/`，执行冻结依赖安装、迁移、构建，再启动。

完整备份包含私密对话与登录状态，保存在自己的私有位置。不要用重新克隆到空目录的方式代替升级已有工作区。

## 常见问题

| 现象                                 | 检查方式                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 页面出现 Demo 回复                   | 在「模型與登入」连接账号并选择真实模式，点「使用此模式」                                                                          |
| 已连接 ChatGPT，但模型回答失败       | 刷新模型清单；查看最近一次 Codex 失败诊断，按具体错误检查账号、额度、模型或网络                                                   |
| 改了 `.env`，界面仍是旧模式          | 重新启动后端，并在模型界面重新选择；已保存的模式优先                                                                              |
| 提示端口被占用                       | 先关闭旧启动器／开发服务器，或更改 `API_PORT` 后重启                                                                              |
| 手机打不开电脑上的页面               | 按 [iOS 指南](windows-ios.md)配置 HTTPS 和工作区密码；手机的 localhost 指向手机自己                                               |
| 设置 HTTPS 后，本机 API 操作返回 403 | 电脑和手机都使用 `PUBLIC_ORIGIN` 指定的 HTTPS 地址，确认代理保留 Host                                                             |
| 检查更新返回 404                     | 确认 [Releases](https://github.com/Yukayuyu/synduck/releases) 已公开且有必要附件；旧客户端先手动升级到 0.5.3，不需要 GitHub token |
| 无法在源码安装中点安装新版           | 源码安装使用 Git 更新；一键切换版本由 Windows 管理式安装提供                                                                      |
| Windows 首次准备依赖失败             | 保留终端错误，确认能连接 Node.js／npm；不要跳过校验或省略 optional dependencies                                                   |

ChatGPT 详细诊断与跨设备登录说明见 [Windows 与 iOS 访问](windows-ios.md)。

## 同时进行多段对话

从 0.5.4 起，在一张卡片送出后，可点击另一张对话卡片继续输入并传送，也可以新建对话或从已保存的文字延伸分支。各张卡片分别显示生成文字和「停止」按钮；对话列表标记正在生成的对话。停止或失败只影响该段回答，可「使用原上下文重试」。

同一段对话仍按顺序提问，等待当前回答完成或停止后再送出。所有对话使用同一个已选模型、思考深度和账号；有任一回答生成时，模型／登录切换、项目整体恢复和程序更新安装需等待。并行不会扩大单轮上下文预算；每轮仍保存独立的输入包，账号服务的速率与额度限制仍适用。

使用旧版 Windows 安装时，取得完整 `ContextCanvas-Windows-0.5.4.zip`，在「版本與更新」匯入、安装并重启启动器。源码安装则拉取 main、重新构建前端并重启后端。详见[并行对话说明](concurrent-conversations.md)。

## 选择画布风格

右上角「⋯」→「画布外观」可切换 Arc 弧面、Paper 纸感和 Ink 墨色，选择立即预览并保存在当前浏览器。默认使用 Arc。三版均使用较大的弧形边框；摘录比对话更小，配合引文图标与独立底色辨识。切换不会重建卡片、修改原文或迁移数据。

输入区默认只显示传送与「选项」；预算与「预览上下文」在「选项」中。固定、排除、选择上下文等卡片功能改由卡片「⋯」或右键菜单打开。备份与帮助也在右上角「⋯」。见[三版 UI 对照](ui-styles.md)。

0.6.0 输入框左下角「＋」可分叉提问，摘录卡「收集」可汇合多处原文。见[主线、分叉和摘录汇合](thought-islands.md)。

0.7.0 可点左上角画布名称新建、切换、查找和重命名，草稿和上下文按画布分开。见[多画布与跨画布引用](multiple-canvases.md)。

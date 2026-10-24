# GitHub 发布与自动更新

0.5.3 起采用单仓库发布：源码、Windows 安装包、更新清单统一放在 `Yukayuyu/synduck`。普通用户只需下载安装包，不需要 GitHub token；安装和模型登录见[配置指南](setup.md)。

## 当前状态

| 项目           | 配置                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 开发与默认分支 | `main`，废弃分支已清理                                                                                                    |
| 源码与发布目标 | [Yukayuyu/synduck](https://github.com/Yukayuyu/synduck) 与同仓库 [Releases](https://github.com/Yukayuyu/synduck/releases) |
| 客户端更新来源 | 根 `release.config.json` 的 `repository: Yukayuyu/synduck`                                                                |
| 发布权限       | Actions 自动提供的 `GITHUB_TOKEN`，发布 job 单独申请 `contents: write`                                                    |
| 用户端权限     | 匿名下载，无需 GitHub 账号或 token                                                                                        |
| 许可证         | MIT，根目录和 Windows 包均包含 LICENSE                                                                                    |
| 线上发布前提   | 仓库必须是 Public，主分支 CI 和 Windows 打包测试成功，Release 包含三个必要附件                                            |

首次发布是否已经完成，请以 Releases 中实际出现的版本和附件为准。没有正式附件时，可使用源码或维护者提供的测试 ZIP；不能把草稿 Release、Actions artifact 或 Source code ZIP 当作 Windows 安装包。

```text
synduck/main → 版本标签 → 公开状态／main CI 检查 → Windows 构建与安装测试
                                                        ↓ 内置 GITHUB_TOKEN
同仓库 Releases → Windows ZIP、SHA-256、更新清单 → 客户端匿名检查／下载
```

## 首次设置

项目的更新来源、workflow 和打包已按单仓库方式配置。维护者只需确保 GitHub 满足以下条件：

1. 按[公开前审查记录](public-readiness.md)确认历史与 MIT 许可，然后在 **Settings → General → Danger Zone → Change repository visibility** 将仓库设为 Public。
2. 在 **Settings → Actions → General** 允许官方 `actions/*` 和 `pnpm/action-setup`。
3. 若有组织权限策略，允许发布 job 申请 `contents: write`，预检查 job 读取 Actions 状态。仓库默认工作流权限仍可保持只读。

不需要手动创建 `GITHUB_TOKEN` Secret，不需要 `RELEASE_PUBLISH_TOKEN`、第二个仓库、VPS、Pages 或云数据库。客户端也不读取旧 `UPDATE_GITHUB_TOKEN`。旧跨仓库发布凭证不再被工作流引用，可由维护者在 GitHub 撤销。

## 发布新版本

日常代码和文档推送到 `main` 只运行 CI。准备发布时，先修改根 `package.json` 的版本；可在 `docs/releases/<版本>.md` 写发布说明，打包器会同步放入更新清单与 Release 正文。

提交并推送 main 后，发布与版本完全相符的标签。例如当前版本是 `0.5.3`：

```powershell
git switch main
git pull --ff-only origin main
$releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
git tag -a "canvas-v$releaseVersion" -m "Context Canvas $releaseVersion"
git push origin "canvas-v$releaseVersion"
```

这会正式触发发布；不要重复运行已发布版本或覆盖既有标签。下一次先升级版本，再创建新标签。`0.5.4-beta.1` 这类带后缀版本会标记为 prerelease，仅测试频道接收。

工作流自动执行：

1. 确认更新源就是当前仓库、仓库为 Public、默认分支是 main、标签版本正确且提交已在 main 历史中。
2. 等待同一提交的 main CI 成功；失败时停止发布。
3. 在 Windows 安装固定依赖，执行类型检查、lint、单元／集成测试、构建与打包，再运行新旧启动入口的真实安装／回退测试。
4. 再次检查公开目标、版本、标签提交、ZIP 大小和 SHA-256，并核对 sidecar 校验文件。
5. 使用已存在的版本标签在**当前仓库**创建 Release，上传三个指定附件。

发布 job 使用的 token 只存在于 Actions，不写入安装包。工作流不自动创建第二个仓库，也不发布本机配置、用户数据或 Git 私有备份。

## 必须具备的附件

每个版本必须包含：

- `ContextCanvas-Windows-<版本>.zip`
- `ContextCanvas-Windows-<版本>.zip.sha256`
- `context-canvas-update.json`

Windows ZIP 包含编译程序、前端、固定运行依赖清单、MIT 许可证、六份中文设置指南和桌面桥接。真实 `.env`、画布、登录状态、开发 `node_modules` 和私有备份不会进入安装包。源码与历史则随主仓库公开，JavaScript 编译文件也可分析。

首次发布后，用未登录 GitHub 的浏览器确认附件能下载，再用低于发布版本的客户端检查更新，验证下载、校验和安装。新的运行安装会每 15 分钟检查，按设置下载；完成任务并保存／清空草稿后，由用户选择安装时间。后端关闭后不继续检查，也不是离线 Web Push。

## 旧测试安装的首次迁移

- **0.5.2** 读取之前的独立发布仓库。
- **0.5.1 及更早版本** 读取最初的私有更新来源。

先从 [synduck Releases](https://github.com/Yukayuyu/synduck/releases) 手动取得完整 `0.5.3` 或更新的 Windows ZIP，在原程序「版本與更新」匯入并安装，然后关闭整个启动器，再从原安装目录的 `Start-ContextCanvas.cmd` 启动。升级保留画布、模型设置、登录和本地任务。

更早且不支持管理式更新的旧包，按新版的 `Update-Existing.cmd` 迁移。已经存在 `.runtime/install.json` 的安装使用界面更新。仅改变 GitHub 可见性或仓库名不会修改已安装客户端内的来源。

源码安装使用 Git 更新，不通过 ZIP 覆盖 checkout。完整方法见[升级与恢复](local-runtime-updates.md)。

## 排查

| 现象                        | 处理                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| preflight 提示仓库必须公开  | 先完成 GitHub 可见性设置；无需创建 PAT                             |
| 提示 main CI 失败或等待超时 | 查看同一提交的 `Context Canvas` 工作流；修复后升级版本并发布新标签 |
| 提示标签／版本不一致        | 标签必须对应根 package.json，且来自 main；不要强行覆盖已发布标签   |
| 发布返回 403                | 检查发布 job 的 `contents: write` 和组织策略；用户端不需要 token   |
| 更新检查返回 404            | 确认仓库公开、Release 已发布、附件齐全；旧客户端先手动安装 0.5.3   |
| 更新检查返回 403／429       | 可能是匿名 API 共享出口限流，避免密集手动刷新                      |
| 检查成功但没有新版          | 新版必须高于本机，且频道包含它                                     |
| 源码安装不能点击安装        | 使用 Git 更新；一键切版由 Windows 管理式安装提供                   |

产品名可以与库名不同。日后若改库名，要同步修改 `release.config.json` 与链接；更新器会校验资产所属仓库，不能只依赖 GitHub 的旧地址跳转。

## 后续交付约定（2026-10-24）

拥有者已授权后续每个完成并通过测试的用户版本直接发布到自动更新频道，无需逐次确认。开发仍在 main：提升 package.json 版本、补发布说明，等待 main CI 成功后推送匹配的 `canvas-v<版本>` 标签；现有 Release 工作流自动构建、验证并发布附件。已发布的版本与标签不覆盖，失败或未完成的改动不发布。这是交付时的默认发布约定，不代表每个 main 提交都会自动创建 Release。

客户端仍匿名检查并按设置下载；安装时机由使用者决定，以保护正在生成的回答和未送出的文字。

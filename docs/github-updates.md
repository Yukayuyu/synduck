# GitHub 发布与自动更新配置

这份说明面向维护者。普通用户的安装、模型登录和更新操作见[安装与配置指南](setup.md)；普通用户不需要 GitHub token。

## 当前状态

截至 2026-10-24，版本为 0.5.2：

| 项目           | 当前状态                                                        |
| -------------- | --------------------------------------------------------------- |
| 开发仓库       | `Yukayuyu/synduck`，仍为私有；开发与交付使用 `main`             |
| 许可证         | MIT，根目录 LICENSE 与 Windows 包均已包含                       |
| 分支           | 已清理废弃分支，仅保留 `main`                                   |
| 正式 Release   | 尚未发布，源码仓库目前没有 Windows 下载附件                     |
| 更新器来源     | `release.config.json` 仍指向 `Yukayuyu/context-canvas-releases` |
| 现有发布工作流 | 向独立发布仓库上传附件，需要维护者的 `RELEASE_PUBLISH_TOKEN`    |
| 公开更新目标   | 该独立仓库本次检查返回 404，尚无可用的公开更新入口              |
| 计划方案       | 公开主仓库并使用同仓库 Releases；代码迁移尚未实施               |

MIT 许可证、仓库公开、成功构建和创建 Release 是分别完成的步骤。源码公开本身不会修改更新器地址、生成 Windows 安装包或触发一次发布。返回 404 时先核对上述状态，不要让使用者填写私有仓库读取 token。

## 推荐配置：一个公开主仓库

目标流程：

```text
公开 synduck/main → 推送版本标签 → Actions 验证和打包
                                      ↓ 内置 GITHUB_TOKEN
同仓库 Releases → Windows 安装包与更新清单 → 客户端匿名更新
```

这条路径不需要独立发布仓库、发布 PAT、VPS、GitHub Pages 或云数据库。`GITHUB_TOKEN` 由 Actions 每次运行自动提供，只在发布 job 申请 `contents: write`；普通安装不携带这个凭证。

### 第一步：完成发布代码的迁移

下面这些是**尚未实施的迁移要求**，并非目前只需点击 GitHub 设置就能生效：

1. 将根目录 `release.config.json` 的 `repository` 改为 `Yukayuyu/synduck`。更新器与打包器读取这个统一设置。
2. 修改 `.github/workflows/release.yml`，发布目标改为当前仓库，使用内置 `${{ github.token }}`，在发布 job 设置 `permissions: contents: write`，移除跨仓库 Secret 前置条件。
3. 发布前校验版本标签与 `package.json`、更新清单一致，目标仓库可公开读取；同仓库发布使用已推送的版本标签，不再为独立 README 仓库创建标签。
4. 同步更新下载地址、测试和说明；运行 Windows／Linux CI，并验证真实的安装、回退与更新来源。

只修改仓库可见性或这份文档，现有 workflow 仍会按双仓库方式执行。完成代码迁移后，维护者再进行下面的 GitHub 配置与正式发布。

### 第二步：确认 GitHub 设置

1. 按[公开前检查](public-readiness.md)确认要公开的历史和许可证，再将主仓库设置为 Public。本次文档修改没有执行该操作。
2. 在 **Settings → Actions → General** 允许 GitHub 官方 `actions/*` 和 `pnpm/action-setup`。
3. 确认组织政策允许发布 job 申请 `contents: write`。仓库默认工作流权限可以保持只读，由发布 job 单独申请写入。
4. 不需要手动创建名为 `GITHUB_TOKEN` 的 Secret。完成迁移后，也不再依赖旧的 `RELEASE_PUBLISH_TOKEN`。

产品名可以和仓库名不同。如果之后重命名仓库，需一起调整更新来源、发布目标和文档链接；不能只依靠 GitHub 的旧地址跳转，因为更新器会校验资产是否属于指定仓库。

### 第三步：从 main 发布一个版本

**仅在前两步完成、主仓库已公开、迁移后的 CI 已通过后执行。** 以下命令会正式触发发布：

```powershell
git switch main
git pull --ff-only origin main
$releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
git tag -a "canvas-v$releaseVersion" -m "Context Canvas $releaseVersion"
git push origin "canvas-v$releaseVersion"
```

例如 `package.json` 为 `0.5.2`，标签必须是 `canvas-v0.5.2`。后续每次更新先升版本，再推新标签。不要覆盖已发布标签或同版本安装包；同版本不会作为新版推送给现有用户。

推送 `main` 只运行 CI，推送 `canvas-v*` 标签才触发 `Context Canvas release`。带后缀的版本如 `0.5.3-beta.1` 会标为 prerelease，仅测试频道接收。

### 第四步：验证公开下载与自动更新

成功的公开 Release 必须包含以下三个附件：

- `ContextCanvas-Windows-<版本>.zip`
- `ContextCanvas-Windows-<版本>.zip.sha256`
- `context-canvas-update.json`

在未登录 GitHub 的浏览器验证附件可下载。只有 Source code ZIP、Actions 临时 artifact、Git 标签或草稿 Release，都不足以用于程序更新。

首次安装：下载 Windows 附件、完整解压、双击 `Start-ContextCanvas.cmd`。更新验证：使用一个版本号较低的管理式安装，在「版本與更新」中检查、下载并校验，再结束任务、保存／清空草稿并选择安装。版本必须更高，且当前频道包含该版本。

程序会在后端运行时每 15 分钟检查和按设置下载新版；安装时间由用户选择。浏览器通知是运行期间的提示，不是关闭后端后仍工作的 Web Push。完整过程见[版本更新说明](local-runtime-updates.md)。

## 当前实现：双仓库发布方式

这一节用于解释**现有代码**；只有继续选择双仓库发布时才需要这些维护者设置。单公开仓库方案完成迁移后可移除此节。

1. 建立并初始化公开 `Yukayuyu/context-canvas-releases`，只存放发布文件与说明。
2. 创建 Fine-grained token，只授权该公开发布仓库 **Contents: Read and write**，不授予私有源码读取或额外 Actions／Workflows 写入。
3. 在**源仓库 synduck** 的 **Settings → Secrets and variables → Actions** 保存为 Repository secret `RELEASE_PUBLISH_TOKEN`。只在 GitHub 的安全输入框填写；不放入 `.env`、安装包、前端或聊天。
4. 确认 Actions 可执行，推送与版本相符的标签。现有 preflight 会检查凭证及公开目标，Windows 打包／测试通过后才发布。

源仓库内置的 `GITHUB_TOKEN` 不能直接跨仓库写入，所以这条路径需要额外发布凭证。凭证仅由维护者配置；客户端匿名下载，不读取 `UPDATE_GITHUB_TOKEN`、`GH_TOKEN` 或 `GITHUB_TOKEN`，也不发送 Authorization header。

Windows 包使用编译后的后端与启动器、前端产物、固定运行依赖、MIT 许可证、使用说明和桌面桥接；不附开发源码树、source maps、Git 历史、真实配置或登录数据。分发的 JavaScript 仍可分析，编译不能保护嵌入其中的秘密。

## 旧安装切换更新来源

0.5.1 及更早版本仍读取最初的私有仓库更新来源，需要先取得完整新版 ZIP，在程序中手动匯入、安装，再关闭并重新启动整个启动器。更早且不支持界面安装的旧包，按新版的 `Update-Existing.cmd` 迁移。

之后若从独立发布仓库改回同仓库 Releases，同样要把包含新更新来源的版本先提供给旧安装；在原更新来源发布一个迁移版本，或提供手动 ZIP。仅改服务器上的仓库可见性不会修改已安装客户端内的更新地址。

保留原 `.env` 和 `data/`。不再需要的私有更新 token 可从配置移除，并在 GitHub 撤销；不要复制维护者发布凭证给安装用户。

## 排查发布与更新失败

| 现象                           | 维护者检查                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| 现有 preflight 提示缺少 Secret | 仍在运行双仓库 workflow；选择保留该方案并设置凭证，或先完成单仓库迁移              |
| 目标／附件返回 404             | 目标尚不存在、仍是私有、没有正式 Release，或客户端仍指向旧地址                     |
| 发布返回 401／403              | 确认当前采用哪种发布方案，再检查 job 权限、组织策略或跨仓库凭证                    |
| 更新检查返回 403／429          | 也可能是匿名 GitHub API 共享出口限流，避免密集手动刷新；用户无需提供私有仓库 token |
| 没有新版                       | 附件必须齐全、版本高于本机、频道匹配，且 Release 已发布                            |
| 源码安装不能点安装             | 使用 Git 更新源码；完整一键切版由 Windows 管理式安装提供                           |

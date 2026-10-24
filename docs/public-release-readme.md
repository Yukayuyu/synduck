# Context Canvas

在大画布上阅读对话、摘取文字并延伸分支，查看 AI 使用的上下文，回看本地工具和窗口操作。

## 下载与启动

1. 在 [synduck Releases](https://github.com/Yukayuyu/synduck/releases) 下载 `ContextCanvas-Windows-<版本>.zip` 附件；不要选择自动生成的 Source code ZIP。
2. 完整解压缩，双击 `Start-ContextCanvas.cmd`。支持 Windows x64／ARM64，首次启动会联网准备 Node.js 24 和固定运行依赖。
3. 保持启动器窗口开启，使用自动打开的浏览器。可以先用不调用真实模型的 Demo 模式。
4. 使用真实模型时，在「模型與登入」登录自己的 ChatGPT 账号，选择 ChatGPT / Codex、模型和思考深度，再点「使用此模式」。也可以按说明配置直接 API 模式。

安装和更新不需要 GitHub 账号或 token。模型账号及外部 MCP 服务仍分别使用自己的授权。完整中文指南在安装包的 `app/docs/setup.md`，或阅读仓库中的[配置指南](setup.md)。

## 从旧测试安装升级

0.5.2 及更早版本先手动取得完整 0.5.3 或更新的 ZIP，在原程序匯入并安装，再关闭并重新启动整个启动器。较早的安装可按说明使用新包的 `Update-Existing.cmd`。保留原安装的 `.env` 与 `data/`，升级不会要求重新建立画布或复制发布者的 token。

后续通过「版本與更新」检查、下载并选择安装时间。后端运行期间每 15 分钟检查；关闭后端后不继续检查。

## 运行与许可

程序在后端电脑运行。iPhone／iPad 通过可信 HTTPS 连接该后端，MCP 和桌面控制按具体服务登录及逐次操作确认执行。

源码、问题反馈、安装包与更新清单统一位于 `Yukayuyu/synduck`。项目采用 MIT 许可证，许可正文随包提供；第三方依赖和资产保留各自许可证。首次 Release 成功后下载入口生效，没有附件时可从源码运行。

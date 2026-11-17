# Claude 模式（0.16.0）

用你自己的 Claude API key，让画布对话由 Claude 回答。

## 连接

1. 在 [Claude Console](https://platform.claude.com/settings/keys) 建立一把 API key。API 用量按 Claude API 的价格计费，与 claude.ai 的订阅方案分开。
2. 打开「模型與登入」，「回答模式」选「Claude」。
3. 贴上 API key，点「連接」。程序先用一次不计费的模型列表请求确认 key 有效，才会保存。
4. 选择模型，点「使用此模式」。默认是 Claude Opus 5.5。

连接后只显示 key 的末四位。点「移除 API key」会删除保存的 key，并切回示范模式。

也可以不经界面，在后端 `.env` 设置 `ANTHROPIC_API_KEY`（可选 `CLAUDE_MODEL`）。界面保存的 key 优先。

## 为什么是 API key，不是登录 claude.ai 账号

Anthropic 不允许第三方产品提供 claude.ai 账号登录或使用其订阅额度，所以这里没有像 ChatGPT / Codex 那样的账号登录。API key 是官方支持的接入方式。

## key 的保存

- 保存在后端数据目录的 `claude/credentials.json`，文件权限仅限本机用户；不是加密保险箱。
- 不会回传给浏览器，不写入日志、画布、导出的项目文件或错误信息。
- 本地项目工具不能读取这个目录。
- 完整的数据目录备份包含这把 key，请私下保存。

## 行为与限制

- 与其他模式一样，只发送上下文检查器显示的内容；回答必须符合固定结构，并且只能引用提供的来源，否则不会保存。
- 回答以流式显示。Claude 因安全原因拒绝请求时，API 会按拒绝类别改由对应的后备模型重新处理；整条链都拒绝时，界面会显示被拒绝。
- 目前是纯文字回答：本地项目文件、终端、MCP 和桌面控制仍只在 ChatGPT / Codex 模式可用。
- 背景摘要、脉络链在 Claude 模式下同样生效。

## 验证范围

自动化测试用替身客户端覆盖 key 的校验与保存、请求内容、流式草稿、各类错误与取消；没有用真实的 Claude API key 做过端到端请求。第一次使用时请先发一条简短问题确认。

# Context Canvas

在大畫布上閱讀對話、摘取文字並延伸分支，檢視 AI 使用的上下文，以及回看本地工具和桌面操作紀錄。

## 下載與啟動

1. 開啟 [Releases](https://github.com/Yukayuyu/context-canvas-releases/releases)，下載最新正式版的 `ContextCanvas-Windows-<版本>.zip`。請下載這個附件，而非 GitHub 自動產生的 Source code ZIP。
2. 完整解壓縮，再雙擊 `Start-ContextCanvas.cmd`。支援 Windows x64／ARM64，首次啟動需要連網安裝執行依賴；保持啟動器視窗開啟。
3. 在程式「模型與登入」連接自己的 ChatGPT 帳號或設定模型服務；可先以 Demo 模式試用畫布。

下載與更新不需要 GitHub 帳號或 token。程式內「版本與更新」可檢查新版本、設定通知及選擇安裝時間；更新保留畫布、登入、模型設定和任務紀錄。

已有 0.5.1 或更早版本時，先下載新版 ZIP，在原程式匯入更新包並安裝，然後關閉並重新啟動整個啟動器。較早的安裝可依包內說明使用 `Update-Existing.cmd`。請先備份重要資料，勿刪除原安裝的 `data/` 或 `.env`。

此倉庫提供發布檔案與更新資訊。公開包含編譯後的應用程式與可檢視的執行資源；開發原始碼與 Git 歷史另行維護。程式在本機執行；使用模型、MCP 或桌面控制時，仍由各服務的登入和程式內的操作確認決定權限。

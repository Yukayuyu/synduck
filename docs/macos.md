# 在 macOS 啟動 Synduck

適用版本：0.12.0。支援 Apple Silicon（M1 或更新）及 Intel Mac；使用官方 Node.js 24，最低 macOS 13.5。這是本地後端加瀏覽器的可攜式 ZIP，無需 Homebrew、預先安裝 Node.js 或 Git。

1. 從本專案 Releases 下載 `ContextCanvas-macOS-0.12.0.zip`，不要下載 Source code ZIP。
2. 完整解壓，將 `ContextCanvas-macOS` 資料夾放到希望長期保留的位置。
3. 雙擊 `Start-Synduck.command`。首次啟動需連上 nodejs.org 和 npm，會選擇原生架構、校驗固定 SHA-256，再準備固定版本依賴；不需管理員權限。
4. 出現 `Context Canvas is ready` 後會自動開啟瀏覽器；也可開啟 <http://127.0.0.1:3001>。保持終端機視窗開啟，按 Control+C 停止。
5. 首次預設為 Demo。開啟「模型與登入」完成 ChatGPT 官方授權，選擇可用的 Codex 模型與思考深度，即可在畫布提供本機專案路徑並授權開發。

此 ZIP 未提供 Apple 簽署／公證的 `.app`。若 macOS 攔截 `.command`，依系統提示在「系統設定 → 隱私權與安全性」允許開啟；部分版本可按右鍵選「打開」。也可開啟終端機，輸入 `bash `，把 `Start-Synduck.command` 拖入視窗後按 Enter。不需要關閉 Gatekeeper 或全域移除隔離屬性。

## 資料與更新

畫布、登入及專案／MCP 設定保存在安裝資料夾的 `data/`；根 `.env` 是設定檔，`.runtime/` 保存啟動與恢復資料，`versions/` 保存後續版本。完整備份前停止程式，保存整個資料夾；不要以解壓新包覆蓋既有資料來升級。

從「版本與更新」檢查／下載新版，再由你決定安裝和重啟。Mac 讀取獨立的 Mac 更新清單，不會下載 Windows 包；可匯入同平台 ZIP。更新保留畫布與登入，失敗時恢復上一版及資料備份。來源碼安裝仍使用 Git 更新。

本地檔案、終端、ChatGPT / Codex 和已設定的 MCP 可在 Mac 使用。程式操作的是執行後端的 Mac，專案路徑例如 `/Users/你的名稱/Projects/synduck`。Windows 的 `G:\…` 路徑不能直接套用到 Mac；Git、建置工具及專案依賴按實際需求另外安裝。現有桌面視窗擷取／輸入驅動只支援 Windows，Mac 桌面控制尚未接入。

若端口已被佔用，先關閉先前的 Synduck 終端機；需要改端口時，停止後在根 `.env` 設定 `API_PORT` 再啟動。不要同時開啟同一安裝的多個啟動器，也不要刪除更新中的恢復檔案。

# Windows、iPhone／iPad 與 ChatGPT 帳號

這是單一擁有者的網頁工作區。Windows 或 Linux 執行 Node.js 後端、SQLite 與官方 Codex；iPhone／iPad 以 Safari 連到同一個後端。不是 iOS 原生 App，也不能在手機上獨立執行後端。後端電腦必須保持開機。

## Windows 本機啟動

安裝 Git、Node.js **24.19.0** 與 pnpm **11.19.0**。在 PowerShell 執行：

```powershell
git clone --branch feat/ai-context-canvas https://github.com/Yukayuyu/synduck.git
cd synduck
pnpm install --frozen-lockfile
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
pnpm db:migrate
pnpm build
pnpm start
```

在同一台電腦的瀏覽器開啟本機的 **3001** 連接埠。開發時可改用 `pnpm dev`，前端為 **3000**，API 為 **3001**；新的 Node 啟動器不依賴 Unix 環境變數語法或 shell 單引號。正常使用請採用 `build` + `start`。

官方 `@openai/codex` **0.160.0** 已鎖定在依賴中，安裝時會取得對應 Windows x64／ARM64 或 Linux／macOS 的原生程式。不要使用忽略 optional dependencies 的安裝方式。本程式透過 Node 直接啟動套件內的原生程式，不執行使用者提供的 shell 命令。

本次開發已在 Linux 驗證；Windows 原生執行仍須由 Windows CI／實機確認，不能把這份啟動說明當作已通過 Windows 驗收。

## 使用 ChatGPT 登入

1. 開啟右上方 **模型與登入**。
2. 點 **使用 ChatGPT 帳號登入**。
3. 點官方授權連結，在 `auth.openai.com` 登入並輸入顯示的一次性代碼。可在 Windows 或 iPhone 上完成，不需要把 API key 貼進程式。
4. 等待顯示「已連接」，選擇 **ChatGPT / Codex**，再點 **使用此模式**。
5. 正常建立對話、預覽上下文、發送。每則 AI 回答仍保存來源與實際模型識別。

此流程使用官方 App Server 的 `account/login/start` / `chatgptDeviceCode`，不是自行建立通用「ChatGPT OAuth 應用」。需要你的帳號具有 Codex 使用資格；裝置碼登入可能需要在 ChatGPT 安全性設定中啟用，組織也可能限制此功能。額度與模型存取依你的帳號方案而定。若代碼過期，可取消後重新登入。

登入憑證由官方 Codex 保存在 `data/codex/`，只屬於這個後端工作區，不會讀取或修改你平常 Codex 的登入。所有連接這個工作區的裝置共用該帳號；這不是多使用者服務。登出 ChatGPT 不會刪除畫布內容，也不會登出你其他 Codex 安裝。請用作業系統帳戶保護後端的 `data/`，尤其 Windows 檔案權限應由系統 ACL 管理。

選擇的模式保存在 `data/model-settings.json`，重新啟動後保留；檔案存在時優先於 `LLM_PROVIDER`。可用 UI 改回示範模式。Codex 模型由 `CODEX_MODEL` 設定，預設 `gpt-5.4`；變更後重啟 API。API 模式仍使用 `LLM_MODEL` 與 `LLM_API_KEY`，與 ChatGPT 登入分開。

生成使用獨立、短暫的 Codex thread，不沿用其他對話；內容來源仍經過本程式的 Context Compiler。沒有掛載工作區環境或動態工具，並停用 shell、網頁搜尋、外掛、記憶等功能；宿主拒絕工具和批准請求。Codex 自己仍會加入執行環境與協定指令，因此檢查器顯示的是應用層輸入，不是完整的 Codex 內部請求或精確計費 token 數。只有通過 JSON schema 與來源 ID 驗證的完整回答才會儲存。此版本仍不會自動執行 AI 提出的圖形變更。

## 在 iPhone／iPad 開啟

需要一個 iPhone 可到達、具有可信 HTTPS 憑證的網址，指向這台後端。可使用你管理的 HTTPS 反向代理，或私人網路的 HTTPS 服務。不要把 Vite 開發伺服器當成手機部署入口。

在後端 `.env` 中設定：

```dotenv
API_HOST=127.0.0.1
API_PORT=3001
PUBLIC_ORIGIN=https://canvas.your-domain.example
APP_PASSWORD=<請自行設定至少16字元的獨立工作區密碼>
```

`PUBLIC_ORIGIN` 必須和手機開啟的網址完全一致，不含結尾斜線。`APP_PASSWORD` 是工作區密碼，不是 OpenAI API key。不要將它加入 Git 或傳到聊天。設定完成後重新執行 `pnpm build`、`pnpm start`。

同一台機器上的 Caddy 設定範例：

```caddyfile
canvas.your-domain.example {
    reverse_proxy 127.0.0.1:3001
}
```

將範例換成你擁有的網域，設定 DNS、可信 TLS 憑證及必要的反向代理連線；後端 3001 保持本機監聽。若使用其他反向代理，需保留原始 Host，並允許串流回覆、不緩衝整段回答。手機若透過私人網路存取，也必須連上該網路。本次工作沒有替你購買網域、發布網站或安裝 VPN。

1. iPhone 用 Safari 開啟你設定的 HTTPS 網址。
2. 輸入工作區密碼。12 小時後或後端重啟後需重新登入。
3. 使用底部浮動工具列的 **提問／畫布／對話／上下文**。對話與上下文面板按需展開，畫布始終保留在後方。預覽會打開上下文面板，檢查後回到卡片發送。
4. Safari「分享」→「加入主畫面」可作為獨立視窗開啟。

頁面提供 manifest、主畫面圖示、安全區域與觸控適配；不提供離線儲存或離線 AI，沒有 service worker 快取私人對話。資料始終保存在後端，重新載入可取得其他裝置的最新狀態；目前不是即時多人同步。

## 驗證與限制

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm exec playwright install webkit
pnpm exec playwright test --config playwright.webkit.config.ts
```

39 項單元／整合測試與 9 項 Chromium 瀏覽器測試通過，包括手機尺寸／觸控、選區分支、模式登入 UI、工作區登入與到期，以及既有備份恢復流程。官方 Codex 0.160.0 的隔離目錄啟動與未登入帳號狀態已實際驗證；OAuth 完成與付費模型生成使用協定模擬，尚未使用你的真實帳號驗證。

這個雲端環境阻擋 WebKit 下載網域，Safari／WebKit 測試尚未執行。Windows CI 和 WebKit CI 已加入設定，但尚未觀察遠端執行結果。仍需實際 iPhone 確認 Safari 原生選取把手、鍵盤與主畫面安裝體驗。

受限網路至少需允許 Codex 的 `auth.openai.com`、`chatgpt.com`（帳號／模型請求），API 模式需 `api.openai.com`。瀏覽器安裝需 `cdn.playwright.dev`、`playwright.download.prss.microsoft.com`。請保留 TLS 驗證；不要用停用驗證或複製其他工具登入憑證的方法繞過問題。

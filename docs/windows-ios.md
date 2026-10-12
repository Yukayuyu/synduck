# Windows、iPhone／iPad 與 ChatGPT 帳號

0.3.0 增加 MCP 連接、Windows 目標視窗控制與畫布操作回看，請參閱 [MCP、桌面控制與追溯](mcp-desktop-traces.md)。iOS 頁面操作的是後端電腦；本機 Windows 擷取／輸入仍須實機驗證。

0.2.0 增加獨立的本地任務工具通道與啟動器更新；請參閱[本地執行器與更新](local-runtime-updates.md)。下文的文字回答限制仍適用於一般畫布回答；本地任務需另外設定專案，命令／寫檔逐次確認。

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
4. 等待顯示「已連接」，選擇 **ChatGPT / Codex**，從 **Codex 模型** 選單選擇模型，再選 **思考深度** 並點 **使用此模式**。**刷新模型列表** 會重新讀取官方 Codex 的模型目錄及支援的深度。
5. 正常建立對話、預覽上下文、發送。每則 AI 回答仍保存來源與實際模型識別。

此流程使用官方 App Server 的 `account/login/start` / `chatgptDeviceCode`，不是自行建立通用「ChatGPT OAuth 應用」。需要你的帳號具有 Codex 使用資格；裝置碼登入可能需要在 ChatGPT 安全性設定中啟用，組織也可能限制此功能。額度與模型存取依你的帳號方案而定。若代碼過期，可取消後重新登入。

登入憑證由官方 Codex 保存在 `data/codex/`，只屬於這個後端工作區，不會讀取或修改你平常 Codex 的登入。所有連接這個工作區的裝置共用該帳號；這不是多使用者服務。登出 ChatGPT 不會刪除畫布內容，也不會登出你其他 Codex 安裝。請用作業系統帳戶保護後端的 `data/`，尤其 Windows 檔案權限應由系統 ACL 管理。

模式及 Codex 模型保存在 `data/model-settings.json` 的 `provider` / `codex_model`，重新啟動後保留；已儲存的選擇優先於 `LLM_PROVIDER` / `CODEX_MODEL`，切換到示範或 API 模式也保留 Codex 模型。舊版只有 `provider` 的設定檔仍可讀取。`CODEX_MODEL` 僅作為尚未保存模型時的初始設定，新安裝不再固定使用某個模型版本；在選單保存模型即可生效，無須編輯 `.env` 或重啟 API。API 模式仍使用 `LLM_MODEL` 與 `LLM_API_KEY`，與 ChatGPT 登入分開。

選單只顯示官方目錄中的可見文字模型，排除已到退役時間的項目；不是寫死的模型清單。官方預設會標示在選項中，但仍需點 **使用此模式** 保存。若舊 `.env` 或設定檔的模型已不在目錄，選單會提示重新選擇，不會自動切換模型。列表讀取失敗可按刷新重試，生成期間不能切換，以維持回答與模型記錄一致。目錄列出某個模型仍不保證當次生成的額度或服務狀態。

**思考深度** 只列出所選模型在官方目錄公布的值，例如低／中／高／很高；不同模型的選項可能不同，未見過的深度值也會按官方識別顯示。**模型預設** 不覆寫 Codex 的深度；沒有可調整深度的模型只提供這個選項。較高深度通常需要較長的回答時間。切換模型會把未保存的深度改為模型預設，可再選擇；刷新列表保留未保存的選擇。已保存的深度若不再支援，需明確重新選擇或改回模型預設。

深度保存在同一設定檔的 `codex_reasoning_effort`；沒有該欄位或值為 `null` 時使用模型預設，舊版設定檔可直接使用。點 **使用此模式** 後立即生效，重啟或切換示範／API 模式也保留；改回模型預設會移除深度覆寫。後端保存前再次檢查模型支援的深度，並在正式 Codex `turn/start` 的 `effort` 傳送選擇。生成期間不能修改模型或深度。此功能不改動 SQLite 格式。

生成使用獨立、短暫的 Codex thread，不沿用其他對話；內容來源仍經過本程式的 Context Compiler。沒有掛載工作區環境或動態工具，並停用 shell、網頁搜尋、外掛、記憶等功能；宿主拒絕工具和批准請求。Codex 自己仍會加入執行環境與協定指令，因此檢查器顯示的是應用層輸入，不是完整的 Codex 內部請求或精確計費 token 數。只有通過 JSON schema 與來源 ID 驗證的完整回答才會儲存。此版本仍不會自動執行 AI 提出的圖形變更。

## 已登入但回答失敗

「已連接 · plus」表示官方 Codex 能讀到已登入帳號，不保證模型生成成功。`/api/session` 的 `authenticated: true` 只表示本應用的工作區存取正常，與 ChatGPT 模型權限、Codex 額度或生成服務連線分開。

新版會區分額度不足、速率限制、授權失效、HTTP 403、模型不可用、JSON 格式規格遭拒、請求參數遭拒、串流／網路中斷、工具限制及三分鐘生成逾時。Codex 的 `plan` 和 `contextCompaction` 是協定中的內部狀態事件，不會再被誤判為外部工具執行；命令、檔案、外部工具等操作仍停止生成。最終回答也可從已完成 turn 的 payload 或完整串流讀取，並保留格式與來源驗證；commentary 不會當作最終回答儲存。

失敗後開啟 **模型與登入 → 最近一次 Codex 回答失敗的診斷**，查看錯誤碼、模型、階段及耗時。也可在本機瀏覽器讀取 `/api/models/codex/diagnostics`；這份 JSON 不含信箱、憑證、對話文字、原始 provider 錯誤或檔案路徑。診斷只保存在執行中的程式記憶體，重啟後需再次提交失敗的請求才能查看。

幾秒內就出現的錯誤不是本程式的三分鐘生成逾時。請先查看實際分類，再依結果檢查模型設定、帳號狀態或網路；不要只根據登入成功或舊版的共用錯誤文案推斷額度不足。本機實際錯誤仍需在該電腦確認，雲端測試不能讀取本機的失敗原因。

更新原始碼或啟動包前，先停止後端。保留原本的 `.env` 與完整 `data/`（包含 SQLite WAL、`model-settings.json` 及 `codex/`），再覆蓋應用程式來源與建置檔案並啟動。不要刪掉原工作區後改在全新的資料夾啟動，否則會看見新的空白工作區。

正在編輯的卡片現在會在縮小畫布時保留編輯器；生成期間改為唯讀，避免禁用輸入框造成焦點丟失。瀏覽器回歸驗證保留文字、選取範圍和游標，包括模擬五分鐘經過與回答失敗；程式沒有每五分鐘重設輸入焦點的計時器。

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

50 項單元／整合測試與 15 項 Chromium 瀏覽器測試通過，包括手機尺寸／觸控、選區分支、模式登入 UI、模型目錄分頁／過期選擇／保存與重啟、思考深度的模型能力／保存／預設／實際請求參數、切換期間生成的競態、模型來源記錄、安全錯誤分類與診斷、輸入焦點／游標保留、工作區登入與到期，以及既有備份恢復流程。官方 Codex 0.160.0 的隔離目錄啟動、未登入帳號狀態與實際 RPC 錯誤分類已驗證；模型目錄、OAuth 完成與付費模型生成使用協定模擬，尚未使用你的真實帳號驗證。

這個雲端環境阻擋 WebKit 下載網域，Safari／WebKit 測試尚未執行。Windows CI 和 WebKit CI 已加入設定，但尚未觀察遠端執行結果。仍需實際 iPhone 確認 Safari 原生選取把手、鍵盤與主畫面安裝體驗。

受限網路至少需允許 Codex 的 `auth.openai.com`、`chatgpt.com`（帳號／模型請求），API 模式需 `api.openai.com`。瀏覽器安裝需 `cdn.playwright.dev`、`playwright.download.prss.microsoft.com`。請保留 TLS 驗證；不要用停用驗證或複製其他工具登入憑證的方法繞過問題。

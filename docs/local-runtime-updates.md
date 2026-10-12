# 本地執行器與版本更新

本頁描述 0.2.0 的基礎執行器與更新機制；0.3.0 已增加 MCP、Windows 視窗控制與畫布操作回看，請參閱 [MCP、桌面控制與追溯](mcp-desktop-traces.md)。

版本 0.2.0 增加本地任務與受啟動器管理的版本更新。第一版支援專案目錄、UTF-8 文字檔案與 shell 命令；MCP、任意第三方 API、螢幕／滑鼠／鍵盤控制仍未接入。

## Windows 使用與首次升級

解壓縮整個 `ContextCanvas-Windows-0.2.0.zip`，雙擊 `Start-ContextCanvas.cmd`。啟動器會使用 Node 24，必要時下載已鎖定 SHA-256 的可攜版本，再安裝 pnpm 11.19.0 與 lockfile 依賴。保持啟動器視窗開啟。

從先前提供的 Windows 包升級：

1. 停止舊版啟動器。
2. 解壓縮新包，執行**新包的** `Update-Existing.cmd`，選擇舊安裝的根目錄。
3. 校驗程式與啟動檔案後，更新會在原安裝啟動，保留舊 `app/.env`、`app/data/`，並將它們複製到穩定的根目錄 `.env`、`data/`。舊副本不會自動刪除。
4. 之後使用原安裝的 `Start-ContextCanvas.cmd`。後续更新可從「版本與更新」匯入 ZIP 或取得 GitHub 發佈版本。

已使用新啟動器的安裝，請使用介面更新；`Update-Existing.cmd` 只用於舊包首次轉換。

## 本地任務

右上方的終端圖示開啟「本地任務」。輸入**後端電腦**上的完整專案路徑，勾選啟用並保存。初次安裝預設不啟用；可用 `LOCAL_PROJECT_ROOT` 設定初始專案，已保存的 UI 設定優先。

「手動測試」不需要 ChatGPT 登入，可先列目錄、讀取文字檔，或提出 `node --version`。命令與寫檔都需確認本次具體操作。寫檔顯示原內容與新內容；若檔案在等待期間被修改，確認會失效，避免覆蓋其他編輯。

「AI 任務」使用已選的 ChatGPT / Codex 模型與思考深度。請先在「模型與登入」完成官方登入並選用 Codex。模型有四個動態工具：`canvas_list_files`、`canvas_read_file`、`canvas_write_file`、`canvas_run_command`。工具結果會交回同一個模型，接續生成；命令／寫檔等候使用者確認。

需要畫布內容時，先在畫布預覽上下文，再勾選「附上目前已預覽的畫布上下文」。過期或不可送出的包會被拒絕。本地任務是獨立的任務紀錄，不會把工具結果偷偷加入已封存的 Canvas Context Package，也不會自動修改畫布。可按「將紀錄加入畫布提問」，將帶 task/action ID 的節錄放入草稿，再照原流程預覽與送出。

- 讀寫使用相對路徑，不跟隨符號連結；應用資料／登入目錄、`.env` 與常見私密路徑不可經檔案工具讀寫。支援不超過 64 KB 的 UTF-8 文字檔，單次讀取回傳最多 20 KB 並標明節錄。
- **命令以後端電腦的 OS 帳戶權限執行。** 指定專案只是工作目錄，不是 OS 沙盒。確認畫面顯示 PowerShell（Windows）或 sh（其他主機）實際執行的命令；沒有「永久允許所有命令」。子程序不繼承應用的 API key 或更新 token。
- 命令預設 60 秒，上限 120 秒；输出大小有限。停止會終止命令程序樹／程序群組，不會撤銷已完成的檔案修改。
- 每個 AI 任務最多 20 次工具操作，工具結果有總體大小限制，任務最多 15 分鐘。任務一次只執行一個，執行中不能切換專案、模型或更新。
- 任務與工具歷史保存在 `data/local-runtime/`，含實際專案內容與輸出，只留在後端。重新啟動後保留歷史，但不會重試未完成的操作。UI 列出最近 50 個任務，旧 JSON 紀錄仍在磁碟上。
- 原生畫布 JSON 備份不包含這個獨立任務目錄；備份完整 `data/` 時才包含任務、模型設定與登入。應在後端停止時備份，或使用合適的 SQLite 備份功能。

由 iPhone／iPad 開啟頁面時，任務仍在 Windows／雲端後端執行，不會因此操控手機其他 App。跨裝置的工作區登入與 HTTPS 要求繼續適用。

## 更新與通知

右上方下載圖示開啟「版本與更新」。預設每 15 分鐘檢查 `Yukayuyu/synduck` 的 GitHub Releases，接收測試版與正式版，自動下載並校驗，但**不自動中斷工作安裝**。可改只接收正式版、關閉自動下載，或立即檢查。

有新版會顯示圖示圓點；可主動開啟瀏覽器通知。通知不重載頁面、不重掛載畫布，也不移動焦點。這是程式運行期間的檢查與通知，不是關閉後端後仍運作的 Web Push；iOS 系統通知能力依 Safari／主畫面安裝及權限而定。

也可匯入可信來源的本機更新 ZIP，用於尚未發佈或受限網路下測試。更新包需比目前版本新，支援 v1 manifest、資料 schema 2、啟動器協定 1；路徑、大小與每個檔案 SHA-256 均被驗證。來源為 GitHub 時還會驗證整個下載包的 SHA-256，並在安裝前再次核對已暫存檔案。

安裝流程：

1. 先送出／清空畫布草稿，完成回答和本地任務。
2. 點「安裝新版並重新啟動」。新版在獨立 `versions/` 目錄展開並安裝 lockfile 依賴；這時舊後端仍運行。
3. 讓舊後端正常關閉，備份穩定的 `data/` 到 `.runtime/update-backup-*`。
4. 啟動新後端，確認健康檢查與版本相符，才切換安裝指標。頁面成功後重載。
5. 若新後端無法啟動，回復資料備份並啟動原版本。若更新中啟動器意外退出，下次啟動依 pending journal 回到原版本。

資料始終在根目錄 `data/`，不在版本目錄；`.env` 不被更新包覆蓋。portable 自動更新要求資料、模型與登入路徑均在這個穩定目錄中；外部自訂路徑要先整理配置，避免未覆蓋的恢復風險。更新不支援自動跨資料 schema；需要新 schema 時須另外設計相容性／遷移與回退方案。

新舊程式版本、下載包與更新備份暫不自動刪除。更新失敗可查看啟動器視窗；不要刪除 `.runtime/pending-install.json` 來繞過恢復流程。SHA-256 是完整性驗證；線上更新依賴可信 GitHub 倉庫、TLS 與發佈權限，不是額外的離線簽章。

私人倉庫可在後端 `.env` 配置 `UPDATE_GITHUB_TOKEN`（僅需該倉庫的 contents 讀取權限）。它與 ChatGPT 登入分開，不傳入瀏覽器，不寫入更新包，不隨命令環境轉交；對下載主機重新導向時移除授權標頭。不要把 token 貼在聊天或提交 Git。

## 開發與發佈

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start:local
pnpm package:windows
```

原始碼啟動器可以檢查與準備版本，但不會覆蓋 Git checkout 安裝。Windows portable 啟動器才能一鍵切換版本。打包需要 Git checkout；輸出位於 `release-output/`（或 `RELEASE_OUTPUT` 指定目錄），不包含 `.env`、`data/`、`node_modules/` 或登入資料。依賴在本機按 lockfile 安裝，沒有混入 Linux 原生二進位。

發佈時先更新 package.json 的 SemVer，執行檢查與打包，再推送對應 `canvas-v<version>` tag。GitHub Actions 的 release workflow 會在 Windows 執行驗證，成功後發布 ZIP、SHA-256 與 `context-canvas-update.json`；帶 SemVer suffix 的版本會標為 prerelease，供測試頻道接收。**寫入 workflow 與產生 ZIP 不代表已發佈 Release**；本次沒有自動發布 tag 或改動 cleared main。

## 驗證範圍

自動化測試驗證真實本地讀寫與命令、確認／拒絕／取消、寫檔衝突、重啟紀錄、路徑限制、Codex 動態工具協定迴圈、更新校驗、頻道／版本排序、資料保留及更新通知的焦點保持。模型產生工具請求使用受控 RPC 模擬；真實 ChatGPT 任務、Windows PowerShell、Windows Codex 與 iOS Safari 仍需各自實機確認，不能以 Linux 結果替代。

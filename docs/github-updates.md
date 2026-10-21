# GitHub 自動更新設定

從 0.5.2 起，安裝與線上更新不需要使用者的 GitHub token。開發和交付仍在私有的 `Yukayuyu/synduck` 的 `main`，安裝包與更新資訊發布到公開的 `Yukayuyu/context-canvas-releases`。不需要 VPS、GitHub Pages 或資料庫服務。

```text
私有 synduck/main → 版本標籤 → Actions 驗證、編譯、測試
                                    ↓ 發布憑證只存在 Actions Secrets
公開 context-canvas-releases → 安裝包與更新資訊 → 使用者匿名下載
```

推送 `main` 只執行 CI。推送和 `package.json` 相符的 `canvas-v<版本>` 標籤才會發布。公開倉庫的標籤指向它自己的 README 歷史，發布流程不會推送私有原始碼的 Git 歷史，也不會從私有提交自動產生發布說明。

## 管理者只需設定一次

1. 建立公開倉庫 **`Yukayuyu/context-canvas-releases`**，勾選初始化 README。這個倉庫只放使用說明、安裝包與更新資訊，不要上傳開發倉庫。可採用 [公開下載頁說明](public-release-readme.md)。來源倉庫保持私有。
2. 在 GitHub 個人設定 **Developer settings → Personal access tokens → Fine-grained tokens** 建立發布憑證：Resource owner 選 `Yukayuyu`，Repository access 僅選 **context-canvas-releases**，Repository permissions 僅開 **Contents: Read and write**。不需要私有 `synduck` 的讀取權限，也不需要 Actions／Workflows 寫入。設定合適有效期限，並在到期前輪替。
3. 在**私有來源倉庫 synduck** 的 **Settings → Secrets and variables → Actions → New repository secret** 新增 `RELEASE_PUBLISH_TOKEN`，值填入剛建立的憑證。不要新增為普通 Variable、不要提交檔案、不要貼在聊天，也不要放到安裝包或使用者 `.env`。
4. 在來源倉庫 **Settings → Actions → General** 允許 GitHub 官方 `actions/*` 和 `pnpm/action-setup`。若組織要求 SSO／權限核准，先完成。來源倉庫的工作流程預設唯讀權限可保留。

**每位使用者無需重複上述設定。** 原本的內建 `GITHUB_TOKEN` 只管來源倉庫，不能直接跨倉庫發布；因此發布憑證只需由維護者在 Actions Secrets 設定一次。日後憑證過期只會阻止發布新版本，已公開的安裝包仍可匿名下載。

更新來源在根目錄 `release.config.json` 統一指定，編譯時寫入程式。工作流程讀取同一個設定。這個公開倉庫名稱不是密鑰；使用者不必設定它。更新器不再讀取 `UPDATE_GITHUB_TOKEN`、`GH_TOKEN` 或 `GITHUB_TOKEN`，也不會送出 Authorization header。

## 公開包包含哪些內容

`pnpm package:windows` 從明確的執行檔清單建立 ZIP：編譯並壓縮的後端／啟動器 JavaScript、前端產物、固定版本的執行依賴清單與 lockfile、空白設定範本、使用說明，以及 Windows 桌面橋接腳本。兩個不到 100 bytes 的相容入口保留 `.ts` 副檔名，僅負責載入編譯檔，讓先前的啟動器能安裝新版。

不會掃描並打包整個 Git checkout，不包含開發用 TypeScript／TSX 原始碼樹、source maps、Git 歷史、測試、未追蹤檔案、真實 `.env`、畫布、登入資料、憑證或開發用 `node_modules`。依賴在使用者電腦依獨立 lockfile 安裝，不混入 Linux 原生二進位。

**編譯檔仍可分析，JavaScript 不是保密容器。** 此方案保留私有開發倉庫和歷史，但不承諾已分發程式無法逆向。必要的 Windows PowerShell/C# 桌面橋接作為可檢視的執行資源隨包提供。任何必須保密的憑證都不能放進分發檔。

## 從 main 發布版本

先提交功能、修正和 `package.json` 版本到 `main`，確認 `Context Canvas` CI 在 Linux、Windows 均成功。以下在來源倉庫的 PowerShell 執行，會正式觸發發布：

```powershell
git switch main
git pull --ff-only origin main
$releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
git tag -a "canvas-v$releaseVersion" -m "Context Canvas $releaseVersion"
git push origin "canvas-v$releaseVersion"
```

目前版本是 `0.5.2`，對應 `canvas-v0.5.2`。下一次必須升版，不要覆寫既有標籤或同版本安裝包。帶 SemVer 後綴的版本如 `0.5.3-beta.1` 會標記為 prerelease，僅測試頻道接收。

`Context Canvas release` 先檢查發布憑證和公開目標，再在 Windows 驗證、編譯、打包並測試安裝／復原與舊啟動入口相容性；成功後在[公開 Releases](https://github.com/Yukayuyu/context-canvas-releases/releases) 建立包含以下附件的版本：

- `ContextCanvas-Windows-<版本>.zip`
- `ContextCanvas-Windows-<版本>.zip.sha256`
- `context-canvas-update.json`

只有 Source code ZIP、Actions 暫存 artifact、Git 標籤或草稿 Release 都不足以供更新器使用。發布只上傳這三個指定檔案，不會把其他輸出、私有提交或發布憑證上傳。

## 使用者安裝與更新

首次安裝只需從公開 Releases 下載 Windows ZIP，完整解壓縮，雙擊 `Start-ContextCanvas.cmd`。首次啟動需連網安裝 Node／固定版本依賴；不需要 GitHub 帳號或 token。使用 AI 時，另在程式內完成自己的 ChatGPT 登入或模型 API 設定，與下載更新的權限無關。

0.5.1 及更早版本仍讀取原私有更新來源，需要**先手動下載 0.5.2 或更新的 ZIP**，再在舊版「版本與更新」匯入並安裝。若舊包尚未支援介面安裝，使用新包的 `Update-Existing.cmd`。完成後關閉整個啟動器並重新啟動原安裝的 `Start-ContextCanvas.cmd`，讓啟動器也切換到新更新來源。畫布、模型設定、登入與本地任務保留；不需刪除資料或重新輸入 GitHub token。舊 `.env` 中的 `UPDATE_GITHUB_TOKEN` 可移除並在 GitHub 撤銷不再需要的憑證。

開啟「版本與更新」，可選正式版／測試頻道、自動下載及瀏覽器通知。啟動器運行時每 15 分鐘檢查公開版本，有更新會顯示提示並校驗下載；完成任務、保存並清空未送出文字後，仍由使用者點「安裝新版並重新啟動」。關閉後端後不繼續檢查。

`pnpm start:local` 原始碼安裝能查詢、下載與校驗更新，但不覆蓋 Git checkout；完整切版流程由 Windows 管理式啟動器提供。

## 找不到更新時

- **發布 preflight 失敗**：公開倉庫尚未建立／初始化，或 `RELEASE_PUBLISH_TOKEN` 缺少目標倉庫 Contents 寫入、尚未核准或已到期。這是維護者的設定，使用者不需 token。
- **401／403／404／429**：確認公開倉庫可匿名開啟、版本正式發布，以及網路可連 GitHub。匿名 GitHub API 有速率限制，共用出口或手動密集檢查可能暫時受限；不要藉此向使用者索取私有倉庫 token。
- **沒有新版**：確認公開 Release 有三個必要附件，版本高於本機，且選取的頻道包含它。
- **可以下載但不能安裝**：確認使用管理式啟動器，沒有進行中的任務或未送出草稿。

安裝與資料復原方式見[本地執行器與版本更新](local-runtime-updates.md)。

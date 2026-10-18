# GitHub 自動更新設定

後續開發與完成的修改都進入 `main`。日常推送只執行 CI；準備好發佈時，再推送和 `package.json` 版本完全相符的 `canvas-v<版本>` 標籤。

整個流程只需要 GitHub Actions 與 GitHub Releases，不需要另租 VPS、設定 GitHub Pages、雲端資料庫或架設更新伺服器。

## 1. 確認 GitHub Actions 設定

開啟 [synduck 的 Actions](https://github.com/Yukayuyu/synduck/actions)。若顯示停用工作流程的提示，先啟用。

在倉庫 **Settings → Actions → General**，確認允許工作流程使用 GitHub 官方 `actions/*` 和 `pnpm/action-setup`。有組織限制時，由管理員准許這些 Actions 及 Release 寫入。

倉庫已有兩個工作流程：

| 工作流程                 | 何時執行              | 結果                                                            |
| ------------------------ | --------------------- | --------------------------------------------------------------- |
| `Context Canvas`         | 推送 `main` 或提出 PR | Linux／Windows 驗證、打包與安裝／復原測試；Linux 另有瀏覽器測試 |
| `Context Canvas release` | 推送 `canvas-v*` 標籤 | Windows 驗證、打包、安裝／復原測試成功後，建立 GitHub Release   |

發布工作已明確宣告 `contents: write` 並使用 Actions 內建的 `GITHUB_TOKEN`。**不需要另建發布用 PAT 或手動新增同名 Secret**；倉庫預設的唯讀工作流程權限可保留。若組織政策禁止發布工作申請寫入，需由管理員調整該政策。

成功的 Release 會附上三個檔案：

- `ContextCanvas-Windows-<版本>.zip`
- `ContextCanvas-Windows-<版本>.zip.sha256`
- `context-canvas-update.json`

只有原始碼的 Source code ZIP、Actions 暫存 artifact、Git 標籤或草稿 Release 都不足以供更新器使用。

## 2. 私有倉庫：在本機設定唯讀 token

`Yukayuyu/synduck` 目前是私有倉庫。每台需要線上更新的後端電腦，都要能讀取這個倉庫的 Release。

1. 在 GitHub 個人設定開啟 **Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**。
2. Resource owner 選 `Yukayuyu`，Repository access 選 **Only select repositories → synduck**。
3. Repository permissions 只開 **Contents: Read-only**；Metadata 的基本唯讀權限會自動附加。不需要 Actions 寫入或整個帳號的倉庫權限。設定合適的有效期限；若顯示等待核准或要求 SSO，先完成核准／授權。
4. 在 Windows 安裝**根目錄**的 `.env` 填入 `UPDATE_GITHUB_TOKEN`。管理式啟動器使用根目錄的 `.env`，不需修改 `versions/` 下的檔案。

```dotenv
UPDATE_GITHUB_TOKEN=<在你自己的本機填入唯讀 token>
```

5. 關閉整個啟動器，再以 `Start-ContextCanvas.cmd` 重新啟動，讓更新器讀取設定。

這個 token 與 ChatGPT 登入、模型 API key 分開，只放後端；不要貼在聊天、前端設定、Git 或更新包中。日後若自行把倉庫改為公開，公開 Release 可匿名讀取，不需填 token；本次不會變更倉庫公開範圍。

## 3. 從 main 發布一個版本

先將功能、修正與 `package.json` 的版本修改提交並推送到 `main`，確認 `Context Canvas` CI 成功。以下在倉庫目錄的 PowerShell 執行，會**正式觸發發布**：

```powershell
git switch main
git pull --ff-only origin main
$releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
git tag -a "canvas-v$releaseVersion" -m "Context Canvas $releaseVersion"
git push origin "canvas-v$releaseVersion"
```

例如 `package.json` 為 `0.5.0`，標籤必須是 `canvas-v0.5.0`。下次更新必須先升為更高的版本，例如 `0.5.1`，再建立新標籤。不要覆寫已發布的標籤或同版本安裝包；已安裝 `0.5.0` 的本機不會收到另一份同版本的更新。

到 Actions 等待 `Context Canvas release` 成功，再到 [Releases](https://github.com/Yukayuyu/synduck/releases) 確認三個附件。正式版不帶後綴；`0.5.1-beta.1` 這類帶後綴的版本會自動標記為 prerelease，只有測試頻道接收。

本次整合到 `main` 不會自行建立版本標籤或發布 Release。

## 4. 在本機開啟更新與推送

用 Windows 管理式啟動器啟動後，開啟「版本與更新」：

1. 選擇「只接收正式版」或「測試版與正式版」。
2. 勾選「自動下載新版，手動選擇安裝時間」。
3. 點「立即檢查更新」，確認能讀取 GitHub。
4. 如需系統提示，點「開啟瀏覽器通知」並在瀏覽器允許。

啟動器運行時會每 15 分鐘檢查並下載比目前版本新的可用版本，顯示更新提示。安裝仍需在完成任務、保存並清空未送出文字後，點「安裝新版並重新啟動」。關閉後端後不會繼續檢查；這不是離線 Web Push。

`pnpm start:local` 原始碼安裝可以查詢、下載與校驗更新，但不能覆蓋 Git checkout 一鍵切版。需要完整安裝流程時，請使用 Windows ZIP 的管理式啟動器。

## 找不到更新時

- **Actions 失敗**：查看失敗步驟並修正；發布工作在測試通過前不會建立 Release。
- **401／403／404**：私有倉庫的 token 可能缺少 Contents 讀取、選錯倉庫、尚未核准或已到期；GitHub 也可能用 404 隱藏未授權的私人資源。
- **沒有新版**：確認 Release 已正式發布、附有三個必要檔案、版本高於本機，且頻道包含該版本。
- **可以下載但不能安裝**：確認透過管理式啟動器啟動，沒有進行中的任務或未送出的草稿。

安裝與資料復原方式見[本地執行器與版本更新](local-runtime-updates.md)。

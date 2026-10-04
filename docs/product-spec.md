## 產品定位、差異化與 MVP
**產品概述**

AI Context Canvas 應該把「一次 AI 對話」從不可逆的直線：

```text
Prompt
  ↓
Answer
  ↓
Prompt
  ↓
Answer
  ↓
...
```

轉化成可探索的有向 Graph：

```text
                           ┌── 技術方案 ─── 新對話
                           │
原始問題 ── AI 回答 ── Excerpt
                           │
                           ├── 反論 ────── 新對話
                           │
                           └── 商業模式 ── 新對話

另一條研究鏈 ────────────────────┘
```

但 Graph 本身不是價值終點。真正的產品循環應該是：

```text
Conversation
     ↓
Graph
     ↓
Context Selection
     ↓
Context Compilation
     ↓
AI Reasoning
     ↓
New Graph
```

也就是使用者與 AI 共用同一張「思考地圖」。

**與 Obsidian 的差異化**

Obsidian 本身已提供筆記連結、Graph 與 Canvas；JSON Canvas 規格也已將通用 Canvas 定義為 node/edge 模型。 因此產品不能把「卡片可以拉線」當成核心創新。

| 維度 | Obsidian / 通用 JSON Canvas | AI Context Canvas 建議定位 |
|---|---|---|
| 基本單位 | text / file / link / group 等通用 node  | Conversation / Turn / Excerpt / Summary / Concept / Artifact / Region |
| 主要目的 | 資訊組織、筆記與視覺 Canvas | AI 對話的 context management |
| 對話 provenance | 非 JSON Canvas 規格核心 | 一等公民 |
| 文字節選 | 可以建立文字或引用，但通用格式不表達 AI 對話 source semantics | Excerpt 保留精確 source block、range、snapshot |
| Edge | 通用節點間連線  | Structural edge 與 Semantic edge 分離 |
| AI 當前 context | 非 JSON Canvas 格式概念 | Context Set 一等公民 |
| 舊資訊失效 | 非 Canvas 核心語義 | `superseded / rejected / deprecated` |
| AI 引用透明度 | 非核心資料模型 | Context Inspector |
| Prompt 建立方式 | 外部／plugin 決定 | Canvas Graph → Context Compiler → Context Package |
| AI 建議關聯 | 可由 plugin 實作 | Proposal → confidence → user confirmation |
| 長對話呈現 | 通用卡片 | Semantic zoom + focus layer |
| Layout | 人工排版為主 | Manual / Assist / Auto，AI 僅產生 intent |
| 人與 AI 的共用模型 | 人看到筆記圖 | 人與 AI 使用同一套 node IDs、edges、states 與 context selection |

產品的一句話定位建議為：

> **AI Context Canvas 是一個「可視、可控、可編譯」的 AI 對話上下文工作空間。**

而不是：

> AI whiteboard。

或：

> Obsidian with ChatGPT。

**MVP 優先級**

`P0` 是能證明核心假設的功能；`P1` 是完成產品體驗的重要能力；`P2` 是核心價值成立後再加入。

| 優先級 | 功能 | MVP 行為 | 成功標準 |
|---|---|---|---|
| P0 | Infinite Canvas | pan / zoom / node drag / edges | 100+ nodes 仍可正常操作 |
| P0 | Conversation Node | 在 Canvas 開始一條人機對話 | turn 完整持久化 |
| P0 | Turn provenance | 每一 turn 知道 parent、actor、model、時間 | reload 後結構不變 |
| P0 | Text Excerpt | 選字後建立 excerpt | 能回到 source block + range |
| P0 | Branch from Excerpt | Excerpt 開新 conversation branch | 新舊 branch 都保留 |
| P0 | Structural Edges | reply / branch / excerpt 等 | 不由 LLM 猜測 |
| P0 | Focus Layer | 進入長 Conversation 閱讀完整內容 | 不在 Canvas 上無限撐高 node |
| P0 | Context Set | selected / pinned / excluded context | 每次 AI call 有 context_set_id |
| P0 | Context Compiler v0 | Resolve → Retrieve → Rank → Compress → Conflict → Build | 產生 deterministic Context Package |
| P0 | Context Inspector | 顯示此輪用了／沒用哪些 node | 可點擊反向定位 Canvas node |
| P0 | Single-model gateway | OpenAI 或 Anthropic 任一 provider 可工作 | domain 不依賴 provider payload |
| P0 | Structured role outputs | Agent-role JSON schema validation | invalid result 不寫入 graph |
| P0 | Local persistence | SQLite + local asset folder | app restart 資料仍存在 |
| P0 | Project export/import | 匯出單一 project package | import 後 IDs/provenance 保持 |
| P0 | Evals / tests | context compiler unit/e2e fixtures | CI 可重現 |
| P1 | Semantic Zoom | 不同 zoom 顯示不同 representation | 不必打開全文也能讀圖 |
| P1 | Summarizer | 生成 faithful summary | summary 保留 source IDs |
| P1 | Semantic Linker | proposed semantic edges | AI edge 預設未確認 |
| P1 | Context lifecycle | active / superseded / rejected 等 | compiler 尊重 state |
| P1 | FTS Retrieval | 在 workspace 找相關文字 | query 可排序 |
| P1 | Image Region | 框選圖片區域開 branch | selector 可重建 |
| P1 | Layout Assist | AI 建議 cluster + geometry preview | 不自動破壞人工佈局 |
| P1 | JSON Canvas adapter | 基礎 import/export | 不把其格式當內部 canonical model |
| P2 | Embedding / RAG | semantic retrieval | eval 優於 lexical-only 後啟用 |
| P2 | Auto Layout | 特定 region 自動維護 | pinned node 絕不移動 |
| P2 | 多 Agent | 並行 specialist workflows | 有 eval 證明收益 |
| P2 | Collaboration | 多人同步編輯 | 有 conflict strategy |
| P2 | PDF / code selectors | page / paragraph / symbol addressing | provenance 可還原 |

**MVP 明確不做的事**

第一版不應追求 autonomous multi-agent swarm、整個 filesystem RAG、多人即時協作、完整 Obsidian replacement、AI 自由重排整個 Canvas、跨裝置同步、plugin marketplace。這與目前 agent engineering 的實務原則一致：先用明確 workflow 和簡單組件證明核心價值，再增加複雜度。

MVP 真正應該驗證的是三個問題：

1. **Navigation test**：使用者在 30–100 turns、5–20 branches 後，是否比線性 chat 更容易找到「我們為什麼走到這裡」。
2. **Context comprehension test**：使用者是否能正確回答「AI 這一輪用了什麼 context」。
3. **Context quality test**：Context Compiler 相較「全部 ancestors 全塞」是否降低舊資訊干擾、遺漏與 branch 汙染。

第三項尤其重要。長 context 本身並不保證可靠利用資訊，因此 benchmark 應比較「raw long history」與「compiled context」，而非只比較 token 數。

---

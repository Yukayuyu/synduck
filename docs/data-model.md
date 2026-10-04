## 資料模型與 Context Compiler
資料模型不要直接等同 Canvas component state。建議分成：

```text
Domain Model
├── Workspace
├── Conversation
├── Turn
├── ContentBlock
├── Excerpt
├── Node
├── Edge
├── ContextSet
├── ContextItem
└── ContextConflict

View Model
├── NodePosition
├── NodeRepresentation
├── ZoomState
├── FocusState
└── LayoutIntent
```

這樣日後就算更換 React Flow、改成桌面 App，Conversation Graph 本身仍然成立。

### 核心實體欄位規格

**Workspace**

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---:|---|
| `id` | UUID | 是 | workspace canonical ID |
| `name` | string | 是 | 工作空間名稱 |
| `description` | string/null | 否 | 使用者描述 |
| `root_node_id` | UUID/null | 否 | 預設入口 |
| `settings` | JSON | 是 | context/layout/provider 等設定 |
| `schema_version` | string | 是 | migration 用 |
| `created_at` | ISO datetime | 是 | 建立時間 |
| `updated_at` | ISO datetime | 是 | 修改時間 |

```json
{
  "id": "ws_01",
  "name": "AI Context Canvas Research",
  "description": "產品設計與 MVP 討論",
  "root_node_id": "node_root",
  "settings": {
    "layout_mode": "assist",
    "default_provider": "openai",
    "default_model": "未指定"
  },
  "schema_version": "0.1.0",
  "created_at": "2026-10-04T09:00:00+09:00",
  "updated_at": "2026-10-04T09:00:00+09:00"
}
```

**Conversation**

Conversation 是一條具有身份的討論脈絡，不等於單一 Canvas node。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---:|---|
| `id` | UUID | 是 | Conversation ID |
| `workspace_id` | UUID | 是 | 所屬 workspace |
| `title` | string | 是 | 顯示標題 |
| `status` | `active/archived` | 是 | Conversation 狀態 |
| `root_turn_id` | UUID/null | 否 | 第一個 turn |
| `summary_block_id` | UUID/null | 否 | 最新 summary |
| `branch_origin_excerpt_id` | UUID/null | 否 | 若由 excerpt 分支，記錄來源 |
| `created_at` | datetime | 是 | 建立 |
| `updated_at` | datetime | 是 | 更新 |

```json
{
  "id": "conv_context_compiler",
  "workspace_id": "ws_01",
  "title": "Context Compiler 設計",
  "status": "active",
  "root_turn_id": "turn_001",
  "summary_block_id": "block_summary_001",
  "branch_origin_excerpt_id": "excerpt_012",
  "created_at": "2026-10-04T09:05:00+09:00",
  "updated_at": "2026-10-04T10:20:00+09:00"
}
```

**Turn**

Turn 是 Conversation 中一次 actor action。不要把 user/assistant message 當純文字 blob。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---:|---|
| `id` | UUID | 是 | Turn ID |
| `conversation_id` | UUID | 是 | 所屬 conversation |
| `parent_turn_id` | UUID/null | 否 | 直接對話 predecessor |
| `actor` | `human/assistant/system/tool` | 是 | 產生者 |
| `sequence` | integer | 是 | conversation local order |
| `model_provider` | string/null | 否 | AI turn provider |
| `model_id` | string/null | 否 | AI turn model |
| `input_context_set_id` | UUID/null | 否 | 產生此 AI turn 所用 context |
| `status` | `complete/streaming/error` | 是 | generation state |
| `created_at` | datetime | 是 | 建立時間 |

```json
{
  "id": "turn_042",
  "conversation_id": "conv_context_compiler",
  "parent_turn_id": "turn_041",
  "actor": "assistant",
  "sequence": 42,
  "model_provider": "openai",
  "model_id": "未指定",
  "input_context_set_id": "ctx_042",
  "status": "complete",
  "created_at": "2026-10-04T10:21:00+09:00"
}
```

**ContentBlock**

一個 Turn 可包含多個內容 block，使文字、圖像、code、表格與 tool result 可獨立 address。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---:|---|
| `id` | UUID | 是 | Block ID |
| `turn_id` | UUID/null | 否 | 所屬 turn；獨立 artifact 可為 null |
| `block_type` | enum | 是 | `text/markdown/image/code/table/file/tool_result` |
| `ordinal` | integer | 是 | block 順序 |
| `mime_type` | string/null | 否 | asset MIME |
| `text_content` | string/null | 否 | 文字內容 |
| `asset_id` | UUID/null | 否 | 圖／檔資產 |
| `structured_data` | JSON/null | 否 | table/tool/code metadata |
| `content_hash` | string | 是 | provenance / mutation check |
| `created_at` | datetime | 是 | 建立 |
| `updated_at` | datetime | 是 | 更新 |

```json
{
  "id": "block_042_01",
  "turn_id": "turn_042",
  "block_type": "markdown",
  "ordinal": 0,
  "mime_type": "text/markdown",
  "text_content": "Context 不應等於所有 ancestors。",
  "asset_id": null,
  "structured_data": null,
  "content_hash": "sha256:9f0example",
  "created_at": "2026-10-04T10:21:00+09:00",
  "updated_at": "2026-10-04T10:21:00+09:00"
}
```

**Excerpt**

Excerpt 必須是一等實體，而不是把被選的字 copy 成新 note。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---:|---|
| `id` | UUID | 是 | Excerpt ID |
| `workspace_id` | UUID | 是 | workspace |
| `source_block_id` | UUID | 是 | canonical source |
| `selector` | JSON | 是 | text range / image region 等 |
| `snapshot_text` | string/null | 否 | 建立時內容快照 |
| `source_content_hash` | string | 是 | 驗證來源是否改變 |
| `title` | string/null | 否 | 可由人／AI命名 |
| `created_by` | `human/ai/system` | 是 | provenance |
| `created_at` | datetime | 是 | 建立 |

文字 selector：

```json
{
  "id": "excerpt_012",
  "workspace_id": "ws_01",
  "source_block_id": "block_042_01",
  "selector": {
    "type": "text_range",
    "start_char": 0,
    "end_char": 27,
    "exact": "Context 不應等於所有 ancestors。"
  },
  "snapshot_text": "Context 不應等於所有 ancestors。",
  "source_content_hash": "sha256:9f0example",
  "title": "Context selection 原則",
  "created_by": "human",
  "created_at": "2026-10-04T10:23:00+09:00"
}
```

圖片 region 可使用矩形 selector。W3C Media Fragments 已定義以 `x,y,width,height`、pixel 或百分比方式表達視覺媒體矩形區域，因此此設計有成熟標準作為概念參照。 實作上建議優先存 normalized coordinate，並額外保留原始 pixel metadata，以避免 UI resize 後 selector 失真。

```json
{
  "type": "image_region",
  "asset_id": "asset_ui_mock_01",
  "unit": "normalized",
  "x": 0.18,
  "y": 0.12,
  "width": 0.42,
  "height": 0.23,
  "source_pixel_size": {
    "width": 1920,
    "height": 1080
  },
  "pixel_snapshot": {
    "x": 346,
    "y": 130,
    "width": 806,
    "height": 248
  }
}
```

**Node**

Node 是「某個 domain object 在 Canvas 上的 representation」，不是 domain object 本身。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---:|---|
| `id` | UUID | 是 | node ID |
| `workspace_id` | UUID | 是 | workspace |
| `type` | NodeType | 是 | 見下表 |
| `ref_type` | string/null | 否 | 對應 domain entity |
| `ref_id` | UUID/null | 否 | domain ID |
| `title` | string | 是 | UI title |
| `context_state` | ContextState | 是 | AI context lifecycle |
| `x` | float | 是 | world coordinate |
| `y` | float | 是 | world coordinate |
| `width` | float | 是 | UI width |
| `height` | float | 是 | UI height |
| `z_index` | integer | 是 | rendering order |
| `collapsed` | boolean | 是 | 是否折疊 |
| `visibility` | enum | 是 | `normal/muted/hidden` |
| `representation` | JSON | 是 | 不同 zoom 的呈現資料 |
| `created_by` | enum | 是 | human/ai/system |
| `created_at` | datetime | 是 | 建立 |
| `updated_at` | datetime | 是 | 更新 |

```json
{
  "id": "node_excerpt_012",
  "workspace_id": "ws_01",
  "type": "excerpt",
  "ref_type": "excerpt",
  "ref_id": "excerpt_012",
  "title": "Context selection 原則",
  "context_state": "active",
  "x": 1280,
  "y": 640,
  "width": 320,
  "height": 180,
  "z_index": 14,
  "collapsed": false,
  "visibility": "normal",
  "representation": {
    "overview": "Context selection 原則",
    "summary": "Context 不應只等同 ancestor chain。",
    "detail": "source"
  },
  "created_by": "human",
  "created_at": "2026-10-04T10:23:00+09:00",
  "updated_at": "2026-10-04T10:23:00+09:00"
}
```

**建議 Node Types**

| Node type | 意義 | MVP |
|---|---|---:|
| `conversation` | 對話容器 | P0 |
| `turn` | 特定 turn representation | P0 |
| `excerpt` | 來源精確節選 | P0 |
| `summary` | 一組內容的摘要 | P1 |
| `concept` | 抽象概念 | P1 |
| `artifact` | code/table/document 等成果 | P1 |
| `reference` | URL / file / external source | P1 |
| `image_region` | 圖片局部 | P1 |
| `group` | 視覺／語義 cluster | P1 |

**Edge**

最重要的原則是 Structural 與 Semantic 不混用。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---:|---|
| `id` | UUID | 是 | Edge ID |
| `workspace_id` | UUID | 是 | workspace |
| `source_node_id` | UUID | 是 | source |
| `target_node_id` | UUID | 是 | target |
| `edge_class` | `structural/semantic` | 是 | 類別 |
| `type` | EdgeType | 是 | relation |
| `direction` | `directed/undirected` | 是 | 方向 |
| `provenance` | `user/ai/system` | 是 | 誰建立 |
| `confidence` | 0..1/null | 否 | AI suggestion |
| `confirmed` | boolean | 是 | user confirmed? |
| `label` | string/null | 否 | 顯示 label |
| `metadata` | JSON | 是 | 額外資料 |
| `created_at` | datetime | 是 | 建立 |
| `updated_at` | datetime | 是 | 更新 |

```json
{
  "id": "edge_087",
  "workspace_id": "ws_01",
  "source_node_id": "node_excerpt_012",
  "target_node_id": "node_conv_044",
  "edge_class": "structural",
  "type": "branch_from",
  "direction": "directed",
  "provenance": "system",
  "confidence": null,
  "confirmed": true,
  "label": null,
  "metadata": {},
  "created_at": "2026-10-04T10:25:00+09:00",
  "updated_at": "2026-10-04T10:25:00+09:00"
}
```

Structural Edge 建議：

```text
reply_to
branch_from
excerpt_from
continue_from
generated_from
merge_from
contains
region_of
summarizes
```

Structural edge 必須由應用程式已知事件產生，不讓模型推測。

Semantic Edge 建議：

```text
supports
contradicts
elaborates
example_of
depends_on
alternative_to
related_to
supersedes
```

Semantic edge 可由 AI 提議，但應為：

```text
AI proposal
    ↓
confidence + evidence
    ↓
pending
    ↓
user accept / reject
```

而非直接升格為事實。

**Context Node State**

| State | 語義 | Compiler 預設 |
|---|---|---|
| `active` | 目前有效資訊 | 正常納入 |
| `confirmed` | 使用者明確確認 | 高優先 |
| `hypothesis` | 假設／尚未證實 | 可納入但標記 |
| `superseded` | 被新資訊取代 | 預設不當目前事實 |
| `deprecated` | 不建議再使用 | 大幅降權 |
| `rejected` | 使用者明確否決 | 預設排除 |
| `reference` | 背景資料 | 依 query relevance |
| `unknown` | 尚未分類 | 中性 |

例如：

```text
Node A
「第一版用 Neo4j」
state = superseded
      │
      └── supersedes ──→
Node K
「第一版改用 SQLite」
state = confirmed
```

模型仍可以看到 A 作為歷史，但 Context Package 不應把 A 和 K 當兩個同等有效的現況。

**Context Set**

Context Set 描述「某次模型呼叫之前，人與系統決定有哪些 candidate context」。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---:|---|
| `id` | UUID | 是 | Context Set ID |
| `workspace_id` | UUID | 是 | workspace |
| `conversation_id` | UUID/null | 否 | current conversation |
| `target_turn_id` | UUID/null | 否 | 即將產生的 turn |
| `current_node_id` | UUID/null | 否 | UI current focus |
| `prompt_text` | string | 是 | user prompt |
| `selected_node_ids` | UUID[] | 是 | 當輪顯式選取 |
| `pinned_node_ids` | UUID[] | 是 | 長期 pin |
| `excluded_node_ids` | UUID[] | 是 | 顯式排除 |
| `retrieved_items` | ContextItem[] | 是 | compiler retrieval |
| `budget` | JSON | 是 | token budget |
| `policy_version` | string | 是 | compiler policy |
| `status` | enum | 是 | draft/compiled/used |
| `created_at` | datetime | 是 | 建立 |

```json
{
  "id": "ctx_042",
  "workspace_id": "ws_01",
  "conversation_id": "conv_context_compiler",
  "target_turn_id": "turn_042",
  "current_node_id": "node_conv_context",
  "prompt_text": "Context Compiler 應該怎麼排序 context？",
  "selected_node_ids": ["node_excerpt_012"],
  "pinned_node_ids": ["node_product_principle"],
  "excluded_node_ids": ["node_old_neo4j_plan"],
  "retrieved_items": [],
  "budget": {
    "max_input_tokens": 64000,
    "reserved_output_tokens": 8000,
    "target_context_tokens": 24000
  },
  "policy_version": "context-policy-0.1",
  "status": "draft",
  "created_at": "2026-10-04T10:24:00+09:00"
}
```

**ContextItem**

```json
{
  "source_type": "excerpt",
  "source_id": "excerpt_012",
  "node_id": "node_excerpt_012",
  "role": "selected",
  "state": "active",
  "scores": {
    "explicit": 1.0,
    "structural": 0.9,
    "semantic": 0.92,
    "recency": 0.8,
    "state": 1.0,
    "spatial": 0.3,
    "final": 0.94
  },
  "reason": "使用者本輪明確選取，且與 query 直接相關",
  "token_estimate": 34,
  "compressed": false,
  "content_hash": "sha256:9f0example"
}
```

空間鄰近只能視為弱 signal。使用者把兩個 node 放得近，可能代表「相關」，也可能只是排版。因此 `spatial` 權重不可高於顯式選取、結構關係或內容相關度。

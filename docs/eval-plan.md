# Validation plan

1. Schema tests reject invalid selectors, invalid edge provenance and missing assistant context references.
2. SQLite integration tests exercise atomic excerpt + branch creation, foreign keys, ordered turns, content hashes, rollback and reopening a file-backed database.
3. Compiler fixtures cover explicit exclusion through every retrieval path, branch isolation, deduplication, stale source hashes, selected/pinned budget overflow, rejected/superseded states and deterministic output.
4. Gateway tests use a transport stub to verify the actual outbound model input and schema validation. Stub tests do not prove live provider access.
5. Browser tests create a conversation, obtain a labelled demo response, select real text, branch, inspect context, exclude sources, answer and reload.
6. Live provider validation is separate and requires a configured model and usable server-side credentials.

No numerical claims about answer quality versus raw-history baselines until an evaluation dataset and real model runs exist.

## Context chain and summary evaluation (0.15.0)

`pnpm eval:context` runs synthetic branching cases against the model configured for the app (ChatGPT / Codex sign-in, or `LLM_PROVIDER=openai` with `LLM_MODEL` and `LLM_API_KEY` in `.env`). It refuses the demo provider, which does not call a model. Options: `--repeat N` (default 3, at most 20) and `--case <name>`.

Each case builds a real workspace, compiles it with the production compiler, and asks one question whose answer can be checked with fixed patterns. Every case is sent in two variants that contain the same sources:

| Case                      | Variants            | What a pass shows                                                     |
| ------------------------- | ------------------- | --------------------------------------------------------------------- |
| `nested-override`         | chain / flat        | The nearer ancestor of a three-level fork overrides the root          |
| `attribute-merged-views`  | chain / flat        | A viewpoint is attributed to the conversation it came from            |
| `branch-overrides-parent` | chain / flat        | A later decision in the current branch wins over inherited background |
| `sibling-unknown`         | chain / flat        | The model admits it cannot see a sibling branch                       |
| `summary-recall`          | summary / truncated | An early fact survives a tight budget through a background summary    |

`flat` is the pre-0.14.0 serialization: no thread list, no thread IDs, score order. `truncated` is the same tight budget without a summary. The command prints pass counts per case and variant and writes every answer to `eval-output/` (not tracked). Running it spends model quota: with the defaults, 30 answers plus one summary per run of `summary-recall`.

Unit tests check that the cases compile, that the two variants differ only in the feature under test, and that grading and reporting work with a scripted stand-in. They do not call a model. No results from a real model have been recorded yet, so there is still no evidence either way about answer quality. Five cases with pattern grading are a smoke test, not a benchmark; treat small differences as noise and add cases before drawing conclusions.

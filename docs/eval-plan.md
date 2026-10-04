# Validation plan

1. Schema tests reject invalid selectors, invalid edge provenance and missing assistant context references.
2. SQLite integration tests exercise atomic excerpt + branch creation, foreign keys, ordered turns, content hashes, rollback and reopening a file-backed database.
3. Compiler fixtures cover explicit exclusion through every retrieval path, branch isolation, deduplication, stale source hashes, selected/pinned budget overflow, rejected/superseded states and deterministic output.
4. Gateway tests use a transport stub to verify the actual outbound model input and schema validation. Stub tests do not prove live provider access.
5. Browser tests create a conversation, obtain a labelled demo response, select real text, branch, inspect context, exclude sources, answer and reload.
6. Live provider validation is separate and requires a configured model and usable server-side credentials.

No numerical claims about answer quality versus raw-history baselines until an evaluation dataset and real model runs exist.

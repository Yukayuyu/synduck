# Autoloop → PR helper

This repo supports adding a short autoloop summary into PR descriptions.

## Update PR body with latest autoloop artifacts
1. Run the loop and ensure artifacts exist under `autoloop_artifacts/`.
2. From repo root:

```bash
bash tools/autoloop/update_pr_body.sh <PR_NUMBER>
```

This will append/replace an "Autoloop Summary" section using the latest `autoloop_artifacts/iter-*` logs.

Safety note: it only edits PR text (no merge, no deploy).

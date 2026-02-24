import { danger, warn, message } from "danger";

// Minimal Dangerfile: keep it non-blocking.
// Purpose: ensure Danger CI has a valid entrypoint and can be expanded later.

const pr = danger.github.pr;

message(`Danger is active for PR #${pr.number}: ${pr.title}`);

// If core app code changes, remind to include tests (non-blocking).
const changed = [...danger.git.modified_files, ...danger.git.created_files];
const touchesApp = changed.some((f) =>
  ["apps/web/src/", "apps/web/app/", "apps/web/pages/"].some((p) => f.startsWith(p)),
);
const touchesTests = changed.some((f) =>
  ["__tests__", ".spec.", ".test.", "playwright"].some((p) => f.includes(p)),
);

if (touchesApp && !touchesTests) {
  warn(
    "App code changed but no tests were updated/added. If this is intentional, document manual verification steps in the PR.",
  );
}

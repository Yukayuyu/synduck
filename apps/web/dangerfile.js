// Minimal Dangerfile: keep it non-blocking.
// JS (not TS) so Next/tsc doesn't typecheck it.

const { danger, warn, message } = require('danger');

const pr = danger.github.pr;
message(`Danger is active for PR #${pr.number}: ${pr.title}`);

const changed = [...danger.git.modified_files, ...danger.git.created_files];
const touchesApp = changed.some((f) =>
  ['apps/web/src/', 'apps/web/app/', 'apps/web/pages/'].some((p) => f.startsWith(p)),
);
const touchesTests = changed.some((f) =>
  ['__tests__', '.spec.', '.test.', 'playwright'].some((p) => f.includes(p)),
);

if (touchesApp && !touchesTests) {
  warn(
    'App code changed but no tests were updated/added. If intentional, document manual verification steps in the PR.',
  );
}

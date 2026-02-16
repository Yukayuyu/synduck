/**
 * DangerJS rules for synduck
 * Keeps PRs reviewable and enforces basic hygiene.
 */

const MAX_CHANGED_LINES = 800;

const linesChanged = (danger.git.created_files.length + danger.git.modified_files.length + danger.git.deleted_files.length);

const additions = danger.github.pr.additions;
const deletions = danger.github.pr.deletions;

if (additions + deletions > MAX_CHANGED_LINES) {
  fail(`PR is too large (${additions}+/${deletions}-). Please split into smaller PRs (< ${MAX_CHANGED_LINES} total changes).`);
}

// Encourage using PR template sections
const body = danger.github.pr.body || '';
if (!body.includes('## How to test')) {
  warn('PR body should include "How to test" section (use the PR template).');
}

// Prevent committing obvious secrets patterns
const secretPatterns = ['AKIA', 'sk-ant-', 'xai-', 'gho_', 'BEGIN PRIVATE KEY'];
for (const f of danger.git.modified_files.concat(danger.git.created_files)) {
  // only scan small text files (best-effort)
  if (!f.match(/\.(md|txt|js|ts|tsx|json|yml|yaml|sh|tf)$/)) continue;
}

// Require CI checks mention in body for infra changes
const touchesInfra = danger.git.modified_files.concat(danger.git.created_files).some(f => f.startsWith('infra/'));
if (touchesInfra && !body.toLowerCase().includes('terraform')) {
  warn('Infra change detected. Please mention terraform plan/checks in PR description.');
}

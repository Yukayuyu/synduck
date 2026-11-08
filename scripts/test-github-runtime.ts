import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { GitHubConnection } from '../packages/local-runtime/src/github';
const root = await mkdtemp(join(tmpdir(), 'synduck github runtime '));
const connection = new GitHubConnection(join(root, 'connections', 'github'));
let phase = 'download and verify official component';
try {
  await connection.initialize();
  const binary = await connection.prepareRuntime();
  phase = 'execute official component';
  const output = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000 });
  assert(output.includes('gh version 2.103.3'));
  assert.equal(connection.status().phase, 'disconnected');
  const credentialDirectory = join(root, 'connections', 'github');
  await writeFile(
    join(credentialDirectory, 'hosts.yml'),
    'github.com:\n    oauth_token: github-runtime-fixture\n    user: fixture-user\n    git_protocol: https\n    users:\n        fixture-user:\n            oauth_token: github-runtime-fixture\n',
    { mode: 0o600 },
  );
  await writeFile(
    join(credentialDirectory, 'profile.json'),
    JSON.stringify({ login: 'fixture-user' }),
    { mode: 0o600 },
  );
  await connection.initialize();
  phase = 'resolve HTTPS Git credentials';
  const env: NodeJS.ProcessEnv = { ...connection.commandEnvironment() };
  for (const key of [
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'COMSPEC',
    'PATHEXT',
  ])
    if (process.env[key]) env[key] = process.env[key];
  const credential = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert(credential.includes('password=github-runtime-fixture'));

  console.log(
    `PASS: verified pinned GitHub login component on ${process.platform}/${process.arch}, without starting account authorization.`,
  );
} catch (error) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    const cause =
      error instanceof Error &&
      error.cause instanceof Error &&
      /^Download HTTP \d+$/.test(error.cause.message)
        ? ' (' + error.cause.message + ')'
        : '';
    const message =
      `${phase}${cause}: ${error instanceof Error ? error.stack || error.message : String(error)}`
        .replaceAll('github-runtime-fixture', '[fixture]')
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A');
    console.error(`::error title=GitHub native component::${message}`);
  }
  throw error;
} finally {
  await connection.close();
  await rm(root, { recursive: true, force: true });
}

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { GitHubConnection } from '../../packages/local-runtime/src/github';

export function testGitHub(directory: string) {
  let finish: (() => void) | undefined;
  const github = new GitHubConnection(directory, {
    ensureBinary: async () => process.execPath,
    run: async (_binary, args, env, signal, onOutput) => {
      if (args[0] === 'auth') {
        onOutput?.('First copy your one-time code: ABCD-1234\nhttps://github.com/login/device');
        await new Promise<void>((done, reject) => {
          finish = done;
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
        signal.throwIfAborted();
        await fs.writeFile(
          join(env.GH_CONFIG_DIR!, 'hosts.yml'),
          'github.com:\n    oauth_token: fixture-private-credential\n    user: canvas-user\n',
          { mode: 0o600 },
        );
        return { code: 0, output: 'Authentication complete' };
      }
      return { code: 0, output: JSON.stringify({ login: 'canvas-user', name: 'Canvas User' }) };
    },
  });
  return {
    github,
    finish: () => {
      finish?.();
    },
  };
}

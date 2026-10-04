import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: Object.fromEntries(['domain', 'db', 'context-compiler', 'model-gateway'].map(name =>
    [`@acc/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))])) },
  test: { include: ['tests/**/*.test.ts'], fileParallelism: false },
});

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), ''),
    ...process.env,
  };
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: Number(env.APP_PORT || 3000),
      strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${env.API_PORT || 3001}` },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            canvas: ['@xyflow/react'],
            markdown: [
              'mdast-util-from-markdown',
              'mdast-util-gfm',
              'micromark-extension-gfm',
              'micromark-util-decode-string',
            ],
          },
        },
      },
    },
  };
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const clientRoot = fileURLToPath(new URL('../src/client', import.meta.url));
const outDir = fileURLToPath(new URL('../dist/client', import.meta.url));
const apiPort = process.env.PORT ?? '8787';

export default defineConfig({
  root: clientRoot,
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      input: {
        index: `${clientRoot}/index.html`,
        arena: `${clientRoot}/arena.html`,
        gladiator: `${clientRoot}/gladiator.html`,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
    },
  },
});

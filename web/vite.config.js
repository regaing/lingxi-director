import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  build: {
    outDir: path.join(here, '..', 'public'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8070', '/downloads': 'http://127.0.0.1:8070' },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SPA lives in web/, builds into dist/web/ which the Express server serves in
// production (single container serving SPA + API, §3). In dev, proxy the API.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});

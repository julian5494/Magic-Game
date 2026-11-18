import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  // The 3D table (three.js) is a separate chunk loaded only in games.
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
});

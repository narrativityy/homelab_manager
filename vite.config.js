import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = `http://127.0.0.1:${process.env.HLM_PORT || 7575}`;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/ws': { target: backend, ws: true },
    },
  },
});

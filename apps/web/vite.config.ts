import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const agent = `http://127.0.0.1:${process.env.SWITCHBOARD_PORT ?? 4317}`;

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: agent, changeOrigin: false },
      '/hook': { target: agent, changeOrigin: false },
    },
  },
  build: { target: 'es2022', sourcemap: false },
});

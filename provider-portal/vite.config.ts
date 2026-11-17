import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(__dirname, '../public'),
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0', port: 4174,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: false },
      '/uploads': { target: process.env.API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: false },
    },
  },
  preview: { host: '0.0.0.0', port: Number(process.env.PORT) || 4174, strictPort: true },
  build: { outDir: path.resolve(__dirname, '../dist/provider-portal'), emptyOutDir: true },
});

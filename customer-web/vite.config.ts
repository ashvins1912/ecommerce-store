import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const appRoot = __dirname;
const repositoryRoot = path.resolve(appRoot, '..');
const previewPort = Number(process.env.PORT) || 4173;

export default defineConfig({
  root: appRoot,
  publicDir: path.resolve(repositoryRoot, 'public'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': appRoot } },
  server: {
    host: '0.0.0.0', port: 4173, strictPort: true,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: false },
      '/uploads': { target: process.env.API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: false },
    },
    fs: { allow: [repositoryRoot] },
  },
  preview: { host: '0.0.0.0', port: previewPort, strictPort: true },
  build: { outDir: path.resolve(repositoryRoot, 'dist/customer-web'), emptyOutDir: true },
});

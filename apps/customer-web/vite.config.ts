import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const appRoot = __dirname;
const repositoryRoot = path.resolve(appRoot, '../..');

export default defineConfig({
  root: appRoot,
  publicDir: path.resolve(repositoryRoot, 'public'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': repositoryRoot,
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: false },
    },
    fs: {
      allow: [repositoryRoot],
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(repositoryRoot, 'dist/customer-web'),
    emptyOutDir: true,
  },
});

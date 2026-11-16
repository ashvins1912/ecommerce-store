import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(__dirname, '../../public'),
  plugins: [react(), tailwindcss()],
  server: {
    port: 4174,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: false },
      '/src/assets': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  build: {
    outDir: '../../dist/provider-portal',
    emptyOutDir: true,
  },
});

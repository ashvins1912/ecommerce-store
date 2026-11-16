import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {defineConfig} from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      // Vite 8 uses Oxc for fast, production-grade JavaScript minification.
      minify: 'oxc',
      cssMinify: 'lightningcss',
      sourcemap: false,
      cssCodeSplit: true,
      assetsInlineLimit: 4096,
      rolldownOptions: {
        output: {
          // Keep React cached independently; lazy feature modules remain in async chunks.
          codeSplitting: {
            groups: [
              {
                name: 'react-vendor',
                test: /node_modules[\\/](?:react|react-dom)(?:[\\/]|$)/,
                priority: 30,
              },
              {
                name: 'charts-vendor',
                test: /node_modules[\\/]recharts[\\/]/,
                priority: 20,
              },
            ],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(projectRoot),
      },
    },
    server: {
      // Allow the deployed Render hostname while keeping Vite's host validation enabled.
      // Add other trusted preview domains here if this app is deployed under another host.
      allowedHosts: ['ecommerce-store-bg2l.onrender.com'],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

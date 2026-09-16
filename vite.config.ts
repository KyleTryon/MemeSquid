import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { offlineAppPlugin } from './scripts/pwa/buildServiceWorker.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    plugins: [react(), tailwindcss(), offlineAppPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'canvas', test: /node_modules[\\/]konva[\\/]/ },
              { name: 'react', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/ },
            ],
          },
        },
      },
    },
    worker: {
      format: 'es',
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: 'inference', test: /node_modules[\\/]onnxruntime-web[\\/]/ }],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});

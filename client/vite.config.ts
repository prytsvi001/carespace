import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Forces every output filename to change on this build, even for chunks
    // whose content is otherwise unchanged — used once to guarantee a clean
    // break from a set of asset URLs a CDN edge (or some other caching layer
    // between a specific user and the origin) was serving stale/404 for,
    // despite the files existing correctly and a CDN cache purge. New URLs
    // can't have anything stale cached anywhere for them.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash]-r1.js',
        chunkFileNames: 'assets/[name]-[hash]-r1.js',
        assetFileNames: 'assets/[name]-[hash]-r1[extname]',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});

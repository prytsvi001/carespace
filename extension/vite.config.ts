import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { cpSync } from 'fs';

// manifest.json and icons/ are plain static assets Chrome reads directly —
// Vite has no built-in step for that outside of `publicDir` (which would also
// require moving them out of the extension root), so just copy them into
// dist/ once the JS/HTML bundles are written.
function copyExtensionAssets(): Plugin {
  return {
    name: 'copy-extension-assets',
    writeBundle() {
      cpSync(resolve(__dirname, 'manifest.json'), resolve(__dirname, 'dist/manifest.json'));
      cpSync(resolve(__dirname, 'icons'), resolve(__dirname, 'dist/icons'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        background: resolve(__dirname, 'background.ts'),
      },
      output: {
        // Fixed, unhashed filenames — manifest.json references dist/background.js
        // and dist/popup.html by exact name, and MV3 service workers can't be
        // pointed at a hashed/rotating filename.
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});

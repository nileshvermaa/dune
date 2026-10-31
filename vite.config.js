import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});

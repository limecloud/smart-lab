import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.LAB_WEB_PORT ?? 5174),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.LAB_API_PORT ?? 4311}`,
        changeOrigin: false,
      },
    },
  },
  build: { outDir: 'dist/client' },
});

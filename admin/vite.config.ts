import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    host: true,
    proxy: {
      // Dev-only CORS bypass: forward /v1/* to the backend at :8000
      '/v1': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});

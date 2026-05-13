import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  envDir: '..', // .env lives at repo root
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/manifest.json': 'http://localhost:3001',
    },
  },
})

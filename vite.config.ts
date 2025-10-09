import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // Enable access from outside container
    port: 5173,
    watch: {
      usePolling: true, // Enable polling for file changes in Docker
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
})

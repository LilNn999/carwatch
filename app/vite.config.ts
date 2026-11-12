import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/v2/',
  plugins: [react()],
  build: { outDir: '../web/v2', emptyOutDir: true },
  server: { port: 5180, proxy: { '/api': 'http://127.0.0.1:5138' } },
})

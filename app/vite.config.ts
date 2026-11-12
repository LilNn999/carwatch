import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { outDir: '../web', emptyOutDir: true },
  server: { port: 5180, proxy: { '/api': 'http://127.0.0.1:5138' } },
})

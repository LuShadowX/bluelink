import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so the same build works on GitHub Pages, a subpath, or inside
  // a Capacitor/WebView shell where assets load from file://
  base: './',
  build: {
    target: 'es2022',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    open: false,
  },
})

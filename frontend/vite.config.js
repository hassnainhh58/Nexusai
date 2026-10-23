import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API calls to the FastAPI backend so the browser sees a same-origin
    // request. This avoids CORS entirely, even when Vite picks a different port.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split the large, rarely-changing dependencies into their own chunks so a
    // code change does not invalidate the whole bundle in the browser cache.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-syntax-highlighter') || id.includes('refractor') || id.includes('prismjs')) {
            return 'syntax-highlighter'
          }
          if (id.includes('@clerk')) return 'clerk'
          if (id.includes('react-markdown') || id.includes('remark') || id.includes('micromark') || id.includes('mdast') || id.includes('hast')) {
            return 'markdown'
          }
          if (id.includes('react')) return 'react'
          return 'vendor'
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
})

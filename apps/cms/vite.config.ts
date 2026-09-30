import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  server: { port: 5174, proxy: { '/api/admin': process.env.ICAROS_CMS_API_TARGET ?? 'http://127.0.0.1:3000' } },
})

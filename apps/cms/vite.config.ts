import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), {
    name: 'cognito-local-origin',
    configureServer(server) {
      const callback = process.env.COGNITO_CALLBACK_URL
      if (!callback) return
      const canonical = new URL(callback)
      if (canonical.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(canonical.hostname)) return
      server.middlewares.use((request, response, next) => {
        const host = request.headers.host
        if (host && ['localhost', '127.0.0.1'].includes(host.split(':')[0] ?? '') && host !== canonical.host) {
          const target = new URL(canonical.origin)
          const original = new URL(request.url ?? '/', canonical.origin)
          target.pathname = original.pathname
          target.search = original.search
          response.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' }).end()
          return
        }
        next()
      })
    },
  }],
  base: '/admin/',
  server: { port: 5174, proxy: { '/api/admin': process.env.ICAROS_CMS_API_TARGET ?? 'http://127.0.0.1:3000' } },
})

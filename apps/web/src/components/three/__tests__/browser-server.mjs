import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const server = await createServer({
  configFile: false,
  root,
  cacheDir: `/tmp/icaros-w16-vite-${process.pid}`,
  plugins: [react()],
  optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react-dom/client', 'three', '@react-three/fiber', 'next/dynamic', 'next/image'] },
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  server: { hmr: false, watch: { ignored: ['**/.next/**', '**/out/**'] }, host: '127.0.0.1', port: 5196, strictPort: true, fs: { allow: [path.resolve(root, '../..'), realpathSync(path.resolve(root, '../../node_modules'))] } },
})
await server.listen()
console.log('W16 fixture: http://127.0.0.1:5196/src/components/three/__tests__/browser-check.html')

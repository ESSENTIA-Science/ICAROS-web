import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  resolve: { alias: {
    '@': fileURLToPath(new URL('../src', import.meta.url)),
    'server-only': fileURLToPath(new URL('./empty.mjs', import.meta.url)),
  } },
  esbuild: { jsx: 'automatic' },
  test: { include: ['apps/web/tests/public-ui.test.tsx', 'apps/web/tests/g-runtime.test.ts', 'apps/web/tests/refresh-on-publish.test.ts'] },
})

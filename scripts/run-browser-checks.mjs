import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dependencyRoot = existsSync(path.join(root, 'node_modules/playwright')) ? root : process.env.ICAROS_TEST_TOOLS ?? path.resolve(root, '../test-tools')
const require = createRequire(path.join(dependencyRoot, 'package.json'))
const { chromium } = require('playwright')
const executable = process.env.ICAROS_BROWSER_EXECUTABLE ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath())
for (const file of ['scripts/browser-check.mjs', 'apps/web/tests/browser/check.mjs', 'apps/web/src/components/three/__tests__/browser-runner.mjs']) {
  const result = spawnSync(process.execPath, [file], { cwd: root, stdio: 'inherit', env: { ...process.env,
    ICAROS_TEST_TOOLS: path.join(dependencyRoot, 'node_modules'), ICAROS_TEST_PLAYWRIGHT_MODULE: path.join(dependencyRoot, 'node_modules/playwright/index.mjs'),
    ICAROS_BROWSER_EXECUTABLE: executable, ICAROS_TEST_CHROME: executable, CHROME_BIN: executable,
  } })
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
}

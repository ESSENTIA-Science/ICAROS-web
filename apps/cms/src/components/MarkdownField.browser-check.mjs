// Run with the CMS Vite server on port 5187; no packages are installed.
import { spawn } from 'node:child_process'
import process from 'node:process'
import { mkdtempSync, openSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'

const temporary = mkdtempSync(join(tmpdir(), 'icaros-markdown-check-'))
const output = join(temporary, 'result.html')
const browser = spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking',
  `--user-data-dir=${join(temporary, 'profile')}`, '--virtual-time-budget=10000', '--dump-dom',
  'http://127.0.0.1:5187/admin/src/components/MarkdownField.browser-check.html',
], { stdio: ['ignore', openSync(output, 'w'), openSync(join(temporary, 'browser.log'), 'w')] })
let failure
browser.on('error', error => { failure = error })
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    await setTimeout(250)
    if (failure) throw failure
    const html = readFileSync(output, 'utf8')
    const result = /<pre id="result">([\s\S]*?)<\/pre>/.exec(html)?.[1]
    if (result?.includes('RESULT ')) {
      console.log(result)
      process.exitCode = result.endsWith('RESULT PASS') ? 0 : 1
      break
    }
    if (attempt === 119) throw new Error(`Browser checks did not complete; diagnostic files: ${temporary}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally { browser.kill('SIGTERM') }

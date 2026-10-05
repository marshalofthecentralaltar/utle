/**
 * Run against a dev server whose model is missing (rename models/ first). Checks that the server
 * answers the socket with "unavailable" and closes it, and that the page switches to Chrome's
 * recogniser once, shows one line, and does not keep reconnecting. Saves docs/proof/asr-fallback.png.
 *
 *   npx tsx scripts/asr-fallback-check.ts http://localhost:5181
 */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { WebSocket } from 'ws'
import { ASR_PATH, FELL_BACK } from '../src/speech/asrProtocol.ts'

const base = process.argv[2] ?? 'http://localhost:5173'
const SHOT = fileURLToPath(new URL('../docs/proof/asr-fallback.png', import.meta.url))

const server = await new Promise<{ messages: string[]; closeCode: number }>((resolve, reject) => {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + ASR_PATH)
  const messages: string[] = []
  ws.on('message', (data) => messages.push(data.toString()))
  ws.on('close', (closeCode) => resolve({ messages, closeCode }))
  ws.on('error', reject)
})
console.log(`server said: ${server.messages.join(' ')}; closed with ${server.closeCode}`)

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
let ok = false
try {
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  let sockets = 0
  page.on('websocket', (ws) => {
    if (ws.url().endsWith(ASR_PATH)) sockets += 1
  })
  const usedChrome: string[] = []
  await page.exposeFunction('reportChrome', (lang: string) => usedChrome.push(lang))
  // Watch Chrome's recognition so the check can see that the page started it. A string, so the
  // script runs in the page exactly as written (tsx would add helpers the page does not have).
  await page.addInitScript(`
    const Original = window.webkitSpeechRecognition || window.SpeechRecognition
    if (Original) {
      const start = Original.prototype.start
      Original.prototype.start = function () {
        window.reportChrome(this.lang)
        return start.call(this)
      }
    }
  `)
  await page.goto(base)
  await page.getByRole('button', { name: 'Turn the microphone on' }).click()
  await page.waitForTimeout(5000)
  const notices = await page.getByText(FELL_BACK).count()
  console.log(`sockets opened to ${ASR_PATH} in 5 s: ${sockets}`)
  console.log(`Chrome recognition started: ${usedChrome.length} time(s), language ${usedChrome[0] ?? '-'}`)
  console.log(`fallback line visible: ${notices === 1 ? 'yes' : `no (${notices})`}`)
  console.log(`microphone button: ${await page.locator('nav[aria-label="Controls"] button').first().innerText()}`)
  await page.screenshot({ path: SHOT })
  console.log(`screenshot: ${SHOT}`)
  ok = server.messages.some((m) => m.includes('"unavailable"')) && sockets === 1 && usedChrome.length >= 1 && notices === 1
} finally {
  await browser.close()
}
process.exit(ok ? 0 : 1)

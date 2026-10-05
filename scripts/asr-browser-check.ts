/**
 * The real browser path without a person: Chromium's fake microphone plays an Estonian sentence,
 * the page streams it through the worklet and the websocket, and the caption strip shows what was
 * heard. Saves docs/proof/asr-browser.png.
 *
 *   npx vite --port 5181 --strictPort        (in another shell)
 *   npx tsx scripts/asr-browser-check.ts http://localhost:5181
 */
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173'
const WAV = fileURLToPath(new URL('./fixtures/et-sentence-16k.wav', import.meta.url))
const SHOT = fileURLToPath(new URL('../docs/proof/asr-browser.png', import.meta.url))
const WANTED = 'vaheleht'
const channel = process.env.ASR_CHECK_CHANNEL

const browser = await chromium.launch({
  ...(channel ? { channel } : {}),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required'],
})
let code = 1
try {
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const socketFrames = { sent: 0, received: [] as string[] }
  page.on('websocket', (ws) => {
    if (!ws.url().endsWith('/api/asr')) return
    ws.on('framesent', () => (socketFrames.sent += 1))
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string') socketFrames.received.push(frame.payload)
    })
  })
  await page.goto(base)
  await page.getByRole('button', { name: 'Turn the microphone on' }).click()

  // The heard line (the last utterance as recognised) is the first live region in the caption strip.
  const heardLine = page.locator('p[aria-live="polite"]').first()
  const deadline = Date.now() + 30_000
  let heard = ''
  while (Date.now() < deadline) {
    heard = await heardLine.innerText()
    if (heard.includes(WANTED)) break
    await page.waitForTimeout(250)
  }
  console.log(`audio frames sent over /api/asr: ${socketFrames.sent}`)
  console.log(`server messages: ${socketFrames.received.map((m) => (JSON.parse(m) as { type: string }).type).join(', ')}`)
  console.log(`heard on the page: ${heard === '' ? '(nothing)' : heard}`)
  mkdirSync(fileURLToPath(new URL('../docs/proof/', import.meta.url)), { recursive: true })
  await page.screenshot({ path: SHOT })
  console.log(`screenshot: ${SHOT}`)
  code = heard.includes(WANTED) ? 0 : 1
} finally {
  await browser.close()
}
process.exit(code)

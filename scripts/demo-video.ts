/**
 * Records the demo video for utle.ee: the real extension, the real local recogniser and a fake
 * microphone playing Estonian speech into the WhatsApp stand-in page. No person, no cut.
 *
 * Needs the dev server: npx vite --port 5193 --strictPort, and an extension build (npm run ext).
 *
 *   npx tsx scripts/demo-video.ts <speech-16k.wav> <out-dir>
 *
 * Writes <out-dir>/demo-raw.webm (silent, as recorded) and <out-dir>/demo-meta.json with the
 * offsets that line the speech up with the picture; the muxing is done by ffmpeg afterwards
 * (docs/brand/README.md "Demo video").
 */
import { mkdtemp, rm, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Page, Worker } from 'playwright'

/* The extension's own API, as far as the callbacks below use it (this file is compiled without the chrome types). */
declare const chrome: {
  storage: { local: { set: (items: Record<string, unknown>) => Promise<void> }; session: { get: (key: string) => Promise<Record<string, unknown>> } }
  tabs: { query: (q: Record<string, never>) => Promise<Array<{ id?: number; url?: string }>>; sendMessage: (id: number, message: unknown) => Promise<unknown> }
}
declare const window: { sentTo: (name: string) => string[] }

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const PORT = process.env.UTLE_PORT ?? '5193'
const BASE = `http://localhost:${PORT}`
const FIX = `${BASE}/extension/test/fixtures`
const ASR = `ws://localhost:${PORT}/api/asr`
const WIDTH = 1280
const HEIGHT = 720

const [wav, outDir] = process.argv.slice(2)
if (!wav || !outDir) throw new Error('usage: demo-video.ts <speech-16k.wav> <out-dir>')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Measure {
  mic: { left: number; top: number; width: number; height: number }
}
interface State {
  heard: string
  line: string
  micOpenedAt: number
}

/** The stand-in page dressed as WhatsApp Web looks, so the recording reads as the site it stands for. */
const DRESS = `
  body { font: 15px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111b21; }
  #side { width: 400px; border-right: 1px solid #e9edef; background: #fff; }
  #side input { margin: 8px 12px; padding: 9px 12px 9px 40px; border: 0; border-radius: 8px; background: #f0f2f5; font: inherit; color: #3b4a54; }
  [role="row"] { padding: 14px 16px; border-bottom: 1px solid #f0f2f5; display: grid; grid-template-columns: 49px 1fr; column-gap: 15px; align-items: center; }
  #grid [role="row"]::before { content: ""; width: 49px; height: 49px; border-radius: 50%; background: #dfe5e7; grid-row: 1 / span 2; }
  #grid [role="row"] > div { grid-column: 2; }
  #grid [role="row"] > div:first-of-type { font-size: 17px; }
  #grid [role="row"] .last { color: #667781; font-size: 14px; }
  #right { background: #efeae2; }
  #right > p { color: #41525d; font-size: 32px; font-weight: 300; }
  #main header { padding: 10px 16px; background: #f0f2f5; font-size: 16px; display: flex; align-items: center; gap: 15px; min-height: 59px; box-sizing: border-box; }
  #main header::before { content: ""; width: 40px; height: 40px; border-radius: 50%; background: #dfe5e7; flex: none; }
  #main .msgs { background: #efeae2 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Ccircle cx='20' cy='20' r='2' fill='%23e4dfd5'/%3E%3Ccircle cx='80' cy='60' r='2' fill='%23e4dfd5'/%3E%3Ccircle cx='40' cy='100' r='2' fill='%23e4dfd5'/%3E%3C/svg%3E"); padding: 12px 60px; }
  #main .msgs [role="row"] { display: block; padding: 0; border: 0; }
  [data-id] .bubble { padding: 6px 7px 8px 9px; font-size: 14.2px; line-height: 19px; border-radius: 7.5px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
  [data-id] .time { font-size: 11px; color: #667781; margin-left: 8px; }
  .divider { margin: 8px 0; }
  .divider span { display: inline-block; padding: 5px 12px; background: #fff; border-radius: 7.5px; font-size: 12.5px; color: #54656f; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
  #main footer { padding: 10px 16px; background: #f0f2f5; align-items: center; }
  #main footer [role="textbox"] { padding: 9px 12px; border-radius: 8px; min-height: 20px; font-size: 15px; line-height: 20px; }
  #main footer button { width: 40px; height: 40px; border: 0; border-radius: 50%; background: #00a884; color: #fff; font: 18px/40px sans-serif; padding: 0; }
  #main footer button span { display: inline-block; transform: translateX(1px); }
  /* The test gap (a screen of pictures above the last messages) is not part of the picture. */
  .divider .gap { height: 0 !important; }
`

const state = async (sw: Worker): Promise<State> => sw.evaluate(async () => (await chrome.storage.session.get('stripState')).stripState as State)

async function measure(sw: Worker, url: string): Promise<Measure | null> {
  return sw.evaluate(async (u) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === u)
    if (tab?.id === undefined) return null
    return (await chrome.tabs.sendMessage(tab.id, { type: 'utle-strip-measure' })) as Measure
  }, url)
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true })
  const videoDir = join(outDir, 'raw')
  await mkdir(videoDir, { recursive: true })
  const profile = await mkdtemp(join(tmpdir(), 'utle-demo-'))
  const extensionDir = join(repoRoot, 'extension')
  const args = [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${resolve(wav)}%noloop`,
    '--hide-scrollbars',
  ]
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: false,
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width: WIDTH, height: HEIGHT } },
    args,
  })
  const trail: string[] = []
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
    await sw.evaluate(
      ({ asr, prefix }) => chrome.storage.local.set({ asrUrl: asr, siteOverrides: { [prefix]: 'whatsapp' } }),
      { asr: ASR, prefix: `${FIX}/whatsapp.html` },
    )
    // The permission page opens on install and closes itself.
    await sleep(2500)
    for (const p of ctx.pages()) if (p.url().includes('/permission.html')) await p.waitForEvent('close', { timeout: 8000 }).catch(() => undefined)

    const page: Page = await ctx.newPage()
    const created = Date.now()
    for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => undefined)
    const URL = `${FIX}/whatsapp.html`
    await page.goto(URL)
    await page.addStyleTag({ content: DRESS })
    await page.bringToFront()
    await sleep(2200)

    let polling = true
    void (async () => {
      while (polling) {
        const st = await state(sw).catch(() => undefined)
        const entry = st ? `${Date.now() - created} heard=${JSON.stringify(st.heard)} line=${JSON.stringify(st.line)}` : ''
        if (entry && trail[trail.length - 1]?.split(' ').slice(1).join(' ') !== entry.split(' ').slice(1).join(' ')) trail.push(entry)
        await sleep(100)
      }
    })()

    const m = await measure(sw, URL)
    if (!m) throw new Error('no strip on the page')
    // Rest the pointer on the microphone (as an eye tracker would), then leave it.
    const cx = m.mic.left + m.mic.width / 2
    const cy = m.mic.top + m.mic.height / 2
    await page.mouse.move(cx - 200, cy - 300)
    await sleep(400)
    const hoverAt = Date.now() - created
    await page.mouse.move(cx, cy, { steps: 12 })
    await sleep(1400)
    await page.mouse.move(WIDTH - 60, 80, { steps: 10 })

    const sentTo = async (): Promise<string[]> => page.evaluate(() => window.sentTo('Mari Maasikas'))
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline && (await sentTo().catch(() => [])).length === 0) await sleep(150)
    const sent = await sentTo().catch(() => [])
    await sleep(3500)
    polling = false
    const st = await state(sw)
    const meta = {
      created,
      hoverAt,
      micOpenedAt: st.micOpenedAt - created,
      endAt: Date.now() - created,
      sent,
      trail,
    }
    const video = page.video()
    await page.close()
    const path = video ? await video.path() : null
    if (!path) throw new Error('no video recorded')
    await copyFile(path, join(outDir, 'demo-raw.webm'))
    await writeFile(join(outDir, 'demo-meta.json'), JSON.stringify(meta, null, 2))
    console.log(JSON.stringify(meta, null, 2))
    if (sent.length !== 1) {
      console.error('FAIL: nothing was sent to Mari')
      process.exitCode = 1
    }
  } finally {
    await ctx.close().catch(() => undefined)
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
}

await main()

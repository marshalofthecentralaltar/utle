// End-to-end voice test of in-page mode (docs/ARCHITECTURE.md 21.2), with no person: Playwright's
// Chromium loads the extension built with the stand-in step functions (extension/test/standin.ts),
// and a fake microphone plays an Estonian recording into the real local recogniser.
//
// Expects the dev server in this worktree: npx vite --port 5193 --strictPort
//   npx tsx extension/test/voice.ts         criteria 1, 2, 4, 7: dictation and send, scroll and tab, the strip
//   npx tsx extension/test/voice.ts down    criterion 6: start with the dev server STOPPED; start it when told

import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { BrowserContext, Page, Worker } from 'playwright'
import { buildExtension } from '../../scripts/ext.ts'
import { STRINGS } from '../../src/core/strings.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const BASE = 'http://localhost:5193'
const FIX = `${BASE}/extension/test/fixtures`
const ASR = 'ws://localhost:5193/api/asr'
const proof = (name: string): string => join(repoRoot, 'docs/proof', name)

interface Measure {
  strip: { left: number; top: number; width: number; height: number }
  mic: { left: number; top: number; width: number; height: number }
  micState: string
  heard: string
  line: string
}
interface State {
  listening: boolean
  resting: boolean
  heard: string
  line: string
  problem: string
  connects: number
  micOpens: number
}

let failures = 0
function check(label: string, pass: boolean, detail = ''): void {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${detail}`)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitUntil(test: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await test()) return true
    await sleep(100)
  }
  return test()
}

async function serverUp(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/extension/test/fixtures/chat.html`)).ok
  } catch {
    return false
  }
}

interface Session {
  /** Every distinct heard / line pair the strip state went through, for the log. */
  trail: string[]
  stopTrail: () => void
  ctx: BrowserContext
  sw: Worker
  profile: string
  permission: { opened: number; closedAfterMs: number | null }
}

async function launch(extensionDir: string, wav: string | null): Promise<Session> {
  const profile = await mkdtemp(join(tmpdir(), 'utle-voice-'))
  const args = [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ]
  if (wav) args.push(`--use-file-for-fake-audio-capture=${wav}%noloop`)
  // Headed: Playwright's headless Chromium crashes as soon as the extension's service worker is evaluated.
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: { width: 1280, height: 800 }, args })
  const permission: Session['permission'] = { opened: 0, closedAfterMs: null }
  const watch = (p: Page): void => {
    if (!p.url().includes('/permission.html')) return
    permission.opened += 1
    const t0 = Date.now()
    p.on('close', () => {
      permission.closedAfterMs = Date.now() - t0
    })
  }
  ctx.on('page', (p) => {
    // The url is known once it commits.
    void p.waitForLoadState('domcontentloaded').then(() => watch(p), () => undefined)
  })
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
  await sw.evaluate((asr) => chrome.storage.local.set({ asrUrl: asr }), ASR)
  const trail: string[] = []
  let polling = true
  void (async () => {
    while (polling) {
      const st = await sw.evaluate(async () => (await chrome.storage.session.get('stripState')).stripState as State | undefined).catch(() => undefined)
      const entry = st ? `heard=${JSON.stringify(st.heard)} line=${JSON.stringify(st.line)}${st.problem ? ` problem=${JSON.stringify(st.problem)}` : ''}` : ''
      if (entry && trail[trail.length - 1] !== entry) trail.push(entry)
      await sleep(150)
    }
  })()
  return { ctx, sw, profile, permission, trail, stopTrail: () => (polling = false) }
}

async function close(s: Session): Promise<void> {
  s.stopTrail()
  console.log('      strip states seen:')
  for (const entry of s.trail) console.log(`        ${entry}`)
  await s.ctx.close().catch(() => undefined)
  await rm(s.profile, { recursive: true, force: true }).catch(() => undefined)
}

const state = async (sw: Worker): Promise<State> => sw.evaluate(async () => (await chrome.storage.session.get('stripState')).stripState as State)
const offscreenCreated = async (sw: Worker): Promise<number> => sw.evaluate(async () => ((await chrome.storage.session.get('offscreenCreated')).offscreenCreated as number | undefined) ?? 0)

async function measure(sw: Worker, url: string): Promise<Measure | null> {
  return sw.evaluate(async (u) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === u)
    if (tab?.id === undefined) return null
    return (await chrome.tabs.sendMessage(tab.id, { type: 'utle-strip-measure' })) as Measure
  }, url)
}

async function composerBox(page: Page, selector: string): Promise<{ left: number; top: number; width: number; height: number; centreHit: boolean }> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { left: 0, top: 0, width: 0, height: 0, centreHit: false }
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { left: r.left, top: r.top, width: r.width, height: r.height, centreHit: hit !== null && (hit === el || el.contains(hit)) }
  }, selector)
}

const box = (b: { left: number; top: number; width: number; height: number }): string =>
  `x=${Math.round(b.left)} y=${Math.round(b.top)} w=${Math.round(b.width)} h=${Math.round(b.height)}`

async function stripChecks(sw: Worker, page: Page, url: string, selector: string, label: string): Promise<Measure | null> {
  const m = await measure(sw, url)
  const c = await composerBox(page, selector)
  console.log(`      ${label}: strip ${m ? box(m.strip) : 'missing'}; mic ${m ? box(m.mic) : 'missing'}; composer ${box(c)} centre hit=${c.centreHit}`)
  check(`${label}: composer fully above the strip`, m !== null && c.height > 0 && c.top + c.height <= m.strip.top + 0.5, m ? `composer bottom ${Math.round(c.top + c.height)} <= strip top ${Math.round(m.strip.top)}` : '')
  check(`${label}: elementFromPoint at composer centre is the composer`, c.centreHit)
  check(`${label}: microphone control at least 96x96`, m !== null && m.mic.width >= 96 && m.mic.height >= 96, m ? `${Math.round(m.mic.width)}x${Math.round(m.mic.height)}` : '')
  return m
}

// ---------- criteria 1, 4, 7: dictation and send, by voice alone ----------

async function dictateAndSend(extensionDir: string): Promise<void> {
  console.log('\n== 1. dictation and "saada" into a Lexical box (fake microphone: et-dictate-send-16k.wav) ==')
  const s = await launch(extensionDir, join(repoRoot, 'scripts/fixtures/et-dictate-send-16k.wav'))
  try {
    const page = s.ctx.pages()[0] ?? (await s.ctx.newPage())
    const CHAT = `${FIX}/chat.html`
    await page.goto(CHAT)
    await page.bringToFront()
    await page.waitForFunction(() => (window as unknown as { lexicalReady?: boolean }).lexicalReady === true)
    const permissionClosed = await waitUntil(async () => s.permission.closedAfterMs !== null, 8000)
    check('7. permission page opened on install and closed itself', s.permission.opened === 1 && permissionClosed, `opened=${s.permission.opened} closed after ${s.permission.closedAfterMs} ms`)

    await sleep(1200)
    const m = await stripChecks(s.sw, page, CHAT, '#composer', '4. chat fixture (composer at the bottom, % heights)')
    if (!m) throw new Error('no strip')
    await page.screenshot({ path: proof('inpage-strip.png') })

    // Hover the microphone 1.3 s with no click: listening turns on.
    const cx = m.mic.left + m.mic.width / 2
    const cy = m.mic.top + m.mic.height / 2
    await page.mouse.move(cx, cy, { steps: 4 })
    await sleep(1300)
    const afterHover = await state(s.sw)
    check('4. hovering the microphone 1.3 s turns listening on, no click', afterHover?.listening === true, `listening=${afterHover?.listening}`)
    await sleep(800)
    const still = await state(s.sw)
    check('4. no refire while the pointer stays', still?.listening === true)
    await page.mouse.move(640, 200, { steps: 4 })

    const lexical = async (): Promise<string> => page.evaluate(() => (window as unknown as { lexicalText: () => string }).lexicalText())
    const sent = async (): Promise<string[]> => page.evaluate(() => (window as unknown as { sent: () => string[] }).sent())
    const t0 = Date.now()
    const arrived = await waitUntil(async () => (await lexical()).trim() !== '', 30_000)
    const boxText = await lexical()
    console.log(`      box after the sentence (${Date.now() - t0} ms after listening): ${JSON.stringify(boxText)}`)
    await page.screenshot({ path: proof('inpage-voice.png') })
    const during = await measure(s.sw, CHAT)
    console.log(`      strip while the sentence is in the box: mic=${during?.micState} heard=${JSON.stringify(during?.heard)} line=${JSON.stringify(during?.line)}`)
    check('1. the recognised sentence lands in the Lexical box', arrived && boxText.trim().length > 10, JSON.stringify(boxText))
    check('1. strip shows listening and the heard words', during?.micState === 'listening' && (during?.heard ?? '') !== '')

    const delivered = await waitUntil(async () => (await sent()).length > 0, 20_000)
    await sleep(2500)
    const list = await sent()
    console.log(`      sent list: ${JSON.stringify(list)}; box now ${JSON.stringify(await lexical())}`)
    check('1. "saada" sends exactly that text, once', delivered && list.length === 1 && list[0] === boxText.trim() && (await lexical()) === '', `sent=${JSON.stringify(list)}`)
    const end = await state(s.sw)
    console.log(`      strip line after send: ${JSON.stringify(end?.line)}; connects=${end?.connects} micOpens=${end?.micOpens}`)
    await page.screenshot({ path: proof('inpage-sent.png') })

    // The strip on a dark page whose app is built on 100vh.
    const DARK = `${FIX}/dark.html`
    await page.goto(DARK)
    await sleep(1500)
    await stripChecks(s.sw, page, DARK, '#box', '4. dark fixture (100vh app, textarea)')
    await page.screenshot({ path: proof('inpage-strip-dark.png') })
  } finally {
    await close(s)
  }
}

// ---------- criterion 2: the browser by voice from the same session ----------

async function scrollAndTab(extensionDir: string): Promise<void> {
  console.log('\n== 2. "keri alla", then "järgmine vaheleht" (fake microphone: et-scroll-tab-16k.wav) ==')
  const s = await launch(extensionDir, join(repoRoot, 'scripts/fixtures/et-scroll-tab-16k.wav'))
  try {
    const LONG = `${FIX}/target.html`
    const OTHER = `${FIX}/page-two.html`
    const first = s.ctx.pages()[0] ?? (await s.ctx.newPage())
    await first.goto(LONG)
    const second = await s.ctx.newPage()
    await second.goto(OTHER)
    await first.bringToFront()
    await waitUntil(async () => s.permission.closedAfterMs !== null, 8000)
    await sleep(1200)
    const m = await measure(s.sw, LONG)
    if (!m) throw new Error('no strip')
    // This time a click turns listening on.
    await first.mouse.click(m.mic.left + m.mic.width / 2, m.mic.top + m.mic.height / 2)
    await first.mouse.move(640, 200)
    const on = await waitUntil(async () => (await state(s.sw))?.listening === true, 3000)
    check('2. a click on the microphone turns listening on', on)

    const scrolled = await waitUntil(async () => (await first.evaluate(() => window.scrollY)) > 0, 20_000)
    const y = await first.evaluate(() => window.scrollY)
    check('2. "keri alla" scrolled the page', scrolled, `scrollY=${y}`)
    const activeUrl = async (): Promise<string> =>
      s.sw.evaluate(async () => {
        const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
        return t?.url ?? ''
      })
    const switched = await waitUntil(async () => (await activeUrl()) === OTHER, 20_000)
    check('2. "järgmine vaheleht" made the other tab active', switched, `active=${await activeUrl()}`)
    await sleep(500)
    const there = await measure(s.sw, OTHER)
    const st = await state(s.sw)
    const created = await offscreenCreated(s.sw)
    console.log(`      strip in the new tab: mic=${there?.micState} heard=${JSON.stringify(there?.heard)} line=${JSON.stringify(there?.line)}; offscreen created ${created}x, microphone opened ${st?.micOpens}x, connects ${st?.connects}`)
    check('2. the new tab strip shows listening', there?.micState === 'listening')
    check('2. same offscreen document (created once), microphone opened once', created === 1 && st?.micOpens === 1)
    await second.screenshot({ path: proof('inpage-tab-switched.png') })
  } finally {
    await close(s)
  }
}

// ---------- criterion 6: the speech model is not reachable ----------

async function serverDown(extensionDir: string): Promise<void> {
  console.log('\n== 6. dev server stopped: listening on ==')
  if (await serverUp()) throw new Error(`Stop the dev server on ${BASE} first.`)
  const s = await launch(extensionDir, null)
  try {
    // A page that does not need the dev server.
    const page = s.ctx.pages()[0] ?? (await s.ctx.newPage())
    await page.goto('https://example.com/').catch(async () => page.goto('about:blank'))
    await waitUntil(async () => s.permission.closedAfterMs !== null, 8000)
    await sleep(1200)
    const url = page.url()
    const m = await measure(s.sw, url)
    if (!m) throw new Error(`no strip on ${url}`)
    await page.mouse.click(m.mic.left + m.mic.width / 2, m.mic.top + m.mic.height / 2)
    await page.mouse.move(640, 200)
    await sleep(10_000)
    const st = await state(s.sw)
    const shown = await measure(s.sw, url)
    console.log(`      after 10 s: listening=${st?.listening} connects=${st?.connects} strip line=${JSON.stringify(shown?.line)}`)
    check('6. strip says plainly that the speech model is not reachable', shown?.line === STRINGS.et.strip.modelUnreachable && st?.listening === false)
    check('6. no retry storm: at most 3 connection attempts in 10 s', (st?.connects ?? 99) <= 3, `connects=${st?.connects}`)
    await page.screenshot({ path: proof('inpage-unreachable.png') })

    console.log('      START THE DEV SERVER NOW (npx vite --port 5193 --strictPort); waiting up to 90 s')
    const up = await waitUntil(serverUp, 90_000)
    if (!up) throw new Error('the dev server did not come up')
    await sleep(6000)
    await page.mouse.click(m.mic.left + m.mic.width / 2, m.mic.top + m.mic.height / 2)
    await page.mouse.move(640, 200)
    await sleep(4000)
    const back = await state(s.sw)
    const line = await measure(s.sw, url)
    console.log(`      after toggling again: listening=${back?.listening} problem=${JSON.stringify(back?.problem)} micOpens=${back?.micOpens} strip line=${JSON.stringify(line?.line)}`)
    check('6. with the server back, toggling again recovers', back?.listening === true && back.problem === '' && back.micOpens === 1)
  } finally {
    await close(s)
  }
}

async function main(): Promise<void> {
  await mkdir(join(repoRoot, 'docs/proof'), { recursive: true })
  // UTLE_REAL=1 builds with the real src/core/inpage.ts instead of the stand-in.
  const real = process.env.UTLE_REAL === '1'
  const extensionDir = await buildExtension({ outRoot: join(here, '.standin'), ...(real ? {} : { offscreenEntry: join(here, 'standin-offscreen.ts') }) })
  if (real) console.log('(built with the real src/core/inpage.ts)')
  if (process.argv[2] === 'down') {
    await serverDown(extensionDir)
  } else {
    if (!(await serverUp())) throw new Error(`The dev server is not running on ${BASE}. Start: npx vite --port 5193 --strictPort`)
    await dictateAndSend(extensionDir)
    await scrollAndTab(extensionDir)
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

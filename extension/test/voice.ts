// End-to-end voice test of in-page mode (docs/ARCHITECTURE.md 21.2, 21.3), with no person:
// Playwright's Chromium loads the extension built with the stand-in step functions
// (extension/test/standin.ts), and a fake microphone plays an Estonian recording into the real
// local recogniser.
//
// Expects the dev server in this worktree: npx vite --port 5193 --strictPort (UTLE_PORT=5194 for another port)
//   npx tsx extension/test/voice.ts           dictation with live words and send, scroll and tab, the new-tab page
//   npx tsx extension/test/voice.ts baseline  the dictation timings as main b901d29 behaved (no previews, 700 ms hold)
//   npx tsx extension/test/voice.ts down      start with the dev server STOPPED; start it when told
//   UTLE_ONLY=onlyowner                        only section 7: only the owner with the real models (a server of its own)
//   UTLE_ONLY=listen                           only section 8: addressed speech, two synthetic voices, the real models, no browser
//   UTLE_ONLY=wake                             only section 9: the wake word heard in the audio (the keyword spotter), the real models, no browser
//   UTLE_ONLY=wakechrome                       only section 10: wake mode in Chromium with the spotter, a server of its own (the dev server serves the pages)

import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { BrowserContext, Page, Worker } from 'playwright'
import { buildExtension } from '../../scripts/ext.ts'
import { STRINGS } from '../../src/core/strings.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const PORT = process.env.UTLE_PORT ?? '5193'
const BASE = `http://localhost:${PORT}`
const FIX = `${BASE}/extension/test/fixtures`
const ASR = `ws://localhost:${PORT}/api/asr`
const proof = (name: string): string => join(repoRoot, 'docs/proof', name)

interface Measure {
  connection?: string
  strip: { left: number; top: number; width: number; height: number }
  mic: { left: number; top: number; width: number; height: number }
  micState: string
  heard: string
  heardPx: number
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
  micOpenedAt: number
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

/** Where speech is in a fixture (16 kHz, 16-bit, 44-byte header): [start, end] in ms; a silence of 400 ms or more splits. */
function speechSpans(path: string): Array<[number, number]> {
  const data = readFileSync(path).subarray(44)
  const n = Math.floor(data.length / 2)
  const frame = 320
  const spans: Array<[number, number]> = []
  let start = -1
  let lastLoud = -1
  for (let i = 0; i + frame <= n; i += frame) {
    let sum = 0
    for (let k = 0; k < frame; k += 1) {
      const v = data.readInt16LE((i + k) * 2) / 32768
      sum += v * v
    }
    const t = i / 16
    if (Math.sqrt(sum / frame) < 0.01) continue
    if (start < 0) start = t
    else if (t - lastLoud > 400) {
      spans.push([start, lastLoud + 20])
      start = t
    }
    lastLoud = t
  }
  if (start >= 0) spans.push([start, lastLoud + 20])
  return spans
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

async function launch(extensionDir: string, wav: string | null, loop = false): Promise<Session> {
  const profile = await mkdtemp(join(tmpdir(), 'utle-voice-'))
  const args = [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ]
  // Round 10 (section 7): a short clip loops, so it is heard whenever the microphone opens.
  if (wav) args.push(`--use-file-for-fake-audio-capture=${wav}${loop ? '' : '%noloop'}`)
  // Headed: Playwright's headless Chromium crashes as soon as the extension's service worker is evaluated.
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: { width: 1280, height: 800 }, args })
  const permission: Session['permission'] = { opened: 0, closedAfterMs: null }
  // Round 9 (30.1): the install opens the welcome page; its step 1 asks for the microphone. Once
  // that card ticks the test closes it, as the old permission page closed itself.
  const watch = (p: Page): void => {
    if (!p.url().includes('/welcome.html')) return
    permission.opened += 1
    const t0 = Date.now()
    p.on('close', () => {
      permission.closedAfterMs = Date.now() - t0
    })
    void p
      .waitForSelector('#stepMic[data-done="true"]', { timeout: 8000 })
      .then(() => p.close())
      .catch(() => undefined)
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

const plain = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// ---------- dictation with live words, and "saada", by voice alone ----------

async function dictateAndSend(extensionDir: string, baseline: boolean): Promise<void> {
  console.log(`\n== 1. dictation and "saada" into a Lexical box (fake microphone: et-dictate-send-16k.wav)${baseline ? ' BASELINE: no previews, 700 ms hold' : ''} ==`)
  const wav = join(repoRoot, 'scripts/fixtures/et-dictate-send-16k.wav')
  const spans = speechSpans(wav)
  console.log(`      speech in the recording (ms from its start): ${spans.map(([a, b]) => `${Math.round(a)}-${Math.round(b)}`).join(', ')}`)
  const s = await launch(extensionDir, wav)
  try {
    const page = s.ctx.pages()[0] ?? (await s.ctx.newPage())
    const CHAT = `${FIX}/chat.html`
    await page.goto(CHAT)
    await page.bringToFront()
    await page.waitForFunction(() => (window as unknown as { lexicalReady?: boolean }).lexicalReady === true)
    const permissionClosed = await waitUntil(async () => s.permission.closedAfterMs !== null, 8000)
    check('7. welcome page opened on install, its microphone step ticked', s.permission.opened === 1 && permissionClosed, `opened=${s.permission.opened} closed after ${s.permission.closedAfterMs} ms`)

    await sleep(1200)
    const m = await stripChecks(s.sw, page, CHAT, '#composer', '4. chat fixture (composer at the bottom, % heights)')
    if (!m) throw new Error('no strip')
    if (!baseline) await page.screenshot({ path: proof('inpage-strip.png') })

    const lexical = async (): Promise<string> => page.evaluate(() => (window as unknown as { lexicalText: () => string }).lexicalText())
    const sent = async (): Promise<string[]> => page.evaluate(() => (window as unknown as { sent: () => string[] }).sent())

    // Every 100 ms: the box text and the strip's heard words.
    const samples: Array<{ t: number; box: string; heard: string }> = []
    let sampling = true
    let shot = false
    const sampler = (async () => {
      while (sampling) {
        const t = Date.now()
        const b = await lexical().catch(() => '')
        const shown = await measure(s.sw, CHAT).catch(() => null)
        samples.push({ t, box: b, heard: shown?.heard ?? '' })
        const distinct = new Set(samples.map((x) => x.box).filter((x) => x.trim() !== ''))
        if (!baseline && !shot && distinct.size >= 2) {
          shot = true
          await page.screenshot({ path: proof('inpage-live.png') })
        }
        await sleep(Math.max(0, 100 - (Date.now() - t)))
      }
    })()

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

    const delivered = await waitUntil(async () => (await sent()).length > 0, 40_000)
    await sleep(2500)
    const list = await sent()
    const st = await state(s.sw)
    const t0 = st.micOpenedAt
    const lastSpan = spans[spans.length - 1] ?? [0, 0]
    const sentenceSpans = spans.slice(0, -1)
    const speechStart = t0 + (sentenceSpans[0]?.[0] ?? 0)
    const sentenceEnd = t0 + (sentenceSpans[sentenceSpans.length - 1]?.[1] ?? 0)
    const saadaEnd = t0 + lastSpan[1]
    // 5 s after the last speech, the strip still shows the last words.
    await sleep(Math.max(0, saadaEnd + 5000 - Date.now()))
    const late = await measure(s.sw, CHAT)
    sampling = false
    await sampler

    const final = list[0] ?? ''
    console.log(`      sent list: ${JSON.stringify(list)}; box now ${JSON.stringify(await lexical())}`)
    console.log('      box text sampled every 100 ms (ms from the start of speech, distinct values in order):')
    let previous: string | null = null
    for (const x of samples) {
      if (x.box === previous) continue
      previous = x.box
      console.log(`        ${String(x.t - speechStart).padStart(6)} ms  ${JSON.stringify(x.box)}`)
    }
    const firstAt = samples.find((x) => x.box.trim() !== '')?.t ?? NaN
    const finalAt = samples.find((x) => x.box.trim() === final && final !== '')?.t ?? NaN
    console.log(`      TIMING${baseline ? ' (baseline)' : ''}: end of the sentence at ${sentenceEnd - speechStart} ms; first words in the box ${firstAt - sentenceEnd} ms after it; final text in the box ${finalAt - sentenceEnd} ms after it (negative: while still speaking)`)

    const valuesBefore: string[] = []
    for (const x of samples) {
      if (x.t >= finalAt) break
      if (x.box.trim() !== '' && valuesBefore[valuesBefore.length - 1] !== x.box) valuesBefore.push(x.box)
    }
    const heardDuring = new Set(samples.filter((x) => x.t >= speechStart && x.t <= sentenceEnd + 2000 && x.heard !== '').map((x) => x.heard))
    check('1. "saada" sends exactly the sentence, once, and empties the box', delivered && list.length === 1 && final.length > 10 && (await lexical()) === '', `sent=${JSON.stringify(list)}`)
    check('2. no sampled box value contains "saada"', samples.every((x) => !plain(x.box).split(' ').some((w) => w.startsWith('saada'))))
    if (!baseline) {
      check('1. at least 3 distinct box texts before the final one', valuesBefore.length >= 3, `${valuesBefore.length}: ${JSON.stringify(valuesBefore)}`)
      check('5. first words visible while speech is still playing', firstAt < sentenceEnd, `${firstAt - sentenceEnd} ms`)
      check('8. heard line font size >= 24 px', (late?.heardPx ?? 0) >= 24, `${late?.heardPx} px`)
      check('8. strip heard text changed at least 3 times during the sentence', heardDuring.size >= 3, `${heardDuring.size}: ${JSON.stringify([...heardDuring])}`)
      check('8. 5 s after speech ends the strip still shows the last words', (late?.heard ?? '') !== '', `${Math.round(Date.now() - saadaEnd)} ms after: ${JSON.stringify(late?.heard)}`)
    }
    console.log(`      strip line after send: ${JSON.stringify(st?.line)}; connects=${st?.connects} micOpens=${st?.micOpens}`)
    if (baseline) return
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

// ---------- the browser by voice from the same session ----------

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
    // The box on this page, sampled while the commands are spoken.
    const boxes = new Set<string>()
    let sampling = true
    const sampler = (async () => {
      while (sampling) {
        boxes.add(await first.evaluate(() => (window as unknown as { lexicalText: () => string }).lexicalText()).catch(() => ''))
        await sleep(100)
      }
    })()
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
    sampling = false
    await sampler
    console.log(`      box values seen on the first page: ${JSON.stringify([...boxes])}`)
    check('2. no box value contains "keri", "alla", "järgmine" or "vaheleht"', [...boxes].every((b) => !/keri|alla|järgmine|vaheleht/i.test(b)))
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

// ---------- the new-tab page: strip, tiles, numbers by voice ----------

async function newTabPage(extensionDir: string): Promise<void> {
  console.log('\n== 6. the new-tab page: "näita numbreid", then "üks" (fake microphone: et-numbers-one-16k.wav) ==')
  const s = await launch(extensionDir, join(repoRoot, 'scripts/fixtures/et-numbers-one-16k.wav'))
  try {
    // The WhatsApp tile opens the stored messaging home: a local fixture, so no real site is hit.
    const HOME = `${FIX}/page-three.html`
    await s.sw.evaluate((url) => chrome.storage.local.set({ messagingHome: url }), HOME)
    const first = s.ctx.pages()[0] ?? (await s.ctx.newPage())
    const ONE = `${FIX}/page-one.html`
    await first.goto(ONE)
    await first.bringToFront()
    await waitUntil(async () => s.permission.closedAfterMs !== null, 8000)
    await sleep(1200)
    const m = await measure(s.sw, ONE)
    if (!m) throw new Error('no strip')
    await first.mouse.click(m.mic.left + m.mic.width / 2, m.mic.top + m.mic.height / 2)
    const on = await waitUntil(async () => (await state(s.sw))?.listening === true, 3000)
    check('6. listening on in the first tab', on)

    // A new tab, as Chrome opens one: chrome://newtab, which the extension provides.
    const opened = s.ctx.waitForEvent('page')
    const tabId = await s.sw.evaluate(async () => (await chrome.tabs.create({ url: 'chrome://newtab/', active: true })).id ?? -1)
    const ntp = await opened
    await ntp.waitForLoadState('domcontentloaded')
    await ntp.bringToFront()
    await sleep(800)
    const reported = await s.sw.evaluate(async (id) => (await chrome.tabs.get(id)).url ?? '', tabId)
    const tiles = await ntp.evaluate(() =>
      [...document.querySelectorAll<HTMLAnchorElement>('.tile')].map((a) => ({ name: a.textContent ?? '', href: a.href, height: a.getBoundingClientRect().height, font: parseFloat(getComputedStyle(a).fontSize) })),
    )
    const strips = await ntp.evaluate(() => document.querySelectorAll('utle-strip').length)
    const shown = (await s.sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'utle-strip-measure' }).catch((e: unknown) => String(e)), tabId)) as Measure | string
    console.log(`      page url ${ntp.url()}; tab url ${reported}; ${tiles.length} tiles: ${tiles.map((t) => `${t.name} ${Math.round(t.height)}px`).join(', ')}`)
    console.log(`      first tile ${JSON.stringify(tiles[0])}; strip: ${typeof shown === 'string' ? shown : `mic=${shown.micState} heard=${JSON.stringify(shown.heard)} ${box(shown.strip)}`}`)
    check('6. chrome://newtab resolves to the extension page', ntp.url().includes('/newtab.html') || reported === 'chrome://newtab/', ntp.url())
    check('6. tiles render, WhatsApp first, all at least 96 px high', tiles.length >= 10 && tiles[0]?.name === 'WhatsApp' && tiles.every((t) => t.height >= 96), `${tiles.length} tiles, min ${Math.round(Math.min(...tiles.map((t) => t.height)))} px`)
    check('6. WhatsApp tile points at the stored messaging home', tiles[0]?.href === HOME, tiles[0]?.href ?? '')
    check('6. the strip is there once, listening as in the tab he came from', strips === 1 && typeof shown !== 'string' && shown.micState === 'listening', `hosts=${strips}`)
    await ntp.screenshot({ path: proof('inpage-newtab.png') })

    const labels = await waitUntil(async () => (await ntp.evaluate(() => document.querySelectorAll('utle-hints').length).catch(() => 0)) === 1, 20_000)
    check('6. "näita numbreid" numbers the tiles', labels)
    if (labels) await ntp.screenshot({ path: proof('inpage-newtab-numbers.png') })
    const went = await waitUntil(async () => (await s.sw.evaluate(async (id) => (await chrome.tabs.get(id)).url ?? '', tabId)) === HOME, 20_000)
    const now = await s.sw.evaluate(async (id) => (await chrome.tabs.get(id)).url ?? '', tabId)
    check('6. "üks" opens the first tile in the same tab', went, now)
    const st = await state(s.sw)
    const created = await offscreenCreated(s.sw)
    console.log(`      offscreen created ${created}x, microphone opened ${st.micOpens}x, line ${JSON.stringify(st.line)}`)
    check('6. the microphone was not re-opened (offscreen created once)', created === 1 && st.micOpens === 1)
  } finally {
    await close(s)
  }
}

// ---------- the speech model is not reachable ----------

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
    console.log(`      after 10 s: listening=${st?.listening} connects=${st?.connects} strip line=${JSON.stringify(shown?.line)} dot=${shown?.connection}`)
    // Round 9 (30.1): a local address says the local line, listening stays on, the dot is red.
    check('6. strip says the local server-down line, listening stays on', shown?.line === STRINGS.et.strip.serverDownLocal && st?.listening === true && shown?.connection === 'down', JSON.stringify(shown?.line))
    // Tries after 1, 2, 4 then every 5 s: four in the first 10 s.
    check('6. no retry storm: at most 5 connection attempts in 10 s', (st?.connects ?? 99) <= 5, `connects=${st?.connects}`)
    await page.screenshot({ path: proof('inpage-unreachable.png') })

    console.log(`      START THE DEV SERVER NOW (npx vite --port ${PORT} --strictPort); waiting up to 90 s`)
    const up = await waitUntil(serverUp, 90_000)
    if (!up) throw new Error('the dev server did not come up')
    // No toggle: the next try (at most 5 s later) finds it, once the model has loaded.
    const back = await waitUntil(async () => (await state(s.sw))?.line === STRINGS.et.strip.serverBack, 120_000)
    await sleep(3000)
    const now = await state(s.sw)
    const line = await measure(s.sw, url)
    const downs = s.trail.filter((e) => e.includes(JSON.stringify(STRINGS.et.strip.serverDownLocal))).length
    const backs = s.trail.filter((e) => e.includes(`line=${JSON.stringify(STRINGS.et.strip.serverBack)}`)).length
    console.log(`      back by itself: listening=${now?.listening} problem=${JSON.stringify(now?.problem)} micOpens=${now?.micOpens} strip line=${JSON.stringify(line?.line)} dot=${line?.connection}; down-line states seen ${downs}, back-line states seen ${backs}`)
    check('6. with the server back, "Server vastab jälle." once, microphone open, no toggle', back && backs === 1 && now?.listening === true && now.problem === '' && now.micOpens === 1 && line?.connection === 'connected')
    check('6. the down line was shown for one outage only (one run of trail states)', downs >= 1 && s.trail.findIndex((e) => e.includes(JSON.stringify(STRINGS.et.strip.serverDownLocal))) + downs - 1 === s.trail.map((e, i) => (e.includes(JSON.stringify(STRINGS.et.strip.serverDownLocal)) ? i : -1)).filter((i) => i >= 0).pop())
  } finally {
    await close(s)
  }
}

// ---------- only the owner, with the real models (round 10, ARCHITECTURE 31; issue #3 review 1) ----------
// A server of its own in this process (the same attachAsr as the dev server, the decode worker, the
// real recogniser, TitaNet and Silero), whose one profile is made here from the stand-in owner's
// reading of the real enrolment phrases (scripts/fixtures/enrol-set, SYNTHETIC "mari", made by
// scripts/enrol-set.ts) in a temporary UTLE_DATA_DIR. models/speaker/owner.json is never read or
// written. The clips under test (scripts/fixtures/speaker-set, the same voice) are not in the profile.

const SPEAKER_SET = join(repoRoot, 'scripts/fixtures/speaker-set')
const ENROL_SET = join(repoRoot, 'scripts/fixtures/enrol-set')
/** The twelve enrolment phrases of src/core/enrolPhrases.ts as the stand-in owner reads them. */
const ENROL_CLIPS = Array.from({ length: 12 }, (_, i) => `enrol-${String(i + 1).padStart(2, '0')}`)

/** A 16-bit PCM WAV as 100 ms float frames at 16 kHz. */
function wavFrames(path: string): Float32Array[] {
  const file = readFileSync(path)
  let at = 12
  let data: Buffer | null = null
  let rate = 0
  while (at + 8 <= file.length) {
    const id = file.toString('ascii', at, at + 4)
    const size = file.readUInt32LE(at + 4)
    if (id === 'fmt ') rate = file.readUInt32LE(at + 12)
    if (id === 'data') data = file.subarray(at + 8, at + 8 + size)
    at += 8 + size + (size % 2)
  }
  if (data === null || rate !== 16000) throw new Error(`${path}: not 16 kHz PCM (${rate})`)
  const n = Math.floor(data.length / 2)
  const frames: Float32Array[] = []
  for (let i = 0; i < n; i += 1600) {
    const frame = new Float32Array(Math.min(1600, n - i))
    for (let k = 0; k < frame.length; k += 1) frame[k] = data.readInt16LE((i + k) * 2) / 32768
    frames.push(frame)
  }
  return frames
}

interface Heard {
  type: string
  text?: string
  decision?: { segmentId: number; reason: string; verdict: string; score?: number; profileVersion: string; timings: { judgeMs: number; speechMs?: number } }
}

async function onlyOwnerReal(extensionDir: string): Promise<void> {
  console.log('\n== 7. only the owner with the real models (SYNTHETIC voices): enrolment over the wire with held-out verification, then held-out clips, other voices ==')
  const { createServer } = await import('node:http')
  const { WebSocket } = await import('ws')
  const { attachAsr } = await import('../../server/asr.ts')
  const { profilePath } = await import('../../server/speaker.ts')
  const dataDir = await mkdtemp(join(tmpdir(), 'utle-onlyowner-'))
  const profile = profilePath(repoRoot, { UTLE_DATA_DIR: dataDir }, '')
  const server = createServer((req, res) => {
    // The extension asks for the status; the model is "off" here (no /api/intent), speech is local.
    res.setHeader('access-control-allow-origin', '*')
    if ((req.url ?? '').startsWith('/api/status')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ intent: 'no_key', speech: { local: true, soniox: false } }))
      return
    }
    res.statusCode = 404
    res.end()
  })
  try {
    attachAsr(server, repoRoot, { profileFor: () => profile })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const asr = `ws://localhost:${port}/api/asr`

    // ---- the wire: what leaves the server for each clip, with only the owner on ----
    const ws = new WebSocket(asr)
    const heard: Heard[] = []
    ws.on('message', (data) => heard.push(JSON.parse(String(data)) as Heard))
    const ready = await waitUntil(async () => heard.some((m) => m.type === 'ready'), 60_000)
    check('7. the server with the real models is ready', ready)

    // ---- round 10 (31.7): enrolment through the new flow, over the wire: each clip one read phrase ----
    const streamClip = async (name: string, dir = ENROL_SET): Promise<void> => {
      for (const frame of wavFrames(join(dir, `${name}.wav`))) {
        ws.send(frame.buffer)
        await sleep(100)
      }
      for (let i = 0; i < 12; i += 1) {
        ws.send(new Float32Array(1600).buffer)
        await sleep(100)
      }
      ws.send(JSON.stringify({ type: 'flush' }))
      await sleep(600)
    }
    type Wire = Heard & { count?: number; problem?: string; ok?: boolean; phrases?: number; reason?: string; heldOut?: { count: number; scores: number[]; passed: boolean; threshold: number }; readiness?: { state: string; protected: boolean }; result?: string; score?: number; profileVersion?: string }
    ws.send(JSON.stringify({ type: 'speakerStatus' }))
    await waitUntil(async () => heard.some((m) => m.type === 'speakerStatus'), 5000)
    const before = (heard.filter((m) => m.type === 'speakerStatus').at(-1) as Wire | undefined)?.readiness
    check('7. before enrolment the readiness is no_profile, not protected', before?.state === 'no_profile' && before.protected === false, JSON.stringify(before))
    ws.send(JSON.stringify({ type: 'enrolScript', phrases: ENROL_CLIPS.length }))
    for (const name of ENROL_CLIPS) await streamClip(name)
    ws.send(JSON.stringify({ type: 'enrolFinish' }))
    await waitUntil(async () => heard.some((m) => m.type === 'enrolled'), 10_000)
    const perPhrase = (heard as Wire[]).filter((m) => m.type === 'enrolPhrase').map((m) => (m.problem ? `${m.count}:${m.problem}` : String(m.count)))
    const enrolled = heard.find((m) => m.type === 'enrolled') as Wire | undefined
    console.log(`      enrolment (SYNTHETIC owner "mari", ${ENROL_CLIPS.length} clips): per phrase ${JSON.stringify(perPhrase)}; enrolled ${JSON.stringify(enrolled)}`)
    check('7. enrolment over the wire: a profile from N-2 phrases, verified on the 2 held out', enrolled?.ok === true && enrolled.heldOut?.count === 2 && enrolled.heldOut.passed === true, JSON.stringify(enrolled))
    check('7. the profile is written under UTLE_DATA_DIR (profilePath), never models/speaker, format 2 with no audio', existsSync(profile) && profile.startsWith(dataDir) && (JSON.parse(readFileSync(profile, 'utf8')) as { format?: number }).format === 2 && readFileSync(profile).length < 8000, profile)
    await waitUntil(async () => heard.filter((m) => m.type === 'speakerStatus').length >= 2, 5000)
    const after = (heard.filter((m) => m.type === 'speakerStatus').at(-1) as Wire | undefined)?.readiness
    check('7. after enrolment the readiness is ready and protected', after?.state === 'ready' && after.protected === true, JSON.stringify(after))
    // "Proovi minu häält" on its own longer sentence (VERIFY_PHRASES[1], not in the profile): recognised, and no final for it.
    const testFrom = heard.length
    ws.send(JSON.stringify({ type: 'speakerTest' }))
    await streamClip('verify-2')
    await waitUntil(async () => heard.slice(testFrom).some((m) => m.type === 'speakerTested'), 8000)
    const tested = heard.slice(testFrom).find((m) => m.type === 'speakerTested') as Wire | undefined
    console.log(`      voice test verify-2 (SYNTHETIC): ${JSON.stringify(tested)}`)
    check('7. the voice test on the longer verify sentence says recognised, and sends no final', tested?.result === 'recognised' && !heard.slice(testFrom).some((m) => m.type === 'final' || m.type === 'partial'), JSON.stringify(tested))

    ws.send(JSON.stringify({ type: 'onlyOwner', on: true }))
    const announced = await waitUntil(async () => heard.some((m) => m.type === 'speakerSession'), 5000)
    const session = heard.find((m) => m.type === 'speakerSession') as Wire | undefined
    check('7. onlyOwner is answered with the session and the version of the profile enrolled here', announced && /^v1-[0-9a-f]{8}$/.test(session?.profileVersion ?? ''), JSON.stringify(session))

    const play = async (name: string): Promise<Heard[]> => {
      const from = heard.length
      for (const frame of wavFrames(join(SPEAKER_SET, `${name}.wav`))) {
        ws.send(frame.buffer)
        await sleep(100)
      }
      // 1.2 s of digital silence, then a flush (push-to-talk released). This is the padding that
      // reproduced the lost one-word utterance below (review 2): the recogniser's text went empty
      // at the endpoint after a partial.
      for (let i = 0; i < 12; i += 1) {
        ws.send(new Float32Array(1600).buffer)
        await sleep(100)
      }
      ws.send(JSON.stringify({ type: 'flush' }))
      await waitUntil(async () => heard.slice(from).some((m) => m.type === 'final' || m.type === 'rejected'), 8000)
      await sleep(500)
      return heard.slice(from)
    }
    const line = (name: string, got: Heard[]): Heard | undefined => {
      const outcome = got.find((m) => m.type === 'final' || m.type === 'rejected')
      const d = outcome?.decision
      console.log(`      ${name}: ${got.map((m) => m.type).join(' ')} -> ${outcome?.type ?? 'nothing'} ${d ? `segment=${d.segmentId} reason=${d.reason} score=${d.score ?? '-'} judgeMs=${d.timings.judgeMs} speechMs=${d.timings.speechMs ?? '-'}` : ''}${outcome?.text ? ` text=${JSON.stringify(outcome.text)}` : ''}`)
      return outcome
    }
    const worded = (got: Heard[]): Heard[] => got.filter((m) => typeof m.text === 'string' && m.text !== '')
    const ownerLong = (label: string, got: Heard[]): void => {
      const outcome = line(`owner-sentence-2 (held out, long${label})`, got)
      check(`7a. owner sentence${label}: a final with a verified_owner decision`, outcome?.type === 'final' && outcome.decision?.reason === 'verified_owner' && outcome.decision.verdict === 'owner')
      check(`7a. owner sentence${label}: its only words are the verified final, nothing stale in it`, worded(got).length === 1 && worded(got)[0] === outcome && !/\bjah\b/i.test(outcome?.text ?? ''), outcome?.text ?? '')
    }

    ownerLong('', await play('owner-sentence-2'))

    for (const other of ['other-vesta-1', 'other-kalev-1', 'other-mari-pitch20-1']) {
      const got = await play(other)
      const outcome = line(other, got)
      check(`7b. ${other}: rejected, no message with words (partials included)`, outcome?.type === 'rejected' && worded(got).length === 0, `${outcome?.decision?.reason ?? 'no decision'}`)
    }

    // Acceptance-matrix row: a stranger, then the owner's short word, in one session. Before review
    // 2 this "jah" showed activity and then nothing (on main with the mode off too: a partial, then
    // no final). The server now closes every signalled utterance.
    const short = await play('owner-jah-1')
    const shortOutcome = line('owner-jah-1 (held out, one word, right after the pitched voice)', short)
    check('7c. the owner\u2019s one word after another voice: closed with insufficient_audio or rejected_other, no words', shortOutcome?.type === 'rejected' && (shortOutcome.decision?.reason === 'insufficient_audio' || shortOutcome.decision?.reason === 'rejected_other') && worded(short).length === 0, shortOutcome?.decision?.reason ?? '')

    // The next owner long clip in the same session: verified and delivered, alone.
    ownerLong(', next in the same session', await play('owner-sentence-2'))
    check('7c. the short word is insufficient_audio, which makes the strip ask for the longer form', shortOutcome?.decision?.reason === 'insufficient_audio', shortOutcome?.decision?.reason ?? '')
    const segments = heard.flatMap((m) => (m.decision ? [m.decision.segmentId] : []))
    check('7. segments count up one per utterance, none skipped or repeated', segments.every((id, i) => id === i + 1), JSON.stringify(segments))

    ws.close()

    // ---- the extension: another voice into an armed chat box, only the owner on ----
    const s = await launch(extensionDir, join(SPEAKER_SET, 'other-vesta-1.wav'), true)
    try {
      await s.sw.evaluate((url) => chrome.storage.local.set({ asrUrl: url, onlyOwner: true }), asr)
      const page = s.ctx.pages()[0] ?? (await s.ctx.newPage())
      const CHAT = `${FIX}/chat.html`
      await page.goto(CHAT)
      await page.bringToFront()
      await page.waitForFunction(() => (window as unknown as { lexicalReady?: boolean }).lexicalReady === true)
      await waitUntil(async () => s.permission.closedAfterMs !== null, 8000)
      await sleep(1200)
      const m = await measure(s.sw, CHAT)
      if (!m) throw new Error('no strip')
      const boxes = new Set<string>()
      let sampling = true
      const sampler = (async () => {
        while (sampling) {
          boxes.add(await page.evaluate(() => (window as unknown as { lexicalText: () => string }).lexicalText()).catch(() => ''))
          await sleep(100)
        }
      })()
      await page.mouse.click(m.mic.left + m.mic.width / 2, m.mic.top + m.mic.height / 2)
      await page.mouse.move(640, 200)
      const foreignLine = async (): Promise<string> => s.sw.evaluate(async () => ((await chrome.storage.session.get('stripState')).stripState as { foreign?: string } | undefined)?.foreign ?? '')
      let seen = ''
      const foreign = await waitUntil(async () => {
        const f = await foreignLine()
        if (f !== '') seen = f
        return f !== ''
      }, 25_000)
      await sleep(3000)
      sampling = false
      await sampler
      const sent = await page.evaluate(() => (window as unknown as { sent: () => string[] }).sent())
      const url = s.ctx.pages().map((p) => p.url())
      const offscreen = await s.sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] }))[0]?.documentUrl ?? '')
      console.log(`      extension: offscreen ${offscreen.includes('onlyOwner=1') ? 'with' : 'WITHOUT'} onlyOwner=1; boxes seen ${JSON.stringify([...boxes])}; sent ${JSON.stringify(sent)}; strip foreign ${JSON.stringify(seen)}`)
      check('7b. extension: another voice is heard and dropped (the strip says so)', foreign && offscreen.includes('onlyOwner=1'))
      check('7b. extension: the chat box stayed empty the whole time, nothing sent, no navigation', [...boxes].every((b) => b.trim() === '') && sent.length === 0 && url.includes(CHAT))
    } finally {
      await close(s)
    }
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ---------- round 10 (ARCHITECTURE 32.4): addressed speech, two voices through the real models ----------
// SYNTHETIC voices (scripts/listen-set.ts, TartuNLP). The real server of this process (TalTech's
// recogniser, TitaNet, Silero), the real recogniser client (src/speech/local.ts) over a Node
// WebSocket, the real engine and the real src/core/inpage.ts, in wake mode with only the owner on:
// microphone, speaker gate, wake word, engine. No browser: the page is a stand-in that records commands.

const LISTEN_SET = join(repoRoot, 'scripts/fixtures/listen-set')

async function listenReal(): Promise<void> {
  console.log('\n== 8. addressed speech with the real models (SYNTHETIC voices): the room never reaches the bar, the owner’s mid-sentence "Ütle, mine youtube’i" runs once ==')
  const { createServer } = await import('node:http')
  const { attachAsr } = await import('../../server/asr.ts')
  const { createSpeakerGate, profilePath } = await import('../../server/speaker.ts')
  const { loadSpeakerModel } = await import('../../server/speakerModel.ts')
  const { createLocalRecognizer } = await import('../../src/speech/local.ts')
  const { createEngine, SEND_PROBE_BOX } = await import('../src/engine.ts')
  const core = await import('../../src/core/inpage.ts')
  const { pageIntentFrom } = await import('../../src/core/pageIntent.ts')
  const dataDir = await mkdtemp(join(tmpdir(), 'utle-listen-'))
  const profile = profilePath(repoRoot, { UTLE_DATA_DIR: dataDir }, '')
  const server = createServer((_req, res) => {
    res.statusCode = 404
    res.end()
  })
  try {
    const model = loadSpeakerModel(repoRoot)
    if (!model.ok) throw new Error(`speaker model: ${model.reason}`)
    const maker = createSpeakerGate(model.extractor, { profilePath: profile, modelHash: model.hash })
    const phrases = ENROL_CLIPS.map((name) => maker.phrase(wavFrames(join(ENROL_SET, `${name}.wav`)))).filter((p) => p !== null)
    check('8. the stand-in owner’s profile is made (the clips under test are not in it)', maker.enrolPhrases(phrases))
    attachAsr(server, repoRoot, { profileFor: () => profile })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    const asr = `ws://localhost:${typeof address === 'object' && address !== null ? address.port : 0}/api/asr`

    // The microphone: room voice, owner, room voice saying the wake word to someone else; 2.5 s of quiet after each.
    const quiet = (n: number): Float32Array[] => Array.from({ length: n }, () => new Float32Array(1600))
    const clips = ['room-shop', 'owner-wake', 'room-wake']
    const frames = clips.flatMap((name) => [...wavFrames(join(LISTEN_SET, `${name}.wav`)), ...quiet(25)])
    let fed = false
    const audio = {
      async start(onFrame: (samples: Float32Array<ArrayBuffer>) => void): Promise<void> {
        void (async () => {
          await sleep(1500)
          for (const frame of frames) {
            onFrame(new Float32Array(frame))
            await sleep(100)
          }
          fed = true
        })()
      },
      stop(): void {},
    }
    const heard: string[] = []
    const seen: string[] = []
    const ran: string[] = []
    let woke = false
    const engine = createEngine({
      logic: {
        ...core,
        pageIntentFrom,
        inpageStep: (session, utterance, box) => {
          // The engine probes the rules with SEND_PROBE_BOX to tell a send; only real steps count.
          if (box !== SEND_PROBE_BOX) seen.push(utterance)
          return core.inpageStep(session, utterance, box)
        },
      },
      lang: 'et',
      run: async (command) => {
        if (command.kind === 'readBox') return { ok: true, box: { present: false, text: '', armed: false } }
        if (command.kind === 'readPage') return { ok: true, page: { url: 'chrome://newtab/', title: 'Uus vaheleht', box: { present: false, text: '', armed: false }, items: [], media: null, hints: false } }
        ran.push(command.kind === 'goTo' ? `goTo ${command.url}` : command.kind)
        return { ok: true }
      },
      publish: (patch) => {
        if (patch.heard !== undefined && patch.heard !== '') heard.push(patch.heard)
        if (patch.wakeOpen === true) woke = true
      },
      recognizer: (handlers, isInstant, onUnavailable) =>
        createLocalRecognizer(handlers, isInstant, {
          onUnavailable,
          address: asr,
          onlyOwner: true,
          audio: () => audio,
          connect: (events) => {
            const ws = new WebSocket(asr)
            ws.binaryType = 'arraybuffer'
            ws.onmessage = (event) => events.message(event.data)
            ws.onclose = () => events.close()
            return ws
          },
        }),
      micBlocked: () => undefined,
      ask: () => Promise.resolve({ error: 'unreachable' }),
      tabs: () => Promise.resolve([]),
      status: () => Promise.resolve('no_key'),
      wakeWord: 'Ütle',
      onlyOwner: true,
    })
    engine.start()
    await waitUntil(async () => fed, 60_000)
    await sleep(3000)
    await engine.idle()
    engine.stop()
    console.log(`      strip heard ${JSON.stringify(heard)}; rules got ${JSON.stringify(seen)}; page commands ${JSON.stringify(ran)}`)
    const room = /poodi|tulen homme|talle/i
    check('8. the second voice’s sentences never reach the bar (no strip words from them)', !heard.some((h) => room.test(h)), JSON.stringify(heard))
    check('8. the owner’s mid-sentence wake word woke ACTIVE', woke)
    check('8. exactly one utterance reached the rules: the words after the word ("mine …"), the lead-in "No nii" dropped', seen.length === 1 && /^mine\b/i.test(seen[0] ?? '') && !/nii/i.test(seen[0] ?? ''), JSON.stringify(seen))
    check('8. the page got one command, once: goTo youtube.com', ran.length === 1 && /youtube\.com/.test(ran[0] ?? ''), JSON.stringify(ran))
    check('8. the other voice’s "Ütle talle, …" ran nothing (the gate rejects before the wake word is looked for)', !seen.some((s) => room.test(s)))
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ---------- round 10 (#2, ARCHITECTURE 35): the wake word heard in the audio, the real models ----------
// SYNTHETIC voices (scripts/kws-set.ts --voice, TartuNLP: "mari" the stand-in owner, "kalev" a
// stranger). The real server of this process (TalTech's recogniser, its keyword spotter over the same
// model, TitaNet, Silero), the real recogniser client (src/speech/local.ts, spotter on) over a Node
// WebSocket, the real engine and the real src/core/inpage.ts in wake mode. No browser: the page is a
// stand-in that records commands. Part A: the behaviour matrix of #2 with only-owner off. Part B:
// only-owner on: a stranger's wake wakes nothing that acts.

const WAKE_SET = join(repoRoot, 'scripts/fixtures/wake-set')

interface WakeTrace {
  /** The clip being played (or in the quiet after it) when each thing happened. */
  states: Array<[string, 'ACTIVE' | 'PASSIVE']>
  seen: Array<[string, string]>
  ran: Array<[string, string]>
  wakes: Array<[string, number]>
  /** What the engine asked the model (the rules did not know it). */
  asked: Array<[string, string]>
  /** The largest lag the server reported (ms): above a second, audio was dropped and the clips blur. */
  maxLag: number
}

async function wakeSession(asr: string, clips: readonly string[], onlyOwner: boolean): Promise<WakeTrace> {
  const { WebSocket } = await import('ws')
  const { createLocalRecognizer } = await import('../../src/speech/local.ts')
  const { createEngine, SEND_PROBE_BOX } = await import('../src/engine.ts')
  const core = await import('../../src/core/inpage.ts')
  const { pageIntentFrom } = await import('../../src/core/pageIntent.ts')
  const quiet = (n: number): Float32Array[] => Array.from({ length: n }, () => new Float32Array(1600))
  const trace: WakeTrace = { states: [], seen: [], ran: [], wakes: [], asked: [], maxLag: 0 }
  let playing = '(start)'
  let fed = false
  const audio = {
    async start(onFrame: (samples: Float32Array<ArrayBuffer>) => void): Promise<void> {
      void (async () => {
        await sleep(1500)
        for (const name of clips) {
          playing = name
          // 3.5 s of quiet after each clip: its final, and the state change, land before the next one.
          for (const frame of [...wavFrames(join(WAKE_SET, `${name}.wav`)), ...quiet(35)]) {
            onFrame(new Float32Array(frame))
            await sleep(100)
          }
        }
        fed = true
      })()
    },
    stop(): void {},
  }
  const engine = createEngine({
    logic: {
      ...core,
      pageIntentFrom,
      inpageStep: (session, utterance, box) => {
        if (box !== SEND_PROBE_BOX) trace.seen.push([playing, utterance])
        return core.inpageStep(session, utterance, box)
      },
    },
    lang: 'et',
    run: async (command) => {
      if (command.kind === 'readBox') return { ok: true, box: { present: false, text: '', armed: false } }
      if (command.kind === 'readPage') return { ok: true, page: { url: 'chrome://newtab/', title: 'Uus vaheleht', box: { present: false, text: '', armed: false }, items: [], media: null, hints: false } }
      trace.ran.push([playing, command.kind === 'goTo' ? `goTo ${command.url}` : command.kind])
      return { ok: true }
    },
    publish: (patch) => {
      if (patch.wakeOpen !== undefined) trace.states.push([playing, patch.wakeOpen ? 'ACTIVE' : 'PASSIVE'])
    },
    recognizer: (handlers, isInstant, onUnavailable) =>
      createLocalRecognizer(handlers, isInstant, {
        onUnavailable,
        address: asr,
        ...(onlyOwner ? { onlyOwner: true } : {}),
        spotter: true,
        audio: () => audio,
        connect: (events) => {
          const ws = new WebSocket(asr)
          ws.binaryType = 'arraybuffer'
          ws.onmessage = (event) => {
            // The wire's wake events, for the report (the recogniser takes them itself).
            if (typeof event.data === 'string' && event.data.includes('"type":"wake"')) {
              const w = JSON.parse(event.data) as { endMs: number }
              trace.wakes.push([playing, w.endMs])
            }
            if (typeof event.data === 'string' && event.data.includes('"type":"lag"')) trace.maxLag = Math.max(trace.maxLag, (JSON.parse(event.data) as { ms: number }).ms)
            events.message(event.data)
          }
          ws.onclose = () => events.close()
          return ws
        },
      }),
    micBlocked: () => undefined,
    // No model offline: what the rules do not know is recorded and answered unreachable.
    ask: (request) => {
      trace.asked.push([playing, request.utterance])
      return Promise.resolve({ error: 'unreachable' })
    },
    tabs: () => Promise.resolve([]),
    status: () => Promise.resolve('no_key'),
    wakeWord: 'Ütle',
    ...(onlyOwner ? { onlyOwner: true } : {}),
  })
  engine.start()
  await waitUntil(async () => fed, 180_000)
  await sleep(2000)
  await engine.idle()
  engine.stop()
  return trace
}

async function wakeReal(): Promise<void> {
  console.log('\n== 9. the wake word heard in the audio, the real models (SYNTHETIC voices): the keyword spotter beside the recogniser, the matrix of #2, only-owner ==')
  const { createServer } = await import('node:http')
  const { attachAsr } = await import('../../server/asr.ts')
  const { createSpeakerGate, profilePath } = await import('../../server/speaker.ts')
  const { loadSpeakerModel } = await import('../../server/speakerModel.ts')
  const dataDir = await mkdtemp(join(tmpdir(), 'utle-wake-'))
  const profile = profilePath(repoRoot, { UTLE_DATA_DIR: dataDir }, '')
  const server = createServer((_req, res) => {
    res.statusCode = 404
    res.end()
  })
  try {
    const model = loadSpeakerModel(repoRoot)
    if (!model.ok) throw new Error(`speaker model: ${model.reason}`)
    const maker = createSpeakerGate(model.extractor, { profilePath: profile, modelHash: model.hash })
    const phrases = ENROL_CLIPS.map((name) => maker.phrase(wavFrames(join(ENROL_SET, `${name}.wav`)))).filter((p) => p !== null)
    check('9. the stand-in owner’s profile is made (the clips under test are not in it)', maker.enrolPhrases(phrases))
    attachAsr(server, repoRoot, { profileFor: () => profile })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    const asr = `ws://localhost:${typeof address === 'object' && address !== null ? address.port : 0}/api/asr`

    // Part A: only-owner off.
    const a = await wakeSession(asr, ['owner-utlen', 'owner-literal', 'owner-bare', 'owner-bare', 'owner-lead-youtube', 'owner-literal', 'owner-bare', 'owner-pause-gmail'], false)
    console.log(`      A states ${JSON.stringify(a.states)}`)
    console.log(`      A wakes on the wire (clip, endMs) ${JSON.stringify(a.wakes)}`)
    console.log(`      A rules got ${JSON.stringify(a.seen)}; asked ${JSON.stringify(a.asked)}; page commands ${JSON.stringify(a.ran)}; max lag ${a.maxLag} ms`)
    const statesOf = (t: WakeTrace, clip: string): string[] => t.states.filter(([c]) => c === clip).map(([, s]) => s)
    // The clips repeat; the trace keeps the order, so walk it.
    const order = a.states.map(([clip, s]) => `${clip}:${s}`)
    check('9a. PASSIVE "Ma ütlen sulle homme." wakes nothing (no state change, nothing reaches the rules)', statesOf(a, 'owner-utlen').length === 0 && !a.seen.some(([c]) => c === 'owner-utlen'), JSON.stringify(order))
    check('9a. PASSIVE "Kirjuta siia sõna ütle." (literal) wakes nothing', order[0] === 'owner-bare:ACTIVE', JSON.stringify(order))
    check('9a. PASSIVE "Ütle." -> ACTIVE, then ACTIVE "Ütle." -> PASSIVE (no text, no action)', order[0] === 'owner-bare:ACTIVE' && order[1] === 'owner-bare:PASSIVE' && !a.seen.some(([c]) => c === 'owner-bare'), JSON.stringify(order))
    const youtube = a.seen.filter(([c]) => c === 'owner-lead-youtube').map(([, u]) => u)
    check('9a. "No nii, Ütle, ava YouTube." -> ACTIVE, only "ava YouTube" reaches the rules, once (the lead-in dropped)', order[2] === 'owner-lead-youtube:ACTIVE' && youtube.length === 1 && /^ava\b/i.test(youtube[0] ?? '') && !/nii/i.test(youtube[0] ?? ''), JSON.stringify(youtube))
    // TalTech's model writes "YouTube" as "jõudube" (scripts/kws-eval.ts --tokens): the rules do not know it, so it goes to the model (offline here) once.
    check('9a. ... and nothing of it ran twice: one rules step, at most one ask, no page command from the lead-in', a.asked.filter(([c]) => c === 'owner-lead-youtube').length <= 1 && !a.ran.some(([c, r]) => c === 'owner-lead-youtube' && !/youtube\.com/.test(r)), `${JSON.stringify(a.asked)} ${JSON.stringify(a.ran)}`)
    const literal = a.seen.filter(([c]) => c === 'owner-literal').map(([, u]) => u)
    check('9a. ACTIVE "Kirjuta siia sõna ütle." stays his text (the word kept) and does not toggle', literal.length === 1 && /ütle/i.test(literal[0] ?? '') && order[3] === 'owner-bare:PASSIVE', `${JSON.stringify(literal)} ${JSON.stringify(order)}`)
    check('9a. "Ütle" + a pause + "ava Gmail" -> ACTIVE and goTo mail.google.com without a second wake', order[4] === 'owner-pause-gmail:ACTIVE' && a.ran.filter(([c, r]) => c === 'owner-pause-gmail' && /mail\.google\.com/.test(r)).length === 1, `${JSON.stringify(order)} ${JSON.stringify(a.ran)}`)
    check('9a. every wake on the wire came with a clip that says the word (none for "Ma ütlen sulle homme.")', !a.wakes.some(([c]) => c === 'owner-utlen'), JSON.stringify(a.wakes))

    // Part B: only-owner on. The stranger says the wake word with a command; then the owner wakes; then the stranger commands.
    const b = await wakeSession(asr, ['stranger-youtube', 'owner-scroll', 'owner-lead-youtube', 'stranger-scroll'], true)
    console.log(`      B states ${JSON.stringify(b.states)}`)
    console.log(`      B wakes on the wire ${JSON.stringify(b.wakes)}`)
    console.log(`      B rules got ${JSON.stringify(b.seen)}; asked ${JSON.stringify(b.asked)}; page commands ${JSON.stringify(b.ran)}; max lag ${b.maxLag} ms`)
    const fromStranger = b.ran.filter(([c]) => c.startsWith('stranger-')).length + b.seen.filter(([c]) => c.startsWith('stranger-')).length + b.asked.filter(([c]) => c.startsWith('stranger-')).length
    check('9b. only-owner: the stranger’s "Ütle, ava YouTube." wakes nothing that acts (no state change, no rules, no command)', statesOf(b, 'stranger-youtube').length === 0 && fromStranger === 0, `${JSON.stringify(b.states)} ${JSON.stringify(b.ran)}`)
    check('9b. only-owner: the owner’s "Keri alla." after it is still PASSIVE (the stranger’s wake opened nothing)', !b.ran.some(([c]) => c === 'owner-scroll'), JSON.stringify(b.ran))
    const ownerWords = b.seen.filter(([c]) => c === 'owner-lead-youtube').map(([, u]) => u)
    check('9b. only-owner: the owner’s "No nii, ütle, ava YouTube." wakes ACTIVE and only "ava …" reaches the rules, once', statesOf(b, 'owner-lead-youtube').includes('ACTIVE') && ownerWords.length === 1 && /^ava\b/i.test(ownerWords[0] ?? '') && !/nii/i.test(ownerWords[0] ?? ''), JSON.stringify(ownerWords))
    check('9b. only-owner: the stranger’s "Keri alla." in ACTIVE runs nothing: 0 commands from the stranger', fromStranger === 0, JSON.stringify(b.ran))
  } finally {
    server.close()
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ---------- round 10 (#2, ARCHITECTURE 35.5): wake mode in Chromium with the keyword spotter ----------
// SYNTHETIC voice ("vesta", scripts/kws-set.ts --chrome). The extension as shipped (with UTLE_REAL=1
// the real src/core/inpage.ts), its offscreen document in wake mode with the word "Ütle", the fake
// microphone playing one file: "Ma ütlen sulle homme.", "Ütle.", "Ütle.", "Ütle, ava YouTube.", each
// its own utterance. A server of this process over the real models (the recogniser, the spotter the
// worker loads at its start, the speech detector); only the owner off. Its messages are tapped where
// it sends them (wake and spotter events, finals). YouTube is a stand-in page: no real site is hit.

async function wakeChrome(extensionDir: string): Promise<void> {
  console.log('\n== 10. wake mode in Chromium with the keyword spotter (SYNTHETIC voice vesta, fake microphone: wake-set/chrome-sequence.wav): the relative wakes nothing, "Ütle." ACTIVE, "Ütle." PASSIVE, "Ütle, ava YouTube." opens the page once ==')
  const { createServer } = await import('node:http')
  const { WebSocket } = await import('ws')
  const { attachAsr } = await import('../../server/asr.ts')
  const wav = join(WAKE_SET, 'chrome-sequence.wav')
  // The four parts: speech spans joined across pauses under 2 s (a comma is one part).
  const parts: Array<[number, number]> = []
  for (const [a, b] of speechSpans(wav)) {
    const last = parts[parts.length - 1]
    if (last !== undefined && a - last[1] < 2000) last[1] = b
    else parts.push([a, b])
  }
  console.log(`      parts in the recording (ms from its start): ${parts.map(([a, b]) => `${Math.round(a)}-${Math.round(b)}`).join(', ')}`)
  check('10. the recording has its four parts', parts.length === 4, String(parts.length))

  // The server's messages as it sends them (no words go with a wake; the finals are the test's own synthetic clip).
  const wire: Array<{ t: number; type: string; on?: boolean; segment?: number; text?: string }> = []
  const proto = WebSocket.prototype as unknown as { send: (...args: unknown[]) => unknown }
  const original = proto.send
  proto.send = function tapped(this: unknown, ...args: unknown[]): unknown {
    const data = args[0]
    if (typeof data === 'string' && /"type":"(wake|spotter|final)"/.test(data)) {
      const m = JSON.parse(data) as { type: string; on?: boolean; segment?: number; text?: string }
      wire.push({ t: Date.now(), type: m.type, ...(m.on === undefined ? {} : { on: m.on }), ...(m.segment === undefined ? {} : { segment: m.segment }), ...(m.text === undefined ? {} : { text: m.text }) })
    }
    return Reflect.apply(original, this, args)
  }
  const dataDir = await mkdtemp(join(tmpdir(), 'utle-wakechrome-'))
  const server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*')
    if ((req.url ?? '').startsWith('/api/status')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ intent: 'no_key', speech: { local: true, soniox: false } }))
      return
    }
    res.statusCode = 404
    res.end()
  })
  try {
    // No profile: only the owner is off, and nothing of models/speaker is read.
    attachAsr(server, repoRoot, { profileFor: () => join(dataDir, 'no-profile.json') })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    const asr = `ws://localhost:${typeof address === 'object' && address !== null ? address.port : 0}/api/asr`
    // The model (and the spotter with it) loads before the microphone opens.
    const probe = new WebSocket(asr)
    let ready = false
    probe.on('message', (data) => {
      if (String(data).includes('"type":"ready"')) ready = true
    })
    check('10. the server with the real models and the spotter is ready', await waitUntil(async () => ready, 90_000))
    probe.close()

    const s = await launch(extensionDir, wav)
    try {
      let youtube = 0
      await s.ctx.route('https://www.youtube.com/**', async (route) => {
        if (route.request().isNavigationRequest()) youtube += 1
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>YouTube (stand-in)</title><h1 style="font:32px sans-serif;margin:40px">YouTube stand-in page</h1>' })
      })
      const page = s.ctx.pages()[0] ?? (await s.ctx.newPage())
      const ONE = `${FIX}/page-one.html`
      await page.goto(ONE)
      await page.bringToFront()
      await waitUntil(async () => s.permission.closedAfterMs !== null, 8000)
      await sleep(1200)
      // Wake mode: listening starts by itself (background.ts startIfWake), the offscreen document asks for the spotter.
      const wiredFrom = wire.length
      await s.sw.evaluate((url) => chrome.storage.local.set({ asrUrl: url, listenMode: 'wake', wakeWord: 'Ütle' }), asr)
      const opened = await waitUntil(async () => ((await state(s.sw))?.micOpenedAt ?? 0) > 0, 15_000)
      check('10. wake mode set: the microphone opened by itself', opened)
      const t0 = (await state(s.sw))?.micOpenedAt ?? Date.now()
      const at = (ms: number): number => t0 + ms
      const [relPart = [0, 0], firstPart = [0, 0], secondPart = [0, 0], youtubePart = [0, 0]] = parts

      // Every 150 ms: ACTIVE or not, the strip's words and line, the tab's address.
      const samples: Array<{ t: number; open: boolean; heard: string; line: string; url: string }> = []
      const shots: Record<string, string> = {}
      let sampling = true
      const sampler = (async () => {
        while (sampling) {
          const t = Date.now()
          const st = (await s.sw.evaluate(async () => (await chrome.storage.session.get('stripState')).stripState as { wakeOpen?: boolean; heard?: string; line?: string } | undefined).catch(() => undefined)) ?? {}
          const tab = s.ctx.pages().find((p) => p.url().includes('youtube.com')) ?? page
          samples.push({ t, open: st.wakeOpen === true, heard: st.heard ?? '', line: st.line ?? '', url: tab.url() })
          const shoot = async (name: string): Promise<void> => {
            if (shots[name] !== undefined) return
            shots[name] = proof(name)
            await tab.screenshot({ path: proof(name) }).catch(() => undefined)
          }
          // PASSIVE after the relative (just before "Ütle."), ACTIVE after the first "Ütle.", PASSIVE after the second, the page after the last.
          if (t >= at(firstPart[0]) - 300) await shoot('wake-chrome-1-relative-passive.png')
          if (t >= at(firstPart[1]) && t < at(secondPart[0]) && st.wakeOpen === true) await shoot('wake-chrome-2-active.png')
          if (t >= at(secondPart[1]) + 2500 && t < at(youtubePart[0])) await shoot('wake-chrome-3-passive-again.png')
          if (tab.url().includes('youtube.com') && t >= at(youtubePart[1]) + 2500) await shoot('wake-chrome-4-youtube.png')
          await sleep(Math.max(0, 150 - (Date.now() - t)))
        }
      })()
      await sleep(Math.max(0, at(youtubePart[1]) + 7000 - Date.now()))
      sampling = false
      await sampler

      const within = (from: number, to: number): typeof samples => samples.filter((x) => x.t >= at(from) && x.t < at(to))
      const wired = wire.slice(wiredFrom).map((w) => ({ ...w, ms: w.t - t0 }))
      console.log(`      the wire (ms from the microphone opening): ${JSON.stringify(wired.map((w) => (w.type === 'final' ? `${w.ms} final${w.segment === undefined ? '' : `#${w.segment}`} ${JSON.stringify(w.text)}` : w.type === 'wake' ? `${w.ms} wake#${w.segment}` : `${w.ms} spotter ${w.on}`)))}`)
      let previous = ''
      for (const x of samples) {
        const entry = `${x.open ? 'ACTIVE ' : 'PASSIVE'} heard=${JSON.stringify(x.heard)} line=${JSON.stringify(x.line)} url=${x.url}`
        if (entry !== previous) console.log(`        ${String(x.t - t0).padStart(6)} ms  ${entry}`)
        previous = entry
      }
      const wakesIn = (from: number, to: number): number => wired.filter((w) => w.type === 'wake' && w.ms >= from && w.ms < to).length
      check('10. the server ran the spotter for this connection (spotter on: true)', wired.some((w) => w.type === 'spotter' && w.on === true), JSON.stringify(wired.filter((w) => w.type === 'spotter')))
      const rel = within(relPart[0], firstPart[0])
      check('10. PASSIVE "Ma ütlen sulle homme." shows nothing: never ACTIVE, no words on the strip, no wake on the wire', rel.length > 0 && rel.every((x) => !x.open && !/ütlen|homme/i.test(x.heard)) && wakesIn(relPart[0], firstPart[0]) === 0, `${rel.length} samples, wakes ${wakesIn(relPart[0], firstPart[0])}`)
      const first = within(firstPart[0], secondPart[0])
      check('10. PASSIVE "Ütle." shows ACTIVE on the strip, with a wake on the wire', first.some((x) => x.open) && wakesIn(firstPart[0], secondPart[0]) >= 1, `wakes ${wakesIn(firstPart[0], secondPart[0])}`)
      const second = within(secondPart[1] + 2500, youtubePart[0])
      check('10. ACTIVE "Ütle." again toggles back to PASSIVE', second.length > 0 && second.every((x) => !x.open), `${second.length} samples`)
      const last = within(youtubePart[0], youtubePart[1] + 7000)
      check('10. "Ütle, ava YouTube." from PASSIVE wakes (a wake on the wire) and opens the page once', wakesIn(youtubePart[0], youtubePart[1] + 7000) >= 1 && youtube === 1 && last.some((x) => x.url.includes('youtube.com')), `wakes ${wakesIn(youtubePart[0], youtubePart[1] + 7000)}, YouTube navigations ${youtube}`)
      check('10. nothing else opened: one YouTube navigation over the whole run, the stand-in page in the tab', youtube === 1 && s.ctx.pages().filter((p) => p.url().includes('youtube.com')).length === 1, `${youtube}; ${JSON.stringify(s.ctx.pages().map((p) => p.url()))}`)
      console.log(`      screenshots: ${Object.values(shots).join(', ')}`)
    } finally {
      await close(s)
    }
  } finally {
    proto.send = original
    server.close()
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function main(): Promise<void> {
  await mkdir(join(repoRoot, 'docs/proof'), { recursive: true })
  const mode = process.argv[2]
  if (mode === 'baseline') {
    const dir = await buildExtension({ outRoot: join(here, '.baseline'), offscreenEntry: join(here, 'standin-offscreen-baseline.ts') })
    if (!(await serverUp())) throw new Error(`The dev server is not running on ${BASE}.`)
    await dictateAndSend(dir, true)
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
    process.exitCode = failures === 0 ? 0 : 1
    return
  }
  // UTLE_REAL=1 builds with the real src/core/inpage.ts instead of the stand-in.
  const real = process.env.UTLE_REAL === '1'
  const extensionDir = await buildExtension({ outRoot: join(here, '.standin'), ...(real ? {} : { offscreenEntry: join(here, 'standin-offscreen.ts') }) })
  if (real) console.log('(built with the real src/core/inpage.ts)')
  if (mode === 'down') {
    await serverDown(extensionDir)
  } else {
    if (!(await serverUp())) throw new Error(`The dev server is not running on ${BASE}. Start: npx vite --port ${PORT} --strictPort`)
    const only = process.env.UTLE_ONLY
    if (!only || only === 'dictate') await dictateAndSend(extensionDir, false)
    if (!only || only === 'scroll') await scrollAndTab(extensionDir)
    if (!only || only === 'newtab') await newTabPage(extensionDir)
    // Round 10: only the owner, with a server of this process over the real models.
    if (!only || only === 'onlyowner') await onlyOwnerReal(extensionDir)
    // Round 10 (32.4): addressed speech, two synthetic voices through the real models, no browser.
    if (!only || only === 'listen') await listenReal()
    // Round 10 (35): the wake word heard in the audio, the keyword spotter, through the real models, no browser.
    if (!only || only === 'wake') await wakeReal()
    // Round 10 (#2, 35.5): wake mode in Chromium with the spotter, a server of this process over the real models.
    if (!only || only === 'wakechrome') await wakeChrome(extensionDir)
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
  process.exitCode = failures === 0 ? 0 : 1
  // The decode worker of section 7's server keeps the process alive.
  process.exit()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

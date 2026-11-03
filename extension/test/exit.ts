// Round 10 prompt 6 (lane EXIT): the round's exit test (#9) rehearsed end to end, with no person.
//
// A newcomer, the helper's sheet, two others talking: install, enrol, "Ütle, mine youtube'i ja otsi
// lastelaulud", the result, one message dictated and sent; under ten minutes, and the bar never shows
// a sentence the others said. Here:
// - Playwright's Chromium in a fresh profile loads the extension built with the real src/core/inpage.ts
//   (as voice.ts with UTLE_REAL=1); the install opens the real welcome page, which is walked through
//   (microphone, server, the twelve phrases, the voice test, only the owner), then the real settings
//   page for wake mode.
// - The server is this process's: the real API of server/app.ts (TalTech's recogniser, TitaNet,
//   Silero, /api/intent through the model of UTLE_MODEL) with the voice profile in a temporary
//   UTLE_DATA_DIR, never models/speaker.
// - The microphone is a stand-in at the socket: the extension's own frames keep the clock (the
//   offscreen document captures Chromium's fake device in real time), and a bridge in front of the
//   server swaps their samples for the room: SYNTHETIC voices (scripts/exit-set.ts, the owner "mari" of
//   scripts/fixtures/enrol-set, the room "kalev" and "vesta"), mixed as scenes, the owner reacting to
//   what is on the screen as a person would.
// - www.youtube.com is a stand-in trimmed from the real page (fixtures/youtube.html, its consent layer
//   first); web.whatsapp.com is the WhatsApp stand-in of run.ts (fixtures/whatsapp.html).
//
//   npx tsx extension/test/exit.ts        (UTLE_REAL=1 is implied; the model call needs ANTHROPIC_API_KEY)
//   UTLE_EXIT_PORT=5186                    the bridge's port (the extension's server address)
//   UTLE_EXIT_OVERLAP_MS=800               the second room voice over the end of his command: her file has
//                                          800 ms of silence first, so her speech starts OVERLAP - 500 ms
//                                          before his last word (800: 300 ms over him; -1500: 2000 ms after)
//   UTLE_EXIT_OUT=artifacts/exit/run-1     where the timeline and the screenshots go

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { BrowserContext, Page, Worker } from 'playwright'
import { WebSocket, WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import { buildExtension } from '../../scripts/ext.ts'
import { STRINGS } from '../../src/core/strings.ts'
import { createUtleServer } from '../../server/app.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const PORT = Number(process.env.UTLE_EXIT_PORT ?? '5186')
const OVERLAP_MS = Number(process.env.UTLE_EXIT_OVERLAP_MS ?? '800')
const OUT = resolve(repoRoot, process.env.UTLE_EXIT_OUT ?? `artifacts/exit/run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`)
const EXIT_SET = join(repoRoot, 'scripts/fixtures/exit-set')
const ENROL_SET = join(repoRoot, 'scripts/fixtures/enrol-set')
const FIXTURES = join(here, 'fixtures')
const RATE = 16000
/** The exit test's own limit (#9). */
const TEN_MINUTES_MS = 10 * 60_000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
let t0 = Date.now()
const at = (): number => Date.now() - t0
const say = (line: string): void => console.log(`[${String(at()).padStart(6)} ms] ${line}`)

let failures = 0
function check(label: string, pass: boolean, detail = ''): boolean {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(70)} ${detail}`)
  return pass
}

async function waitUntil(test: () => Promise<boolean>, timeoutMs: number, every = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await test().catch(() => false)) return true
    await sleep(every)
  }
  return test().catch(() => false)
}

// ---------- the voices ----------

interface Clip {
  name: string
  speaker: string
  room: boolean
  text: string
}
const CLIPS: Clip[] = JSON.parse(readFileSync(join(EXIT_SET, 'exit-set.json'), 'utf8')) as Clip[]
const clip = (name: string): Clip => {
  const c = CLIPS.find((x) => x.name === name)
  if (!c) throw new Error(`no clip ${name}`)
  return c
}

/** A 16-bit PCM WAV at 16 kHz as samples. */
function wavSamples(path: string): Float32Array {
  const file = readFileSync(path)
  let pos = 12
  let data: Buffer | null = null
  let rate = 0
  while (pos + 8 <= file.length) {
    const id = file.toString('ascii', pos, pos + 4)
    const size = file.readUInt32LE(pos + 4)
    if (id === 'fmt ') rate = file.readUInt32LE(pos + 12)
    if (id === 'data') data = file.subarray(pos + 8, pos + 8 + size)
    pos += 8 + size + (size % 2)
  }
  if (data === null || rate !== RATE) throw new Error(`${path}: not 16 kHz PCM (${rate})`)
  const out = new Float32Array(Math.floor(data.length / 2))
  for (let i = 0; i < out.length; i += 1) out[i] = data.readInt16LE(i * 2) / 32768
  return out
}

/** Where the speech is in a clip (ms): the first and last 20 ms frame above -40 dBFS. */
function speechOf(samples: Float32Array): [number, number] {
  const frame = 320
  let first = -1
  let last = -1
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let sum = 0
    for (let k = 0; k < frame; k += 1) sum += (samples[i + k] ?? 0) ** 2
    if (Math.sqrt(sum / frame) < 0.01) continue
    if (first < 0) first = i
    last = i + frame
  }
  return [Math.round(first / 16), Math.round(last / 16)]
}

interface Part {
  /** A clip of exit-set (or enrol-set with dir). */
  name: string
  /** Start in the scene, ms. */
  at: number
  gain?: number
  dir?: string
}
interface Scene {
  samples: Float32Array
  marks: Array<{ sample: number; label: string }>
  /** Per part: [start, end] of its speech in the scene, ms. */
  spans: Array<{ name: string; from: number; to: number }>
}

function scene(parts: Part[]): Scene {
  const loaded = parts.map((p) => ({ part: p, samples: wavSamples(join(p.dir ?? EXIT_SET, `${p.name}.wav`)) }))
  const length = Math.max(...loaded.map(({ part, samples }) => Math.round((part.at * RATE) / 1000) + samples.length))
  const samples = new Float32Array(length)
  const marks: Scene['marks'] = []
  const spans: Scene['spans'] = []
  for (const { part, samples: s } of loaded) {
    const offset = Math.round((part.at * RATE) / 1000)
    const gain = part.gain ?? 1
    for (let i = 0; i < s.length; i += 1) samples[offset + i] = (samples[offset + i] ?? 0) + (s[i] ?? 0) * gain
    const [from, to] = speechOf(s)
    marks.push({ sample: offset + from * 16, label: `${part.name} speech starts` }, { sample: offset + to * 16, label: `${part.name} speech ends` })
    spans.push({ name: part.name, from: part.at + from, to: part.at + to })
  }
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.max(-1, Math.min(1, samples[i] ?? 0))
  return { samples, marks, spans }
}

/**
 * The room: what the microphone hears. Scenes are queued and taken frame by frame as the extension
 * sends its own frames (its clock); between scenes, a noise floor at about -66 dBFS.
 */
function createRoom() {
  const queue: Array<{ samples: Float32Array; marks: Scene['marks']; done: () => void }> = []
  let offset = 0
  let seed = 7
  let brown = 0
  const heardAt = new Map<string, number>()
  const floor = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    brown = 0.97 * brown + (seed / 2147483648 - 0.5)
    return brown * 0.0005
  }
  return {
    heardAt,
    /** Queues the scene; resolves once it has been heard, or after its length plus 30 s if the microphone never took it (then it is dropped). */
    play(s: Scene): Promise<void> {
      return new Promise((done) => {
        const item = { samples: s.samples, marks: [...s.marks], done: () => undefined as void }
        const timer = setTimeout(
          () => {
            const i = queue.indexOf(item)
            if (i >= 0) {
              console.log(`      ROOM: a scene of ${(s.samples.length / RATE).toFixed(1)} s was not taken by the microphone in time; dropped`)
              queue.splice(i, 1)
              if (i === 0) offset = 0
            }
            done()
          },
          (s.samples.length / RATE) * 1000 + 30_000,
        )
        item.done = () => {
          clearTimeout(timer)
          done()
        }
        queue.push(item)
      })
    },
    playing: (): boolean => queue.length > 0,
    take(n: number): Float32Array {
      const out = new Float32Array(n)
      for (let i = 0; i < n; i += 1) {
        const head = queue[0]
        if (!head) {
          out[i] = floor()
          continue
        }
        out[i] = (head.samples[offset] ?? 0) + floor()
        offset += 1
        while (head.marks.length > 0 && (head.marks[0]?.sample ?? Infinity) <= offset) {
          const mark = head.marks.shift()
          if (mark) heardAt.set(mark.label, Date.now())
        }
        if (offset >= head.samples.length) {
          queue.shift()
          offset = 0
          head.done()
        }
      }
      return out
    },
  }
}
const room = createRoom()

// ---------- the server and the microphone bridge ----------

interface Wire {
  t: number
  conn: number
  type: string
  text?: string
  reason?: string
  verdict?: string
  score?: number
  count?: number
  problem?: string
}
const wire: Wire[] = []
let audioOwner = 0
let connections = 0

async function startServers(dataDir: string): Promise<{ close: () => Promise<void> }> {
  const inner = createUtleServer({ root: repoRoot, env: { ...process.env, UTLE_DATA_DIR: dataDir } })
  await new Promise<void>((done) => inner.listen(0, '127.0.0.1', done))
  const address = inner.address()
  const innerPort = typeof address === 'object' && address !== null ? address.port : 0
  const front = createServer((req, res) => {
    const up = httpRequest({ host: '127.0.0.1', port: innerPort, path: req.url, method: req.method, headers: req.headers }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    })
    up.on('error', () => {
      res.statusCode = 502
      res.end()
    })
    req.pipe(up)
  })
  const wss = new WebSocketServer({ noServer: true })
  front.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    wss.handleUpgrade(req, socket, head, (client) => {
      connections += 1
      const id = connections
      let sentAudio = false
      say(`bridge: connection ${id} ${(req.url ?? '').replace(/token=[^&]*/, 'token=…')}`)
      const upstream = new WebSocket(`ws://127.0.0.1:${innerPort}${req.url ?? '/api/asr'}`)
      const pending: Array<{ data: RawData | Buffer; binary: boolean }> = []
      upstream.on('open', () => {
        for (const p of pending) upstream.send(p.data, { binary: p.binary })
        pending.length = 0
      })
      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
        if (isBinary) return
        try {
          const m = JSON.parse(String(data)) as { type: string; text?: string; count?: number; problem?: string; decision?: { reason?: string; verdict?: string; score?: number } }
          if (m.type === 'partial') return
          wire.push({ t: at(), conn: id, type: m.type, ...(m.text ? { text: m.text } : {}), ...(m.decision?.reason ? { reason: m.decision.reason } : {}), ...(m.decision?.verdict ? { verdict: m.decision.verdict } : {}), ...(m.decision?.score !== undefined ? { score: m.decision.score } : {}), ...(m.count !== undefined ? { count: m.count } : {}), ...(m.problem ? { problem: m.problem } : {}) })
        } catch {
          // not JSON
        }
      })
      upstream.on('close', () => client.close())
      upstream.on('error', () => client.close())
      client.on('close', () => upstream.close())
      client.on('message', (data, isBinary) => {
        let out: RawData | Buffer = data
        if (isBinary) {
          // The newest connection that streams is the microphone; an older one (a document being
          // replaced) gets silence, so the room is heard once.
          if (!sentAudio) {
            sentAudio = true
            audioOwner = id
          }
          const bytes = Array.isArray(data) ? Buffer.concat(data).byteLength : data.byteLength
          const samples = id === audioOwner ? room.take(Math.floor(bytes / 4)) : new Float32Array(Math.floor(bytes / 4))
          out = Buffer.from(samples.buffer)
        }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(out, { binary: isBinary })
        else pending.push({ data: out, binary: isBinary })
      })
    })
  })
  await new Promise<void>((done, fail) => {
    front.once('error', fail)
    front.listen(PORT, '127.0.0.1', done)
  })
  return {
    close: async () => {
      for (const c of wss.clients) c.terminate()
      await new Promise<void>((done) => front.close(() => done()))
      await new Promise<void>((done) => inner.close(() => done()))
    },
  }
}

// ---------- the browser ----------

interface StripSample {
  t: number
  heard: string
  line: string
  foreign: string
  ignored: string
  wakeOpen: boolean
  listening: boolean
}
const strip: StripSample[] = []

const plain = (s: string): string =>
  s
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const words = (s: string): string[] => plain(s).split(' ').filter((w) => w !== '')

/** Every run of three words of the room's sentences. */
const ROOM_RUNS = CLIPS.filter((c) => c.room).flatMap((c) => {
  const w = words(c.text)
  return w.slice(0, -2).map((_, i) => `${w[i]} ${w[i + 1]} ${w[i + 2]}`)
})
/** The room run of three words in s, or ''. */
function roomRun(s: string): string {
  const text = ` ${words(s).join(' ')} `
  return ROOM_RUNS.find((run) => text.includes(` ${run} `)) ?? ''
}

interface Step {
  name: string
  pass: boolean
  startMs: number
  endMs: number
  shot: string
  detail: string
}
const timeline: Step[] = []

async function shoot(page: Page | undefined, name: string): Promise<string> {
  if (!page) return ''
  const file = join(OUT, `${String(timeline.length + 1).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file }).catch(() => undefined)
  return file
}

async function step(name: string, run: () => Promise<{ pass: boolean; detail: string; page?: Page }>): Promise<boolean> {
  const startMs = at()
  say(`step: ${name}`)
  let result: { pass: boolean; detail: string; page?: Page }
  try {
    result = await run()
  } catch (error) {
    result = { pass: false, detail: `threw: ${String(error).slice(0, 300)}` }
  }
  const endMs = at()
  const shot = await shoot(result.page, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40))
  timeline.push({ name, pass: result.pass, startMs, endMs, shot, detail: result.detail })
  check(`${name}`, result.pass, `${endMs} ms; ${result.detail}`)
  return result.pass
}

const stripState = async (sw: Worker): Promise<Record<string, unknown> | undefined> =>
  sw.evaluate(async () => (await chrome.storage.session.get('stripState')).stripState as Record<string, unknown> | undefined)

async function measure(sw: Worker, url: string): Promise<{ strip: { left: number; top: number; width: number; height: number } } | null> {
  return sw
    .evaluate(async (u) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url === u)
      if (tab?.id === undefined) return null
      return (await chrome.tabs.sendMessage(tab.id, { type: 'utle-strip-measure' })) as { strip: { left: number; top: number; width: number; height: number } }
    }, url)
    .catch(() => null)
}

/** When the first navigation whose address passes the test was requested (ms from install), or null. */
let navAt: (test: (url: string) => boolean) => number | null = () => null
const consentOn = async (p: Page | undefined): Promise<boolean> => (await p?.evaluate(() => (globalThis as unknown as { consentShown?: () => boolean }).consentShown?.() === true).catch(() => false)) === true

/** What the scripted person said or did because of the screen (extra utterances), for the timeline. */
const reactions: string[] = []

/** He says the scene; when the strip shows he is not heard (not ACTIVE), he says the word alone first. */
async function speak(sw: Worker, s: Scene): Promise<void> {
  if ((await stripState(sw))?.wakeOpen !== true) {
    reactions.push(`${at()} ms: not ACTIVE; he says "Ütle" first`)
    await room.play(scene([{ name: 'owner-wake', at: 0 }]))
    await waitUntil(async () => (await stripState(sw))?.wakeOpen === true, 5000)
  }
  await room.play(s)
}

const pageAt = (ctx: BrowserContext, test: (url: string) => boolean): Page | undefined => ctx.pages().find((p) => !p.isClosed() && test(p.url()))

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true })
  console.log(`exit rehearsal: out ${OUT}; bridge port ${PORT}; overlap ${OVERLAP_MS} ms; model ${process.env.UTLE_MODEL ?? '(default)'}`)
  const extensionDir = await buildExtension({ outRoot: join(here, '.standin') })
  console.log('(built with the real src/core/inpage.ts)')
  const dataDir = await mkdtemp(join(tmpdir(), 'utle-exit-'))
  const servers = await startServers(dataDir)
  const profile = await mkdtemp(join(tmpdir(), 'utle-exit-profile-'))
  let ctx: BrowserContext | null = null
  let sampling = true
  try {
    // ---- install: a fresh profile loads the extension ----
    t0 = Date.now()
    ctx = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: false,
      // 1280 x 900: the size real-pages.ts measured YouTube's consent at (r9-real-pages.md).
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    })
    const youtube = readFileSync(join(FIXTURES, 'youtube.html'), 'utf8')
    const whatsapp = readFileSync(join(FIXTURES, 'whatsapp.html'), 'utf8')
    const lexical = readFileSync(join(here, 'vendor/lexical.js'), 'utf8')
    await ctx.route('https://www.youtube.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: youtube }))
    await ctx.route('https://youtube.com/**', (route) => route.fulfill({ status: 301, headers: { location: route.request().url().replace('https://youtube.com', 'https://www.youtube.com') } }))
    await ctx.route('https://web.whatsapp.com/**', (route) =>
      new URL(route.request().url()).pathname.endsWith('/lexical.js')
        ? route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: lexical })
        : route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: whatsapp }),
    )
    const navigations: string[] = []
    const navs: Array<{ t: number; url: string }> = []
    ctx.on('request', (r) => {
      if (!r.isNavigationRequest() || !/^https?:/.test(r.url()) || /localhost|127\.0\.0\.1/.test(r.url())) return
      navs.push({ t: at(), url: r.url() })
      navigations.push(`${at()} ${r.url()}`)
    })
    navAt = (test) => navs.find((n) => test(n.url))?.t ?? null
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
    const extensionId = new URL(sw.url()).host
    await sw.evaluate((asr) => chrome.storage.local.set({ asrUrl: asr }), `ws://localhost:${PORT}/api/asr`)

    // Every 100 ms: what the strip shows.
    const sampler = (async () => {
      while (sampling) {
        const t = at()
        const st = await stripState(sw).catch(() => undefined)
        if (st) strip.push({ t, heard: String(st.heard ?? ''), line: String(st.line ?? ''), foreign: String(st.foreign ?? ''), ignored: String(st.ignored ?? ''), wakeOpen: st.wakeOpen === true, listening: st.listening === true })
        await sleep(Math.max(0, 100 - (at() - t)))
      }
    })()

    let welcome: Page | undefined
    await step('install: the welcome page opens by itself', async () => {
      const found = await waitUntil(async () => (welcome = pageAt(ctx as BrowserContext, (u) => u.includes('/welcome.html'))) !== undefined, 15_000)
      if (welcome) await welcome.waitForLoadState('domcontentloaded')
      return { pass: found, detail: welcome?.url() ?? 'no welcome page', page: welcome }
    })
    if (!welcome) throw new Error('no welcome page')
    const w = welcome
    await w.bringToFront()
    const done = async (id: string): Promise<boolean> => (await w.getAttribute(`#${id}`, 'data-done').catch(() => null)) === 'true'

    await step('welcome 1: the microphone (Chrome asks once: a person clicks Allow)', async () => {
      if (!(await done('stepMic'))) await w.click('#stepMicHead')
      const ok = await waitUntil(() => done('stepMic'), 10_000)
      return { pass: ok, detail: `stepMic done=${ok}`, page: w }
    })

    await step('welcome 2: the server answers', async () => {
      let ok = await waitUntil(() => done('stepServer'), 5000)
      if (!ok) {
        await w.click('#stepServerHead')
        ok = await waitUntil(() => done('stepServer'), 15_000)
      }
      return { pass: ok, detail: `stepServer done=${ok}; ${(await w.textContent('#stepServerResult').catch(() => '')) ?? ''}`, page: w }
    })

    await step('welcome 3: enrolment, twelve phrases read in his voice', async () => {
      await w.click('#voiceStart')
      const played: string[] = []
      let retries = 0
      for (let guard = 0; guard < 40; guard += 1) {
        const st = await stripState(sw)
        const count = Number(st?.enrolPhrases ?? -1)
        if (count < 0 && played.length > 0) break
        // Before the start, and after the twelfth while the server checks the two held out: he waits.
        if (count < 0 || count >= 12) {
          await sleep(200)
          continue
        }
        // He reads the phrase on the screen: the page shows phrase count + 1.
        const name = `enrol-${String(count + 1).padStart(2, '0')}`
        if (played.includes(name)) retries += 1
        played.push(name)
        const answers = wire.filter((m) => m.type === 'enrolPhrase').length
        await room.play(scene([{ name, at: 0, dir: ENROL_SET }]))
        // The server counts the phrase (or names its problem) after the endpoint: one enrolPhrase each.
        await waitUntil(async () => wire.filter((m) => m.type === 'enrolPhrase').length > answers, 8000)
        await sleep(300)
      }
      const ok = await waitUntil(() => done('stepVoice'), 15_000)
      const st = await stripState(sw)
      return { pass: ok, detail: `phrases read ${played.length} (repeats ${retries}); outcome ${String(st?.enrolOutcome)}; line ${JSON.stringify(st?.line)}`, page: w }
    })

    // Found by this rehearsal (dbg-1, dbg2): the twelfth phrase's final reaches the client after
    // `enrolled`, when the engine has left enrolment, so it is judged as speech (addressee check, model).
    {
      const enrolledAt = wire.findIndex((m) => m.type === 'enrolled')
      const late = enrolledAt < 0 ? [] : wire.slice(enrolledAt + 1).filter((m) => m.conn === wire[enrolledAt]?.conn && m.type === 'final' && m.t - (wire[enrolledAt]?.t ?? 0) < 3000)
      check('enrolment: no phrase of his reading arrives as speech after "enrolled"', enrolledAt >= 0 && late.length === 0, late.map((m) => `${m.t} ms final ${JSON.stringify(m.text)} (enrolled at ${wire[enrolledAt]?.t} ms)`).join('; '))
    }

    await step('welcome 4: the voice test knows him', async () => {
      await w.click('#checkStart')
      await sleep(600)
      await room.play(scene([{ name: 'verify-2', at: 0, dir: ENROL_SET }]))
      const ok = await waitUntil(() => done('stepCheck'), 10_000)
      return { pass: ok, detail: `${(await w.textContent('#stepCheckResult').catch(() => '')) ?? ''}`, page: w }
    })

    await step('welcome 5: only my voice on', async () => {
      await w.click('#guardOn')
      const ok = await waitUntil(async () => (await done('stepGuard')) && (await sw.evaluate(async () => (await chrome.storage.local.get('onlyOwner')).onlyOwner === true)), 5000)
      return { pass: ok, detail: `onlyOwner=${ok}`, page: w }
    })

    let settings: Page | undefined
    await step('settings: wake mode ("Äratussõnaga")', async () => {
      settings = await (ctx as BrowserContext).newPage()
      await settings.goto(`chrome-extension://${extensionId}/options.html`)
      await settings.locator('button.choice', { hasText: STRINGS.et.wake.listenWake }).first().click()
      const stored = await waitUntil(async () => (await sw.evaluate(async () => (await chrome.storage.local.get('listenMode')).listenMode)) === 'wake', 5000)
      const offscreen = await waitUntil(async () => {
        const url = await sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] }))[0]?.documentUrl ?? '')
        return url.includes('onlyOwner=1') && url.includes('wake=')
      }, 15_000)
      const listening = await waitUntil(async () => (await stripState(sw))?.listening === true, 15_000)
      return { pass: stored && offscreen && listening, detail: `listenMode wake=${stored}; offscreen onlyOwner=1&wake=${offscreen}; listening=${listening}`, page: settings }
    })

    // He is on a new tab, as after the helper's sheet; the welcome and settings pages are closed.
    const start = await (ctx as BrowserContext).newPage()
    await start.goto('chrome://newtab/').catch(() => undefined)
    await start.bringToFront()
    await settings?.close().catch(() => undefined)
    await w.close().catch(() => undefined)
    await sleep(1500)

    // ---- the exit test's sentence, two others talking around and over it ----
    const command = scene([
      { name: 'room-kalev-1', at: 0 },
      { name: 'owner-youtube', at: 4300 },
    ])
    const ownerSpan = command.spans.find((s) => s.name === 'owner-youtube') ?? { from: 0, to: 0 }
    const withRoom = scene([
      { name: 'room-kalev-1', at: 0 },
      { name: 'owner-youtube', at: 4300 },
      // The second voice starts before he has finished: over the end of his sentence.
      { name: 'room-vesta-1', at: ownerSpan.to - OVERLAP_MS - 300, gain: 0.8 },
      { name: 'room-kalev-2', at: ownerSpan.to - OVERLAP_MS - 300 + 4460 + 1200 },
    ])
    console.log(`      scene: ${withRoom.spans.map((s) => `${s.name} ${s.from}-${s.to} ms`).join('; ')}`)
    let yt: Page | undefined
    let commandEnd = 0
    await step('"Ütle, mine youtube’i ja otsi lastelaulud" with two others talking: YouTube opens', async () => {
      const played = room.play(withRoom)
      const found = async (): Promise<boolean> => (yt = pageAt(ctx as BrowserContext, (u) => u.startsWith('https://www.youtube.com'))) !== undefined
      let ok = await waitUntil(found, 30_000)
      commandEnd = (room.heardAt.get('owner-youtube speech ends') ?? Date.now()) - t0
      if (!ok) {
        // A person sees that nothing opened (the strip's answer) and says it once more, the others still talking.
        await played
        reactions.push(`${at()} ms: nothing opened (strip: ${JSON.stringify((await stripState(sw))?.line)}); he says the sentence again`)
        say(reactions.at(-1) ?? '')
        await speak(sw, withRoom)
        ok = await waitUntil(found, 30_000)
        commandEnd = (room.heardAt.get('owner-youtube speech ends') ?? Date.now()) - t0
      }
      if (yt) await yt.waitForLoadState('domcontentloaded').catch(() => undefined)
      await played
      const opened = navAt((u) => u.startsWith('https://www.youtube.com'))
      return { pass: ok, detail: `his last word at ${commandEnd} ms; YouTube navigated at ${opened ?? '-'} ms (${opened === null ? '-' : opened - commandEnd} ms after it); ${yt?.url() ?? 'no YouTube tab'}`, page: yt ?? start }
    })

    if (yt) {
      const page = yt
      await step('YouTube’s consent page first (the stand-in trimmed from the real one)', async () => {
        await waitUntil(async () => (await page.evaluate(() => (globalThis as unknown as { consentShown?: () => boolean }).consentShown?.() === true)) || /\/results/.test(page.url()), 10_000)
        const shown = await page.evaluate(() => (globalThis as unknown as { consentShown?: () => boolean }).consentShown?.() === true).catch(() => false)
        return { pass: shown, detail: `consent on screen=${shown}; ${page.url()}`, page }
      })
      // 1k-REALPAGES: the strip must not cover the page's own consent button (a pointer or an eye tracker clicks it).
      if (await page.evaluate(() => document.getElementById('accept') !== null).catch(() => false)) {
        const hit = await page.evaluate(() => {
          const b = document.getElementById('accept') as HTMLElement
          const r = b.getBoundingClientRect()
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), hit: el === null ? 'none' : el.tagName.toLowerCase(), onButton: el !== null && (el === b || b.contains(el)) }
        })
        const m = await measure(sw, page.url())
        check('1k-REALPAGES: the strip leaves the consent’s "Nõustu kõigiga" clickable', hit.onButton, `button y ${hit.top}-${hit.bottom}; strip ${m ? `y ${Math.round(m.strip.top)}-${Math.round(m.strip.top + m.strip.height)}` : 'not measured'}; hit ${hit.hit}`)
      }
    }

    let results: Page | undefined
    await step('the results for "lastelaulud" on screen', async () => {
      const there = async (): Promise<boolean> => {
        const p = pageAt(ctx as BrowserContext, (u) => u.startsWith('https://www.youtube.com/results'))
        if (!p) return false
        const ok = /search_query=lastelaulud/i.test(p.url()) && !(await p.evaluate(() => (globalThis as unknown as { consentShown?: () => boolean }).consentShown?.() === true))
        if (ok) results = p
        return ok
      }
      // He waits while Ütle works; once the page has stood still for 3 s with the consent in front, he answers it.
      let lastUrl = ''
      let stillSince = Date.now()
      let ok = await waitUntil(async () => {
        if (await there()) return true
        const p = pageAt(ctx as BrowserContext, (u) => u.startsWith('https://www.youtube.com'))
        const line = String((await stripState(sw))?.line ?? '')
        if (p?.url() !== lastUrl || /^Mõtlen|Avan|Otsin/.test(line)) {
          lastUrl = p?.url() ?? ''
          stillSince = Date.now()
          return false
        }
        return Date.now() - stillSince > 3000 && (await consentOn(p))
      }, 25_000)
      ok = ok && (await there())
      let extra = ''
      if (!ok) {
        // A person would say yes to the layer in front of the search (the helper's sheet: "Ütle, nõustu kõigiga").
        const where = pageAt(ctx as BrowserContext, (u) => u.startsWith('https://www.youtube.com'))
        const blocked = (await where?.evaluate(() => (globalThis as unknown as { consentShown?: () => boolean }).consentShown?.() === true).catch(() => false)) === true
        extra = `after the command: ${where?.url() ?? 'no YouTube tab'}, consent ${blocked ? 'still on screen' : 'gone'}; `
        if (blocked) {
          reactions.push(`${at()} ms: the consent is still in front; he says "Ütle, nõustu kõigiga"`)
          say(reactions.at(-1) ?? '')
          await room.play(scene([{ name: 'room-vesta-2', at: 0 }, { name: 'owner-accept', at: 5200 }]))
          ok = await waitUntil(there, 30_000)
          extra += `after "nõustu kõigiga": ${pageAt(ctx as BrowserContext, (u) => u.startsWith('https://www.youtube.com'))?.url() ?? '-'}`
        }
      }
      const shown = results ?? pageAt(ctx as BrowserContext, (u) => u.startsWith('https://www.youtube.com'))
      const titles = shown ? await shown.locator('a#video-title').allTextContents().catch(() => []) : []
      const searched = navs.filter((n) => n.url.includes('/results?')).map((n) => `${n.t} ms ${decodeURIComponent(new URL(n.url).searchParams.get('search_query') ?? '')}`)
      const firstResults = navAt((u) => /\/results\?search_query=/.test(u))
      return { pass: ok, detail: `${extra}; searched ${JSON.stringify(searched)} (first ${firstResults === null ? '-' : firstResults - commandEnd} ms after his last word); ${titles.length} results on screen, first ${JSON.stringify(titles[0] ?? '')}`, page: shown }
    })

    // ---- the chat: by voice, then one sentence dictated and "saada" ----
    let chat: Page | undefined
    await step('"Ütle, mine whatsappi ja ava Jaan Tamme vestlus": the chat is open', async () => {
      const played = room.play(scene([{ name: 'room-vesta-2', at: 0 }, { name: 'owner-chat', at: 5000 }, { name: 'room-kalev-3', at: 11_000 }]))
      const open = async (): Promise<boolean> => {
        chat = pageAt(ctx as BrowserContext, (u) => u.startsWith('https://web.whatsapp.com'))
        if (!chat) return false
        return chat.evaluate(() => document.querySelector('#main footer [role="textbox"]') !== null && /Jaan Tamm/.test(document.querySelector('#main header')?.textContent ?? document.querySelector('#main')?.textContent ?? ''))
      }
      const ok = await waitUntil(open, 45_000)
      await played
      return { pass: ok, detail: `${chat?.url() ?? 'no WhatsApp tab'}; chat with Jaan Tamm open=${ok}; ${ok ? at() - ((room.heardAt.get('owner-chat speech ends') ?? Date.now()) - t0) : '-'} ms after his last word`, page: chat }
    })

    const boxes: Array<{ t: number; text: string }> = []
    let sentList: string[] = []
    if (chat) {
      const page = chat
      await page.bringToFront()
      const boxText = async (): Promise<string> => page.evaluate(() => (globalThis as unknown as { waText?: () => string }).waText?.() ?? document.querySelector('#main footer [role="textbox"]')?.textContent ?? '').catch(() => '')
      const boxSampler = (async () => {
        while (sampling && !page.isClosed()) {
          boxes.push({ t: at(), text: await boxText() })
          await sleep(100)
        }
      })()
      await step('one sentence dictated (the room talks before "saada"): the box holds his sentence', async () => {
        await sleep(800)
        // A person looks at the strip: with its amber disc off (ACTIVE ended), he says the word alone first.
        await speak(sw, scene([{ name: 'owner-message', at: 0 }, { name: 'room-vesta-3', at: 5200 }]))
        const ok = await waitUntil(async () => words(await boxText()).length >= 4, 15_000)
        await sleep(1500)
        const text = await boxText()
        const end = (room.heardAt.get('owner-message speech ends') ?? Date.now()) - t0
        const landed = boxes.find((b) => b.t >= end - 4000 && words(b.text).length >= 4)?.t
        return { pass: ok && roomRun(text) === '', detail: `box ${JSON.stringify(text)}; in the box ${landed === undefined ? '-' : landed - end} ms after his last word (sampled every 100 ms)`, page }
      })
      await step('"saada": the message is sent, his sentence only', async () => {
        await room.play(scene([{ name: 'owner-send', at: 0 }]))
        const sentTo = async (): Promise<string[]> => page.evaluate(() => (globalThis as unknown as { sentTo: (name: string) => string[] }).sentTo('Jaan Tamm')).catch(() => [])
        // 31: a one-word command can be too short to verify; the strip then asks for "saada sõnum", and he says that.
        const tooShort = STRINGS.et.strip.voiceTooShort
        let ok = await waitUntil(async () => (await sentTo()).length > 0 || String((await stripState(sw))?.line ?? '') === tooShort, 15_000)
        if ((await sentTo()).length === 0 && ok) {
          reactions.push(`${at()} ms: "Saada" was too short to verify; the strip asks for the longer form; he says "Saada sõnum"`)
          say(reactions.at(-1) ?? '')
          await speak(sw, scene([{ name: 'owner-send-long', at: 0 }]))
          ok = await waitUntil(async () => (await sentTo()).length > 0, 15_000)
        } else ok = (await sentTo()).length > 0
        const sentAt = at()
        const sendEnd = Math.max(room.heardAt.get('owner-send speech ends') ?? 0, room.heardAt.get('owner-send-long speech ends') ?? 0)
        await sleep(1500)
        sentList = await sentTo()
        const mine = words(clip('owner-message').text)
        const got = words(sentList[0] ?? '')
        const shared = mine.filter((x) => got.includes(x)).length
        const pass = ok && sentList.length === 1 && roomRun(sentList[0] ?? '') === '' && shared / mine.length >= 0.6 && !got.includes('saada')
        return { pass, detail: `sent ${JSON.stringify(sentList)}; ${shared}/${mine.length} of his words; ${ok ? sentAt - (sendEnd - t0) : '-'} ms after his last "saada" (polled every 100 ms)`, page }
      })
      sampling = false
      await boxSampler
    }
    sampling = false
    await sampler

    // ---- criterion 2: the bar never shows the others' words; the box and the message neither ----
    const leaks = strip.filter((s) => roomRun(`${s.heard}`) !== '' || roomRun(`${s.line}`) !== '')
    check(`the bar never shows three of the room’s words in a row (${strip.length} samples)`, leaks.length === 0, leaks.slice(0, 3).map((s) => `${s.t} ms heard=${JSON.stringify(s.heard)} line=${JSON.stringify(s.line)} (${roomRun(s.heard) || roomRun(s.line)})`).join('; '))
    const boxLeaks = boxes.filter((b) => roomRun(b.text) !== '')
    check(`the chat box never holds three of the room’s words in a row (${boxes.length} samples)`, boxLeaks.length === 0, boxLeaks.slice(0, 2).map((b) => `${b.t} ms ${JSON.stringify(b.text)}`).join('; '))
    check('the sent list is his sentence, once', sentList.length === 1 && roomRun(sentList[0] ?? '') === '', JSON.stringify(sentList))

    // ---- the record ----
    const total = timeline.at(-1)?.endMs ?? at()
    check(`machine time under ten minutes`, total < TEN_MINUTES_MS, `${(total / 1000).toFixed(1)} s`)
    const trail: string[] = []
    for (const s of strip) {
      const entry = `heard=${JSON.stringify(s.heard)} line=${JSON.stringify(s.line)}${s.foreign ? ` foreign=${JSON.stringify(s.foreign)}` : ''}${s.ignored ? ` ignored=${JSON.stringify(s.ignored)}` : ''}${s.wakeOpen ? ' ACTIVE' : ''}`
      if (trail.at(-1)?.endsWith(entry) !== true) trail.push(`${String(s.t).padStart(6)} ms ${entry}`)
    }
    console.log('\n      strip states seen (ms from install):')
    for (const line of trail) console.log(`        ${line}`)
    console.log('\n      server messages (no partials; ms from install):')
    for (const m of wire) console.log(`        ${String(m.t).padStart(6)} c${m.conn} ${m.type}${m.reason ? ` ${m.reason}` : ''}${m.verdict ? `/${m.verdict}` : ''}${m.score !== undefined ? ` score=${m.score.toFixed(3)}` : ''}${m.count !== undefined ? ` count=${m.count}` : ''}${m.problem ? ` problem=${m.problem}` : ''}${m.text ? ` ${JSON.stringify(m.text)}` : ''}`)
    console.log('\n      room (ms from install):')
    for (const [label, when] of [...room.heardAt.entries()].sort((a, b) => a[1] - b[1])) console.log(`        ${String(when - t0).padStart(6)} ${label}`)
    console.log(`\n      navigations: ${navigations.join(' | ')}`)
    const rows = timeline.map((s, i) => `| ${i + 1} | ${s.name} | ${s.pass ? 'PASS' : 'FAIL'} | ${s.startMs} | ${s.endMs} | ${s.shot === '' ? '' : s.shot.replace(`${repoRoot}\\`, '').replace(/\\/g, '/')} | ${s.detail.replace(/\|/g, '/')} |`)
    const table = ['| # | step | result | start ms | end ms | screenshot | detail |', '|---|---|---|---|---|---|---|', ...rows].join('\n')
    const human = [
      'reading the helper’s sheet (what to say, which buttons)',
      'Chrome’s microphone permission: one click on Allow (the fake UI grants it here)',
      'reading the twelve phrases aloud (timed here in the voice’s own time, not a person’s pace)',
      'choosing wake mode in the settings (a click here)',
      'loading the unpacked extension (chrome://extensions, developer mode) before the install',
    ]
    const summary = `\nREACTIONS (what the person said because of the screen):\n${reactions.map((r) => `- ${r}`).join('\n') || '- none'}\n\nTIMELINE (machine time ${(total / 1000).toFixed(1)} s, ${timeline.filter((s) => s.pass).length}/${timeline.length} steps PASS; strip samples ${strip.length}, room-run leaks ${leaks.length})\n${table}\n\nSteps a person adds (not timed): ${human.join('; ')}.`
    console.log(summary)
    await writeFile(join(OUT, 'timeline.md'), `${summary}\n`)
    await writeFile(join(OUT, 'run.json'), JSON.stringify({ reactions, timeline, strip: strip.length, leaks, wire, room: Object.fromEntries(room.heardAt), navigations, sent: sentList, boxes: boxes.filter((b, i) => i === 0 || boxes[i - 1]?.text !== b.text) }, null, 2))
  } finally {
    sampling = false
    await ctx?.close().catch(() => undefined)
    await servers.close().catch(() => undefined)
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined)
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
  process.exitCode = failures === 0 ? 0 : 1
  // The decode worker keeps the process alive.
  process.exit()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})

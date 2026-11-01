/**
 * Round 10, lane MEASURE (issue #4): the latency of a spoken command, in three stages, from replaying
 * labelled clips through the real dev server and the real command logic.
 *
 *   npx vite --port 5393 --strictPort                      (in another shell, with ANTHROPIC_API_KEY set)
 *   npx tsx scripts/latency.ts --labels <labels.tsv> [--kind command,short] [--base http://localhost:5393] [--json <file>]
 *
 * Per clip:
 *   1. speech end -> final   the clip is streamed to <base>/api/asr as the extension streams it
 *      (scripts/asr-client.ts: 100 ms float32 frames in real time, then 1.5 s of silence and a flush).
 *      From the wall time the frame holding the clip's last speech (speechEndSample, -40 dBFS) is sent
 *      to the arrival of the clip's last final. Includes the recogniser's endpoint silence rule.
 *   2. final -> intent       from handing the final to the logic to having the page commands: the real
 *      src/core/inpage.ts inpageStep on a fresh session; when the rules hand it to the model (step.ask),
 *      also readPage on the page, POST <base>/api/intent, pageIntentFrom and applyIntent, as
 *      extension/src/engine.ts does. The route ("rules" or "model") is printed per clip.
 *   3. intent -> action      the page commands run in Chromium on extension/test/fixtures/chat.html
 *      (served by the dev server, with 3000 px of room added so it scrolls and "Tere" already in the
 *      composer so "saada" has something to send; both before the clock starts) through the extension's own page script (extension/dist/page.js,
 *      __utle.run), one after another, from the first call to the last answer. Commands the extension
 *      runs in the service worker instead (tabs, history, zoom, settings) are not run here: such a
 *      clip has no stage 3 time and says so.
 * Not measured: the engine's own holds between stages (the final assembler, the quick-reply hold),
 * the network to a hosted server, and the service worker's hop (chrome.scripting) to the page.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { WebSocket } from 'ws'
import type { BrowserCommand, BrowserResult, PageContext } from '../src/browser/protocol.ts'
import { applyIntent, initialInpage, inpageStep } from '../src/core/inpage.ts'
import type { InpageStep } from '../src/core/inpage.ts'
import { pageIntentFrom } from '../src/core/pageIntent.ts'
import type { IntentAnswer, IntentRequest } from '../src/core/pageIntent.ts'
import { ASR_FRAME_SAMPLES, ASR_SAMPLE_RATE, parseAsrMessage } from '../src/speech/asrProtocol.ts'
import { buildExtension } from './ext.ts'
import { insideRepo, parseLabels, percentile, speechEndSample } from './measure.ts'
import { readAnyWav } from './wav.ts'

const argv = process.argv.slice(2)
const value = (name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}
const labelsArg = value('--labels')
if (labelsArg === undefined) {
  console.error('usage: npx tsx scripts/latency.ts --labels <labels.tsv> [--kind command,short] [--base http://localhost:5393] [--json <file>]')
  process.exit(2)
}
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const BASE = value('--base') ?? `http://localhost:${process.env.UTLE_PORT ?? '5393'}`
const ASR = `${BASE.replace(/^http/, 'ws')}/api/asr`
const PAGE_URL = `${BASE}/extension/test/fixtures/chat.html`
const FRAME_MS = (ASR_FRAME_SAMPLES * 1000) / ASR_SAMPLE_RATE
const TAIL_MS = 1500
/** Commands extension/src/background.ts runs itself rather than in the page. */
const BROWSER_LEVEL = new Set<BrowserCommand['kind']>(['newTab', 'closeTab', 'switchTab', 'goTo', 'history', 'reload', 'bar', 'zoom', 'openSettings', 'openHelp', 'compose', 'composeTo', 'savePlace', 'removePlace', 'ping'])

const labelsFile = resolve(labelsArg)
const kinds = (value('--kind') ?? 'command,short').split(',')
const rows = parseLabels(readFileSync(labelsFile, 'utf8')).filter((r) => kinds.includes(r.kind))
const synthetic = insideRepo(labelsFile, repoRoot)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Stage 1: stream a clip, return its finals and the ms from the last speech frame sent to the last final. */
async function recognise(samples: Float32Array): Promise<{ text: string; ms: number }> {
  const frames: Float32Array<ArrayBuffer>[] = []
  for (let at = 0; at < samples.length; at += ASR_FRAME_SAMPLES) {
    const f = new Float32Array(ASR_FRAME_SAMPLES)
    f.set(samples.subarray(at, Math.min(at + ASR_FRAME_SAMPLES, samples.length)))
    frames.push(f)
  }
  for (let i = 0; i < TAIL_MS / FRAME_MS; i += 1) frames.push(new Float32Array(ASR_FRAME_SAMPLES))
  const lastSpeechFrame = Math.max(0, Math.ceil(speechEndSample(samples) / ASR_FRAME_SAMPLES) - 1)
  const ws = new WebSocket(ASR)
  ws.binaryType = 'arraybuffer'
  const finals: string[] = []
  let speechSentAt = Number.NaN
  let lastFinalAt = Number.NaN
  let ready: () => void = () => {}
  const isReady = new Promise<void>((r) => {
    ready = r
  })
  ws.on('message', (data: ArrayBuffer | Buffer, isBinary: boolean) => {
    if (isBinary) return
    const m = parseAsrMessage(data.toString())
    if (m?.type === 'ready') ready()
    if (m?.type === 'unavailable') throw new Error(`recogniser unavailable: ${m.reason}`)
    if (m?.type === 'final' && m.text.trim() !== '') {
      finals.push(m.text)
      lastFinalAt = performance.now()
    }
  })
  await new Promise<void>((r, j) => {
    ws.once('open', () => r())
    ws.once('error', j)
  })
  await Promise.race([isReady, sleep(30_000)])
  const started = performance.now()
  for (const [i, frame] of frames.entries()) {
    await sleep(Math.max(0, started + i * FRAME_MS - performance.now()))
    ws.send(frame.buffer)
    if (i === lastSpeechFrame) speechSentAt = performance.now()
  }
  ws.send(JSON.stringify({ type: 'flush' }))
  const flushedAt = performance.now()
  // The last final: wait until 2 s pass with none new, at most 8 s after the flush.
  while (performance.now() - flushedAt < 8000 && !(performance.now() - (Number.isNaN(lastFinalAt) ? flushedAt : Math.max(lastFinalAt, flushedAt)) > 2000)) await sleep(50)
  ws.close()
  return { text: finals.join(' '), ms: lastFinalAt - speechSentAt }
}

interface Result {
  file: string
  speaker: string
  reference: string
  heard: string
  route: 'rules' | 'model' | 'none'
  commands: string[]
  speechToFinalMs: number
  finalToIntentMs: number
  intentToActionMs: number
  actionNote: string
}

const pageScript = join(repoRoot, 'extension', 'dist', 'page.js')
if (!existsSync(pageScript)) await buildExtension()
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const run = (command: BrowserCommand): Promise<BrowserResult> =>
  page.evaluate(async (c) => {
    const utle = (globalThis as unknown as { __utle?: { run(cmd: unknown): Promise<BrowserResult> } }).__utle
    return utle ? utle.run({ ...c, site: null }) : { ok: false, code: 'failed' as const, message: 'no page script' }
  }, command) as Promise<BrowserResult>

const results: Result[] = []
console.log(`${synthetic ? 'SYNTHETIC (TartuNLP voices from scripts/fixtures, not people). ' : ''}${rows.length} clips of kind ${kinds.join(',')} from ${labelsFile}; server ${BASE}`)
for (const row of rows) {
  const path = isAbsolute(row.file) ? row.file : join(dirname(labelsFile), row.file)
  const wav = readAnyWav(path)
  if (wav.rate !== ASR_SAMPLE_RATE) throw new Error(`${row.file}: ${wav.rate} Hz`)
  const heard = await recognise(wav.samples)

  await page.goto(PAGE_URL)
  await page.addScriptTag({ path: pageScript })
  // The page as a command finds it: room to scroll (3000 px more in the message list, chat.html's scroller) and a dictated
  // line in the composer, so "saada" has something to send. Set up before the clock starts.
  // A string, not a function: this project's scripts compile without the DOM library.
  await page.evaluate(`(() => {
    const room = document.createElement('div')
    room.style.height = '3000px'
    ;(document.getElementById('log') ?? document.body).append(room)
  })()`)
  await run({ kind: 'setText', text: 'Tere' })
  const t0 = performance.now()
  let route: Result['route'] = 'rules'
  const session = initialInpage('et')
  const boxRead = await run({ kind: 'readBox' })
  const box = boxRead.ok && boxRead.box ? boxRead.box : { present: false, text: '', armed: false }
  let step: InpageStep = inpageStep(session, heard.text, box)
  if (heard.text === '') route = 'none'
  else if (step.ask === true) {
    route = 'model'
    const read = await run({ kind: 'readPage' })
    const ctx: PageContext = read.ok && read.page ? read.page : { url: PAGE_URL, title: '', box, items: [], media: null, hints: false }
    const request: IntentRequest = { lang: 'et', utterance: heard.text, page: ctx, tabs: [], recent: [] }
    const response = await fetch(`${BASE}/api/intent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
    if (response.ok) {
      const answer = (await response.json()) as IntentAnswer
      const intent = pageIntentFrom(answer.intent, { page: ctx, tabs: [] })
      if (intent !== null && intent.kind !== 'place') step = applyIntent(session, intent, ctx, answer.say)
    } else console.log(`  /api/intent answered ${response.status}`)
  }
  const t1 = performance.now()
  const browserLevel = step.commands.filter((c) => BROWSER_LEVEL.has(c.kind))
  let note = ''
  let actionMs = Number.NaN
  if (step.commands.length === 0) note = 'no command'
  else if (browserLevel.length > 0) note = `service-worker command (${browserLevel.map((c) => c.kind).join(',')}): not run here`
  else {
    const t2 = performance.now()
    let last: BrowserResult = { ok: true }
    for (const command of step.commands) {
      last = await run(command)
      if (!last.ok) break
    }
    actionMs = performance.now() - t2
    note = last.ok ? 'ok' : `failed: ${last.message}`
  }
  const r: Result = { file: row.file, speaker: row.speaker, reference: row.reference, heard: heard.text, route, commands: step.commands.map((c) => c.kind), speechToFinalMs: Math.round(heard.ms), finalToIntentMs: Math.round(t1 - t0), intentToActionMs: Math.round(actionMs), actionNote: note }
  results.push(r)
  console.log(`${basename(row.file).padEnd(28)} ${String(r.speechToFinalMs).padStart(5)} ms | ${r.route.padEnd(5)} ${String(r.finalToIntentMs).padStart(5)} ms | ${Number.isNaN(actionMs) ? '    -' : String(r.intentToActionMs).padStart(5)} ms  "${heard.text}" -> ${r.commands.join(',') || '-'} (${note})`)
}
await browser.close()

const stat = (label: string, values: number[]): string => {
  const v = values.filter((x) => Number.isFinite(x))
  return `${label.padEnd(30)} ${String(v.length).padStart(3)}  ${v.length ? Math.round(percentile(v, 50)).toString().padStart(6) : '     -'}  ${v.length ? Math.round(percentile(v, 95)).toString().padStart(6) : '     -'}`
}
console.log(`\n${synthetic ? 'SYNTHETIC\n' : ''}${'stage'.padEnd(30)} ${'n'.padStart(3)}  ${'p50 ms'.padStart(6)}  ${'p95 ms'.padStart(6)}`)
console.log(stat('speech end -> final', results.map((r) => r.speechToFinalMs)))
console.log(stat('final -> intent (rules)', results.filter((r) => r.route === 'rules').map((r) => r.finalToIntentMs)))
console.log(stat('final -> intent (model)', results.filter((r) => r.route === 'model').map((r) => r.finalToIntentMs)))
console.log(stat('intent -> action (page)', results.map((r) => r.intentToActionMs)))
const jsonPath = value('--json') ?? (synthetic ? join(repoRoot, 'artifacts', 'latency.json') : join(dirname(labelsFile), 'latency.json'))
mkdirSync(dirname(jsonPath), { recursive: true })
writeFileSync(jsonPath, `${JSON.stringify({ labels: labelsFile, synthetic, base: BASE, results }, null, 2)}\n`)
console.log(`wrote ${jsonPath}`)

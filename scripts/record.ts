/**
 * Round 10, lane MEASURE (issue #4): records one person reading the measurement phrases, one wav per
 * phrase (16 kHz mono, 16-bit), into a folder OUTSIDE the repository, and appends a line per clip to
 * <out>/labels.tsv (scripts/measure.ts says the columns). The speaker column is the --person given
 * here, typed by whoever runs the session: never the speaker gate's verdict.
 *
 * The microphone is taken the way the extension takes it (src/speech/microphone.ts: echo
 * cancellation, noise suppression and gain control on, a 16 kHz AudioContext), in a Chromium window
 * this script opens on a page it serves itself on 127.0.0.1. Nothing goes to any other server.
 *
 *   npx tsx scripts/record.ts --person ralf --out C:/temp/utle-voice --consent
 *     --set all | command,dictation,wake,short    which phrases (default all)
 *     --crosstalk                                  everyone talks at once while --person reads the
 *                                                  commands; clips get kind "crosstalk"
 *     --auto <seconds>                             no keys: each phrase is recorded for that long
 *     --fake-mic <wav>                             Chromium's fake microphone plays this file (tests)
 *     --headless                                   no window (only with --fake-mic)
 *
 * In the window: Space starts and stops a phrase, Backspace records the last phrase again, Escape ends.
 * Without --consent the script prints what the speaker agrees to and stops.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { wavBytes } from '../server/capture.ts'
import { LABEL_COLUMNS, formatLabels, insideRepo, promptsFor } from './measure.ts'
import type { Prompt } from './measure.ts'

const HELP = `usage: npx tsx scripts/record.ts --person <name> --out <folder outside the repo> --consent
  [--set all|command,dictation,wake,short] [--crosstalk] [--auto <seconds>] [--fake-mic <wav> [--headless]]

Records each phrase into <out>/<person>/<phrase id>.wav (16 kHz mono) and appends to <out>/labels.tsv.
The folder must be outside the repository: recordings are personal data and never go in git.
In the window: Space starts and stops a phrase, Backspace records the last one again, Escape ends.`

export const CONSENT = `Before recording, read this to the speaker and record only if they say yes:
  - Ütle records your voice reading about 30 short Estonian phrases (about 5 minutes).
  - The recordings stay on this computer, in the folder named by --out. They are not uploaded and
    not put in git. Only counts and scores (word error rates, similarity scores) are written down.
  - They are used to measure how well Ütle hears Estonian and tells your voice from Ralf's.
  - The folder is deleted when the measurement tables exist. You can ask for it to be deleted earlier.
  - You can stop at any time.
Then run again with --consent.`

const argv = process.argv.slice(2)
const has = (name: string): boolean => argv.includes(name)
const value = (name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

if (has('--help') || has('-h')) {
  console.log(HELP)
  process.exit(0)
}
const person = value('--person')
const outArg = value('--out')
if (person === undefined || outArg === undefined || !/^[\p{L}\p{N}_-]+$/u.test(person)) {
  console.error(HELP)
  process.exit(2)
}
const out = resolve(outArg)
if (insideRepo(out, repoRoot)) {
  console.error(`refused: ${out} is inside the repository (${repoRoot}). Recordings are personal data; use a folder outside it, e.g. C:/temp/utle-voice.`)
  process.exit(3)
}
if (!has('--consent')) {
  console.log(CONSENT)
  process.exit(4)
}
const crosstalk = has('--crosstalk')
const prompts: Prompt[] = crosstalk ? promptsFor('command').map((p) => ({ ...p, id: `cross-${p.id}`, kind: 'crosstalk' })) : promptsFor(value('--set') ?? 'all')
const autoSeconds = value('--auto') === undefined ? 0 : Number(value('--auto'))
const fakeMic = value('--fake-mic')
if (has('--headless') && fakeMic === undefined) throw new Error('--headless needs --fake-mic: a person has to see the phrases')

const personDir = join(out, person)
mkdirSync(personDir, { recursive: true })
const labelsFile = join(out, 'labels.tsv')
if (!existsSync(labelsFile)) writeFileSync(labelsFile, `${LABEL_COLUMNS.join('\t')}\n`)

const WORKLET = `class Frames extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true }
}
registerProcessor('frames', Frames)`

const PAGE = `<!doctype html><html lang="et"><meta charset="utf-8"><title>Ütle salvestus</title>
<style>body{font:28px system-ui;margin:40px;background:#111;color:#eee}#t{font-size:48px;margin:40px 0}#s{color:#9c9}.rec{color:#f66!important}</style>
<div id="n"></div><div id="t">…</div><div id="s">Mikrofon avaneb…</div>
<p style="font-size:18px;color:#999">Tühik: alusta ja lõpeta. Tagasilükkeklahv: viimane uuesti. Esc: lõpeta.</p>
<script type="module">
const prompts = await (await fetch('/prompts')).json()
const auto = ${autoSeconds}
const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
const ctx = new AudioContext({ sampleRate: 16000 })
await ctx.audioWorklet.addModule('/worklet.js')
const node = new AudioWorkletNode(ctx, 'frames')
let chunks = null
node.port.onmessage = (e) => { if (chunks) chunks.push(e.data) }
ctx.createMediaStreamSource(media).connect(node); node.connect(ctx.destination); await ctx.resume()
let i = 0
const show = () => { document.getElementById('n').textContent = (i + 1) + ' / ' + prompts.length; document.getElementById('t').textContent = prompts[i] ? prompts[i].text : 'Valmis. Aitäh!'; document.getElementById('s').textContent = 'Vajuta tühikut ja loe ette.'; document.getElementById('s').className = '' }
const start = () => { chunks = []; document.getElementById('s').textContent = 'Salvestan… (tühik lõpetab)'; document.getElementById('s').className = 'rec' }
const stop = async () => {
  const parts = chunks; chunks = null
  const n = parts.reduce((s, p) => s + p.length, 0); const all = new Float32Array(n); let at = 0
  for (const p of parts) { all.set(p, at); at += p.length }
  await fetch('/clip?id=' + encodeURIComponent(prompts[i].id), { method: 'POST', body: all.buffer })
  i += 1; show(); if (i >= prompts.length) await fetch('/done', { method: 'POST' })
}
show()
if (auto > 0) {
  while (i < prompts.length) { start(); await new Promise((r) => setTimeout(r, auto * 1000)); await stop() }
} else {
  addEventListener('keydown', async (e) => {
    if (e.code === 'Space' && i < prompts.length) { e.preventDefault(); if (chunks) await stop(); else start() }
    else if (e.code === 'Backspace' && !chunks && i > 0) { i -= 1; show() }
    else if (e.code === 'Escape') { await fetch('/done', { method: 'POST' }) }
  })
}
</script></html>`

let finish: () => void = () => {}
const finished = new Promise<void>((r) => {
  finish = r
})
const written: string[] = []
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE)
  if (req.method === 'GET' && url.pathname === '/worklet.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(WORKLET)
  if (req.method === 'GET' && url.pathname === '/prompts') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(prompts))
  if (req.method === 'POST' && url.pathname === '/done') {
    res.writeHead(204).end()
    finish()
    return
  }
  if (req.method === 'POST' && url.pathname === '/clip') {
    const prompt = prompts.find((p) => p.id === url.searchParams.get('id'))
    const body: Buffer[] = []
    req.on('data', (c: Buffer) => body.push(c))
    req.on('end', () => {
      if (!prompt) return void res.writeHead(400).end()
      const bytes = Buffer.concat(body)
      const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4)).slice()
      const file = `${person}/${prompt.id}.wav`
      writeFileSync(join(out, file), wavBytes(samples, 16000))
      const durationS = samples.length / 16000
      appendFileSync(labelsFile, formatLabels([{ file, speaker: person, reference: prompt.text, addressee: prompt.addressee, kind: prompt.kind, durationS }]).split('\n')[1] + '\n')
      written.push(file)
      console.log(`${file}  ${durationS.toFixed(2)} s  "${prompt.text}"`)
      res.writeHead(204).end()
    })
    return
  }
  res.writeHead(404).end()
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as AddressInfo).port

const args = ['--autoplay-policy=no-user-gesture-required']
if (fakeMic !== undefined) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve(fakeMic)}%noloop`)
const browser = await chromium.launch({ headless: has('--headless'), args })
const context = await browser.newContext({ permissions: ['microphone'] })
const page = await context.newPage()
page.on('pageerror', (e) => console.error(`page: ${e.message}`))
page.on('close', () => finish())
await page.goto(`http://127.0.0.1:${port}/`)
console.log(`recording ${prompts.length} phrases for "${person}" into ${personDir}${crosstalk ? ' (crosstalk)' : ''}`)
await finished
await browser.close().catch(() => {})
server.close()
console.log(`${written.length} clips written; labels in ${labelsFile}.`)

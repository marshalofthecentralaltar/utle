/**
 * The READ lane's measurement (ARCHITECTURE 29.5): which voices `speechSynthesis.getVoices()` lists
 * in Playwright's Chromium, installed Google Chrome and Microsoft Edge (all headed), whether any has
 * a `lang` starting with `et`, and the time from `speak()` to `onstart` for a 200-word Estonian
 * paragraph, five runs, median, with the Estonian voice if there is one and the default voice if not.
 *
 *   npx tsx scripts/tts-voices.ts                  (all three browsers)
 *   npx tsx scripts/tts-voices.ts --list           (voices only, no latency)
 *   npx tsx scripts/tts-voices.ts --tartunlp       (TartuNLP's public API instead, the fallback's latency)
 *   npx tsx scripts/tts-voices.ts --edge-extension (Ütle loaded into Edge: can it use the Estonian voices?
 *                                                   run `npm run ext` first)
 *
 * Each run is cancelled at `onstart`, so the speaker sounds for a moment only.
 */
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const LIST_ONLY = process.argv.includes('--list')
const TARTUNLP = process.argv.includes('--tartunlp')
const EDGE_EXTENSION = process.argv.includes('--edge-extension')
const RUNS = 5

/** About 200 words of plain Estonian prose, the length the lane brief asks for. */
export const PARAGRAPH =
  'Eesti suvi on lühike, aga see-eest valge ja soe. Juunis paistab päike peaaegu kogu öö ning inimesed ' +
  'sõidavad maale, kus vanaema aed on täis maasikaid ja sõstraid. Lapsed ujuvad järves, käivad metsas ' +
  'mustikal ja jooksevad paljajalu üle niidu. Jaanipäeval tehakse lõkkeid, lauldakse vanu laule ja ' +
  'otsitakse sõnajalaõit, mida keegi pole kunagi leidnud. Juuli on kõige soojem kuu. Siis on rannad ' +
  'rahvast täis, turul müüakse värskeid kurke ja uut kartulit ning õhtuti kostab külades muusikat. ' +
  'Augustis lähevad ööd jälle pimedaks ja taevas võib näha langevaid tähti. Seened kerkivad samblast ' +
  'ja korvid täituvad kukeseente ning puravikega. Septembris algab kool. Lapsed kannavad lilli ' +
  'õpetajale, linnades on liiklus jälle tihe ja hommikud udused. Oktoobris värvuvad vahtrad punaseks ' +
  'ja kased kollaseks, tuul viib lehed tänavatele ning vihma sajab mitu päeva järjest. Novembris on ' +
  'päevad kõige lühemad ja hallid. Inimesed süütavad küünlaid, joovad kuuma teed ja loevad raamatuid. ' +
  'Detsembris tuleb lumi, kui veab, ja jõuluks on aknad täis tulesid. Talv on pikk, kuid kevadel ' +
  'sulab jää, linnud tulevad tagasi ja kõik algab uuesti, nagu igal aastal, alati veidi teistmoodi. ' +
  'Aprillis kuuleb hommikuti kurgede hüüdu ja põldudel hakkab roheline oras tärkama. Mais õitsevad ' +
  'toomingad ja sirelid, aiad lõhnavad magusalt ning inimesed istuvad jälle õues. Nii läheb aasta ' +
  'ringi, aeglaselt ja kiiresti korraga, ja igal aastaajal on oma ilu, mida tasub märgata.'

type Voice = { name: string; lang: string; localService: boolean; default: boolean }

/**
 * Page code (a string, so tsx's `__name` helper never reaches the page) that resolves with the voice
 * list once its length has not changed for 1 s, at most 6 s. Network voices arrive after the local
 * ones: a fixed 3 s poll once saw Chrome's 8 local voices and missed Google's 19.
 */
const WAIT_VOICES = `new Promise((resolve) => {
  const read = () => speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang, localService: v.localService, default: v.default }))
  speechSynthesis.addEventListener('voiceschanged', () => undefined)
  const started = Date.now()
  let count = -1
  let since = started
  const tick = () => {
    const vs = read()
    if (vs.length !== count) { count = vs.length; since = Date.now() }
    if ((count > 0 && Date.now() - since >= 1000) || Date.now() - started >= 6000) resolve(vs)
    else setTimeout(tick, 100)
  }
  tick()
})`

// Playwright passes --disable-component-extensions-with-background-pages, which hides the browser's
// own network voices (Chrome's "Google …", Edge's "… Online (Natural)"). A person's real browser has
// them, so the installed browsers are measured a second time with that flag dropped.
const NETWORK = ['--disable-component-extensions-with-background-pages']
const BROWSERS: { label: string; channel?: string; ignore?: string[] }[] = [
  { label: "Playwright's Chromium" },
  { label: 'Google Chrome', channel: 'chrome' },
  { label: 'Google Chrome, network voices on', channel: 'chrome', ignore: NETWORK },
  { label: 'Microsoft Edge', channel: 'msedge' },
  { label: 'Microsoft Edge, network voices on', channel: 'msedge', ignore: NETWORK },
]

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2
}

async function measure(label: string, channel: string | undefined, ignore: string[] | undefined): Promise<void> {
  let browser
  try {
    browser = await chromium.launch({ headless: false, ...(channel === undefined ? {} : { channel }), ...(ignore === undefined ? {} : { ignoreDefaultArgs: ignore }) })
  } catch (e) {
    console.log(`\n## ${label}: not launched (${String(e).split('\n')[0]})`)
    return
  }
  try {
    const page = await browser.newPage()
    await page.setContent('<!doctype html><html lang="et"><body>tts</body></html>')
    const version = browser.version()
    const voices = (await page.evaluate(WAIT_VOICES)) as Voice[]
    console.log(`\n## ${label} (${version}): ${voices.length} voices`)
    console.log('| lang | name | localService | default |')
    console.log('|---|---|---|---|')
    for (const v of voices) console.log(`| ${v.lang} | ${v.name} | ${v.localService} | ${v.default} |`)
    const et = voices.filter((v) => v.lang.toLowerCase().startsWith('et'))
    console.log(`Estonian (lang starts with "et"): ${et.length === 0 ? 'NONE' : et.map((v) => `${v.name} [${v.lang}]`).join(', ')}`)
    if (LIST_ONLY || voices.length === 0) return

    const chosen = et.find((v) => v.localService) ?? et[0] ?? voices.find((v) => v.default) ?? voices[0]
    if (chosen === undefined) return
    const words = PARAGRAPH.split(/\s+/).length
    const times: number[] = []
    for (let i = 0; i < RUNS; i++) {
      const ms = (await page.evaluate(`new Promise((resolve) => {
        speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(${JSON.stringify(PARAGRAPH)})
        const v = speechSynthesis.getVoices().find((x) => x.name === ${JSON.stringify(chosen.name)})
        if (v !== undefined) { u.voice = v; u.lang = v.lang }
        const t0 = performance.now()
        const timer = setTimeout(() => resolve(-1), 15000)
        u.onstart = () => { clearTimeout(timer); resolve(performance.now() - t0); speechSynthesis.cancel() }
        u.onerror = () => { clearTimeout(timer); resolve(-3) }
        speechSynthesis.speak(u)
      })`)) as number
      times.push(ms)
      await page.waitForTimeout(400)
    }
    const ok = times.filter((t) => t >= 0)
    console.log(
      `Latency speak() -> onstart, ${words} words, voice "${chosen.name}" [${chosen.lang}], ${RUNS} runs: ` +
        `${times.map((t) => (t >= 0 ? t.toFixed(0) : t === -1 ? 'timeout' : 'error')).join(', ')} ms; ` +
        `median ${ok.length > 0 ? median(ok).toFixed(0) : 'n/a'} ms`,
    )
  } finally {
    await browser.close()
  }
}

// --tartunlp: the fallback's numbers. TartuNLP's public API (MIT code, no key) answers a whole wav;
// time to the full answer for the paragraph and for its first sentence (what a sentence-by-sentence
// player would wait for), five runs each, speaker "mari". Measurement only; the product has no TartuNLP path.
async function tartunlp(): Promise<void> {
  const URL = 'https://api.tartunlp.ai/text-to-speech/v2'
  const first = PARAGRAPH.split(/(?<=\.)\s/)[0] ?? PARAGRAPH
  for (const [what, text] of [['first sentence', first], ['whole paragraph', PARAGRAPH]] as const) {
    const times: number[] = []
    let bytes = 0
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now()
      const res = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speaker: 'mari', speed: 1 }),
      })
      const buf = new Uint8Array(await res.arrayBuffer())
      times.push(performance.now() - t0)
      bytes = buf.length
      if (!res.ok) console.log(`HTTP ${res.status}`)
    }
    // 32-bit float mono at 22050 Hz: 88200 bytes a second after the header.
    console.log(
      `TartuNLP ${what} (${text.split(/\s+/).length} words, ${(bytes / 88200).toFixed(1)} s of audio): ` +
        `${times.map((t) => t.toFixed(0)).join(', ')} ms; median ${median(times).toFixed(0)} ms`,
    )
  }
}

// --edge-extension: can Ütle, loaded into Edge, use Edge's Estonian network voices? The built extension
// is copied to a temporary folder; the copy's manifest gains the `tts` permission and a probe page, and
// Edge loads the copy with the network voices on. Three contexts: a web page (the content script's world
// shares the page's `speechSynthesis`), the extension's offscreen document, and `chrome.tts` in the
// service worker. Each lists its `et` voices and speaks one Estonian sentence with Anu three times,
// cancelled at the start event. The repository's manifest is never changed.
const SENTENCE = 'Tere, see on Ütle ja ma loen teile seda lehte ette.'
const ANU = 'Microsoft Anu Online (Natural) - Estonian (Estonia)'
const EDGE_RUNS = 3

/** Page code: the voice count, the `et` voices, and three speak-to-onstart times with Anu. */
const PROBE = `(async () => {
  const voices = await ${WAIT_VOICES}
  const et = voices.filter((v) => v.lang.toLowerCase().startsWith('et')).map((v) => v.name + ' [' + v.lang + ']')
  const times = []
  for (let i = 0; i < ${EDGE_RUNS}; i++) {
    times.push(await new Promise((resolve) => {
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(${JSON.stringify(SENTENCE)})
      const v = speechSynthesis.getVoices().find((x) => x.name === ${JSON.stringify(ANU)})
      if (v === undefined) { resolve('no Anu'); return }
      u.voice = v
      u.lang = v.lang
      const t0 = performance.now()
      const timer = setTimeout(() => resolve('timeout'), 15000)
      u.onstart = () => { clearTimeout(timer); resolve(Math.round(performance.now() - t0)); speechSynthesis.cancel() }
      u.onerror = (e) => { clearTimeout(timer); resolve('error ' + e.error) }
      speechSynthesis.speak(u)
    }))
    await new Promise((r) => setTimeout(r, 400))
  }
  return { count: voices.length, et, times }
})()`

/** Service-worker code: the same through `chrome.tts`. */
const TTS_PROBE = `(async () => {
  if (typeof chrome.tts === 'undefined') return { count: 0, et: [], times: ['no chrome.tts'] }
  let voices = []
  for (let i = 0; i < 30; i++) {
    voices = await chrome.tts.getVoices()
    if (voices.some((v) => (v.lang || '').toLowerCase().startsWith('et'))) break
    await new Promise((r) => setTimeout(r, 200))
  }
  const et = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('et')).map((v) => v.voiceName + ' [' + v.lang + '] remote=' + v.remote)
  const anu = voices.find((v) => v.voiceName === ${JSON.stringify(ANU)})
  const times = []
  for (let i = 0; i < ${EDGE_RUNS}; i++) {
    times.push(await new Promise((resolve) => {
      if (anu === undefined) { resolve('no Anu'); return }
      const t0 = performance.now()
      const timer = setTimeout(() => resolve('timeout'), 15000)
      chrome.tts.speak(${JSON.stringify(SENTENCE)}, {
        voiceName: anu.voiceName,
        lang: anu.lang,
        onEvent: (e) => {
          if (e.type === 'start') { clearTimeout(timer); resolve(Math.round(performance.now() - t0)); chrome.tts.stop() }
          else if (e.type === 'error') { clearTimeout(timer); resolve('error ' + e.errorMessage) }
        },
      })
    }))
    await new Promise((r) => setTimeout(r, 400))
  }
  return { count: voices.length, et, times }
})()`

/** The offscreen document: opened from the worker, it answers through a message the worker waits for. */
const OFFSCREEN_PROBE = `(async () => {
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  if (open.length > 0) await chrome.offscreen.closeDocument()
  const got = new Promise((resolve) => {
    const on = (m) => { if (m && m.utleProbe !== undefined) { chrome.runtime.onMessage.removeListener(on); resolve(m.utleProbe) } }
    chrome.runtime.onMessage.addListener(on)
    setTimeout(() => resolve('no answer in 30 s'), 30000)
  })
  await chrome.offscreen.createDocument({ url: 'probe.html', reasons: ['AUDIO_PLAYBACK'], justification: 'voice probe' })
  return got
})()`

type Probe = { count: number; et: string[]; times: (number | string)[] }

function row(context: string, p: Probe | string): void {
  if (typeof p === 'string') {
    console.log(`| ${context} | ${p} | | |`)
    return
  }
  const ms = p.times.filter((t): t is number => typeof t === 'number')
  console.log(
    `| ${context} | ${p.count} voices; et: ${p.et.length === 0 ? 'NONE' : p.et.join(', ')} | ${p.times.join(', ')} | ${ms.length > 0 ? `${median(ms)} ms` : 'n/a'} |`,
  )
}

async function edgeExtension(): Promise<void> {
  const source = resolve('extension')
  const dir = await mkdtemp(join(tmpdir(), 'utle-edge-ext-'))
  await cp(source, dir, { recursive: true, filter: (p) => !p.startsWith(join(source, 'src')) && !p.startsWith(join(source, 'test')) })
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { permissions: string[] }
  manifest.permissions.push('tts')
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await writeFile(join(dir, 'probe.html'), '<!doctype html><meta charset="utf-8"><script src="probe.js"></script>')
  await writeFile(
    join(dir, 'probe.js'),
    `window.probeResult = ${PROBE}\nwindow.probeResult.then((r) => chrome.runtime.sendMessage({ utleProbe: r })).catch((e) => chrome.runtime.sendMessage({ utleProbe: String(e) }))\n`,
  )
  const profile = await mkdtemp(join(tmpdir(), 'utle-edge-profile-'))
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless: false,
    ignoreDefaultArgs: NETWORK,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  })
  try {
    console.log(`\n## Ütle loaded into Microsoft Edge, network voices on: "${SENTENCE}" with Anu, ${EDGE_RUNS} runs`)
    // With component extensions on, Edge's own workers start too: wait for Ütle's.
    const ours = (u: string): boolean => u.endsWith('/dist/background.js')
    const sw =
      context.serviceWorkers().find((w) => ours(w.url())) ??
      (await context.waitForEvent('serviceworker', { predicate: (w) => ours(w.url()), timeout: 20000 }).catch(() => null))
    if (sw === null) {
      console.log(`Ütle's service worker never started: Edge did not load the unpacked extension (workers: ${context.serviceWorkers().map((w) => w.url()).join(', ')})`)
      return
    }
    console.log(`extension service worker: ${sw.url()}`)
    console.log('| context | getVoices() | speak() to onstart, ms | median |')
    console.log('|---|---|---|---|')
    const page = await context.newPage()
    await page.setContent('<!doctype html><html lang="et"><body>web page</body></html>')
    row('(a) web page (the content script shares its speechSynthesis)', (await page.evaluate(PROBE)) as Probe)
    row('(b) offscreen document (AUDIO_PLAYBACK)', (await sw.evaluate(OFFSCREEN_PROBE)) as Probe | string)
    row('(c) chrome.tts in the service worker (tts permission, copy only)', (await sw.evaluate(TTS_PROBE)) as Probe)
  } finally {
    await context.close()
  }
}

if (TARTUNLP) await tartunlp()
else if (EDGE_EXTENSION) await edgeExtension()
else for (const b of BROWSERS) await measure(b.label, b.channel, b.ignore)

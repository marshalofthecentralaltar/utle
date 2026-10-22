/**
 * The READ lane's measurement (ARCHITECTURE 29.5): which voices `speechSynthesis.getVoices()` lists
 * in Playwright's Chromium, installed Google Chrome and Microsoft Edge (all headed), whether any has
 * a `lang` starting with `et`, and the time from `speak()` to `onstart` for a 200-word Estonian
 * paragraph, five runs, median, with the Estonian voice if there is one and the default voice if not.
 *
 *   npx tsx scripts/tts-voices.ts            (all three browsers)
 *   npx tsx scripts/tts-voices.ts --list     (voices only, no latency)
 *   npx tsx scripts/tts-voices.ts --tartunlp (TartuNLP's public API instead, the fallback's latency)
 *
 * Each run is cancelled at `onstart`, so the speaker sounds for a moment only.
 */
import { chromium } from 'playwright'

const LIST_ONLY = process.argv.includes('--list')
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
    // Voices load asynchronously: poll up to 3 s. The page code is a string, so tsx's `__name`
    // helper never reaches the page.
    const voices = (await page.evaluate(`new Promise((resolve) => {
      const read = () => speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang, localService: v.localService, default: v.default }))
      const started = Date.now()
      speechSynthesis.addEventListener('voiceschanged', () => undefined)
      const tick = () => {
        const vs = read()
        if ((vs.length > 0 && Date.now() - started > 1000) || Date.now() - started > 3000) resolve(vs)
        else setTimeout(tick, 100)
      }
      tick()
    })`)) as Voice[]
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

if (!process.argv.includes("--tartunlp")) for (const b of BROWSERS) await measure(b.label, b.channel, b.ignore)

// --tartunlp: the fallback's numbers. TartuNLP's public API (MIT code, no key) answers a whole wav;
// time to the full answer for the paragraph and for its first sentence (what a sentence-by-sentence
// player would wait for), five runs each, speaker "mari". Measurement only; the product has no TartuNLP path.
if (process.argv.includes('--tartunlp')) {
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

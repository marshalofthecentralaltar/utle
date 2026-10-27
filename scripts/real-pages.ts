/**
 * What Ütle sees on real public Estonian pages (docs/ARCHITECTURE.md 30.4). Read only: no login, no
 * typing into a site's field, no submitting; the only click is a cookie-consent button.
 *
 *   npx tsx scripts/real-pages.ts            all eight pages
 *   npx tsx scripts/real-pages.ts err delfi  only those rows (the table keeps the other rows' last values)
 *
 * Builds the extension, loads it in Playwright's Chromium (headed, as extension/test/run.ts does),
 * and runs the product's own page code through the service worker exactly as background.ts
 * runInPage does. Writes docs/proof/r9-real-pages.md (the table; anything after the line
 * "<!-- fixes -->" in the old file is kept), docs/proof/r9-real-pages.json and one
 * docs/proof/r9-real-<site>.png per page.
 */
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Frame, Page, Worker } from 'playwright'
import { buildExtension } from './ext.ts'
import { SEARCH_FIELDS } from '../extension/src/sites.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const extensionDir = join(repoRoot, 'extension')
const proof = join(repoRoot, 'docs/proof')
const WIDTH = 1280
const HEIGHT = 900
const SETTLE_MS = 3000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()

type Item = { id: number; role: string; text: string }
type Reading = { text: string; sentences: string[] }
type Answer = { ok: boolean; code?: string; message?: string; page?: { items: Item[] }; reading?: Reading }
type Rect = { left: number; top: number; width: number; height: number }

interface SiteSpec {
  key: string
  url: string
  /** YouTube and Google: the SEARCH_FIELDS entry to test. */
  search?: string
  /** The watch page: check #movie_player. */
  player?: boolean
  /** News: the first link on the front page whose address matches is the article. */
  article?: RegExp
  /** News: words of the site's chrome that must not be in the article's first three sentences. */
  nav?: string[]
}

const NAV_COMMON = ['Logi sisse', 'Logi välja', 'Tellimus', 'Telli', 'Tellijale', 'Menüü', 'Otsi', 'Uudiskiri', 'Küpsis', 'Kommentaarid', 'Jaga', 'Loe ka', 'Loe veel', 'Seotud', 'Reklaam']

const SITES: SiteSpec[] = [
  { key: 'youtube', url: 'https://www.youtube.com', search: 'youtube.com' },
  { key: 'youtube-watch', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', player: true, search: 'youtube.com' },
  { key: 'google', url: 'https://www.google.ee', search: 'google.ee' },
  { key: 'postimees', url: 'https://www.postimees.ee', article: /^https:\/\/[a-z]+\.postimees\.ee\/\d{6,}\/[a-z0-9-]+/, nav: [...NAV_COMMON, 'Postimees Grupp', 'Tellijana', 'Telli Postimees', 'Digipakett'] },
  { key: 'delfi', url: 'https://www.delfi.ee', article: /^https:\/\/[a-z]+\.delfi\.ee\/(artikkel\/)?\d{6,}\/[a-z0-9-]+/, nav: [...NAV_COMMON, 'Ekspress Meedia'] },
  { key: 'err', url: 'https://www.err.ee', article: /^https:\/\/(www|novaator|kultuur|sport|menu|eestielu)\.err\.ee\/\d{6,}\/[a-z0-9-]+/, nav: [...NAV_COMMON, 'Saatekava', 'Arhiiv'] },
  { key: 'ilmateenistus', url: 'https://www.ilmateenistus.ee' },
  { key: 'otse-err', url: 'https://otse.err.ee' },
]

interface Row {
  key: string
  url: string
  status: string
  banner: string
  bannerDetail: string
  firstItems: string[]
  items: string
  itemsBefore: number | null
  accepted: string
  search: string
  player: string
  article: string
  articleUrl: string
  sentences: string[]
  sentenceCount: number | null
  articleOk: string
  strip: string
  under: string
}

/** The consent layer on screen, in any frame: a dialog or a fixed layer that says so, or a frame of a consent manager. */
const CONSENT_PROBE = `(() => {
  const words = /cookie|küpsis|nõustu|consent|privaatsus|privacy|nõusolek/i
  const vw = innerWidth, vh = innerHeight
  const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw }
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('utle-strip, utle-hints')) continue
    const s = getComputedStyle(el)
    const layer = s.position === 'fixed' || el.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]')
    if (!layer || !shown(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width * r.height < vw * vh * 0.02) continue
    const text = (el.innerText || '').slice(0, 3000)
    if (!words.test(text)) continue
    if (out.some((o) => o.el.contains(el))) continue
    out.push({ el, desc: el.localName + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' pos=' + s.position + ' z=' + s.zIndex + ' area=' + Math.round(100 * r.width * r.height / (vw * vh)) + '%' })
  }
  const frames = []
  for (const f of document.querySelectorAll('iframe')) {
    if (!shown(f)) continue
    const r = f.getBoundingClientRect()
    const src = f.getAttribute('src') || ''
    if (r.width * r.height >= vw * vh * 0.02 && /consent|cmp|sourcepoint|didomi|cookie|privacy|onetrust|usercentrics|quantcast/i.test(src + ' ' + (f.id || '') + ' ' + (f.title || ''))) frames.push('iframe ' + src.slice(0, 80) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
  }
  return { layers: out.map((o) => o.desc), frames }
})()`

/** The accept buttons: the page's own words for "accept all", in any frame. */
const ACCEPT = /^\s*(nõustun kõigi küpsistega|nõustu kõigiga|nõustun kõigiga|nõustu kõikidega|nõustun|nõustu|luba kõik|aktsepteeri kõik|aktsepteeri|accept all|accept|agree|i agree|olen nõus|kinnitan|sain aru)\s*$/i

/**
 * Clicks the consent layer's accept button with Playwright's real pointer. When the pointer cannot
 * reach it (something lies over it, the strip for instance) that is recorded, and the button is
 * then clicked by script so the measurement can go on.
 */
async function acceptConsent(page: Page): Promise<string> {
  for (const frame of page.frames()) {
    const found = (await frame
      .evaluate(`(() => {
        const re = ${ACCEPT.toString()}
        const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
        const all = [...document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]')]
        const el = all.find((b) => shown(b) && re.test((b.innerText || b.value || b.getAttribute('aria-label') || '').trim()))
        if (!el) return null
        el.setAttribute('data-utle-accept', '1')
        const r = el.getBoundingClientRect()
        return { label: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim(), top: Math.round(r.top), bottom: Math.round(r.bottom) }
      })()`)
      .catch(() => null)) as { label: string; top: number; bottom: number } | null
    if (found) {
      const where = `${found.label}${frame === page.mainFrame() ? '' : ` (in frame ${new URL(frame.url()).hostname})`}, button y ${found.top} to ${found.bottom}`
      try {
        await frame.click('[data-utle-accept="1"]', { timeout: 4000 })
        await sleep(2000)
        return `${where}, clicked by the pointer`
      } catch (error) {
        const why = error instanceof Error ? (/(<[^>]+>[^\n]*intercepts pointer events)/.exec(error.message)?.[1] ?? error.message.split('\n')[0] ?? '') : String(error)
        await frame.evaluate(`document.querySelector('[data-utle-accept="1"]').click()`).catch(() => undefined)
        await sleep(2000)
        return `${where}, the pointer could not click it (${why.slice(0, 120)}); clicked by script`
      }
    }
  }
  return ''
}

async function consentOnScreen(page: Page): Promise<{ layers: string[]; frames: string[]; inFrames: string[] }> {
  const main = (await page.evaluate(CONSENT_PROBE).catch(() => ({ layers: [], frames: [] }))) as { layers: string[]; frames: string[] }
  const inFrames: string[] = []
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    const has = await frame.evaluate(`(() => { const t = (document.body && document.body.innerText || '').slice(0, 5000); return /küpsis|cookie|nõusolek|consent/i.test(t) && /nõustu|accept|luba|aktsepteeri/i.test(t) })()`).catch(() => false)
    if (has === true && (await frameShown(frame))) inFrames.push(new URL(frame.url()).hostname)
  }
  return { ...main, inFrames }
}

async function frameShown(frame: Frame): Promise<boolean> {
  const el = await frame.frameElement().catch(() => null)
  if (!el) return false
  const box = await el.boundingBox().catch(() => null)
  return box !== null && box.width * box.height > WIDTH * HEIGHT * 0.02
}

async function main(): Promise<void> {
  const only = process.argv.slice(2)
  // --table: write the table again from the last JSON, without opening a page.
  if (only.includes('--table')) return writeTable([])
  await buildExtension()
  const profile = await mkdtemp(join(tmpdir(), 'utle-real-'))
  const rows: Row[] = []
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: false,
    viewport: { width: WIDTH, height: HEIGHT },
    locale: 'et-EE',
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  })
  try {
    const sw: Worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    await sleep(2000)
    const page = context.pages().find((p) => p.url().startsWith('about:')) ?? (await context.newPage())
    for (const p of context.pages()) if (p !== page) await p.close().catch(() => undefined)

    /** A page command through the service worker, the way background.ts runInPage sends it. */
    // Strings, not functions: tsx's helpers (__name) do not exist in the worker or the page.
    const TAB = `(await chrome.tabs.query({})).find((t) => /^https?:/.test(t.url || ''))`
    /** A page command through the service worker, the way background.ts runInPage sends it. */
    const run = async (command: Record<string, unknown>): Promise<Answer> =>
      (await sw.evaluate(`(async () => {
        const tab = ${TAB}
        if (!tab || tab.id === undefined) return { ok: false, code: 'failed', message: 'no http tab' }
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['dist/page.js'] })
        const [frame] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (c) => (globalThis.__utle ? globalThis.__utle.run(c) : { ok: false, code: 'failed', message: 'The page script is missing.' }),
          args: [${JSON.stringify({ ...command, site: null })}],
        })
        return (frame && frame.result) || { ok: false, code: 'failed', message: 'no answer' }
      })()`)) as Answer
    const stripRect = async (): Promise<Rect | null> =>
      (await sw.evaluate(`(async () => {
        const tab = ${TAB}
        if (!tab || tab.id === undefined) return null
        const m = await chrome.tabs.sendMessage(tab.id, { type: 'utle-strip-measure' }).catch(() => null)
        return (m && m.strip) || null
      })()`)) as Rect | null

    const go = async (url: string): Promise<string> => {
      try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
        await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => undefined)
        await sleep(SETTLE_MS)
        const status = res?.status() ?? 0
        const text = norm(((await page.evaluate('document.body ? document.body.innerText.slice(0, 2000) : ""').catch(() => '')) as string))
        if (status === 403 || status === 429 || /captcha|unusual traffic|access denied|are you a robot|cloudflare/i.test(text)) return `blocked (HTTP ${status})`
        return `ok (HTTP ${status})`
      } catch (error) {
        return `failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
      }
    }

    for (const spec of SITES) {
      if (only.length > 0 && !only.includes(spec.key)) continue
      console.log(`\n=== ${spec.key} ${spec.url}`)
      const row: Row = { key: spec.key, url: spec.url, status: '', banner: '', bannerDetail: '', firstItems: [], items: '', itemsBefore: null, accepted: '', search: 'n/a: not a search site', player: 'n/a: not a watch page', article: 'n/a: not a news site', articleUrl: '', sentences: [], sentenceCount: null, articleOk: 'n/a: not a news site', strip: '', under: '' }
      rows.push(row)
      row.status = await go(spec.url)
      row.url = page.url()
      console.log(`status ${row.status} at ${row.url}`)
      if (!row.status.startsWith('ok')) {
        const reason = `n/a: ${row.status}`
        Object.assign(row, { banner: reason, items: reason, strip: reason, under: reason })
        if (spec.search) row.search = reason
        if (spec.player) row.player = reason
        if (spec.article) row.article = row.articleOk = reason
        await page.screenshot({ path: join(proof, `r9-real-${spec.key}.png`) }).catch(() => undefined)
        continue
      }

      // 1. The banner, before any click.
      const consent = await consentOnScreen(page)
      const before = await run({ kind: 'readPage' })
      const itemsBefore = before.page?.items ?? []
      row.itemsBefore = itemsBefore.length
      row.firstItems = itemsBefore.slice(0, 6).map((i) => `${i.role}:${i.text}`)
      const onScreen = consent.layers.length + consent.frames.length + consent.inFrames.length > 0
      const dialogCount = itemsBefore.filter((i) => i.text.startsWith('[dialog] ')).length
      const dialogFirst = dialogCount > 0 && itemsBefore.every((i, k) => i.text.startsWith('[dialog] ') === k < dialogCount)
      row.banner = !onScreen ? (dialogCount > 0 ? `none (but ${dialogCount} [dialog] items)` : 'none') : dialogFirst ? `yes (${dialogCount} [dialog] items)` : 'no'
      row.bannerDetail = [...consent.layers, ...consent.frames, ...consent.inFrames.map((h) => `frame ${h}`)].join('; ')
      console.log(`consent ${JSON.stringify(consent)}`)
      console.log(`readPage before: ok=${before.ok} ${itemsBefore.length} items, first: ${JSON.stringify(row.firstItems)}`)
      await page.screenshot({ path: join(proof, `r9-real-${spec.key}.png`) })

      if (onScreen || dialogCount > 0) {
        row.accepted = await acceptConsent(page)
        console.log(`accepted: ${JSON.stringify(row.accepted)}`)
        // YouTube reloads the page after the consent.
        await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => undefined)
        await sleep(2000)
      }
      const after = await run({ kind: 'readPage' })
      const itemsAfter = after.page?.items ?? []
      row.items = after.ok ? String(itemsAfter.length) : `n/a: readPage ${after.code}: ${after.message}`
      console.log(`readPage after: ${itemsAfter.length} items; [dialog] left ${itemsAfter.filter((i) => i.text.startsWith('[dialog] ')).length}; first 12: ${JSON.stringify(itemsAfter.slice(0, 12).map((i) => `${i.role}:${i.text}`))}`)

      // 2. The search field (only the DOM is queried, nothing typed).
      if (spec.search) {
        const selector = SEARCH_FIELDS[spec.search] ?? ''
        const parts = selector.split(',').map((s) => s.trim())
        const hits = (await page.evaluate(`(() => {
          const out = []
          for (const sel of ${JSON.stringify(parts)}) {
            const els = [...document.querySelectorAll(sel)]
            const shown = els.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' })
            out.push({ sel, all: els.length, shown: shown.length, tag: shown[0] ? shown[0].outerHTML.slice(0, 160) : '' })
          }
          return out
        })()`)) as Array<{ sel: string; all: number; shown: number; tag: string }>
        const hit = hits.find((h) => h.shown > 0)
        row.search = hit ? `yes: \`${hit.sel}\`` : `no (${hits.map((h) => `${h.sel}: ${h.all} in DOM, ${h.shown} visible`).join('; ')})`
        console.log(`search ${JSON.stringify(hits)}`)
      }

      // 3. The player.
      if (spec.player) {
        const p = (await page.evaluate(`(() => { const m = document.querySelector('#movie_player'); return { player: m !== null, video: m !== null && m.querySelector('video') !== null, cls: m ? String(m.className).slice(0, 80) : '' } })()`)) as { player: boolean; video: boolean; cls: string }
        row.player = p.player ? (p.video ? 'yes, holds the <video>' : 'yes, without a <video>') : 'no'
        const media = await run({ kind: 'readPage' })
        const current = (media.page?.items ?? []).some((i) => i.text === 'praegune video')
        row.player += current ? '; readPage lists "praegune video"' : '; readPage has no "praegune video"'
        console.log(`player ${JSON.stringify(p)} current=${current}`)
      }

      // 4. The strip: is it the top element along its middle line; which page bars are under it.
      const strip = await stripRect()
      if (!strip) {
        row.strip = 'n/a: the strip did not answer'
        row.under = 'n/a'
      } else {
        const s = (await page.evaluate(`(() => {
          const r = ${JSON.stringify(strip)}
          const y = r.top + r.height / 2
          const xs = [0.05, 0.25, 0.5, 0.75, 0.95].map((f) => r.left + r.width * f)
          const desc = (el) => el.localName + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/)[0] : '')
          const fixedOf = (el) => { for (let at = el; at && at !== document.documentElement; at = at.parentElement) { const p = getComputedStyle(at).position; if (p === 'fixed' || p === 'sticky') return at } return null }
          const covered = []
          const under = new Set()
          for (const x of xs) {
            const stack = document.elementsFromPoint(x, y)
            const top = stack[0]
            if (top && top.localName !== 'utle-strip') covered.push(Math.round(x) + ':' + desc(top))
            for (const el of stack.slice(1)) {
              if (el.localName === 'utle-strip' || el === document.body || el === document.documentElement) continue
              const f = fixedOf(el)
              if (f) under.add(desc(f))
            }
          }
          return { y: Math.round(y), covered, under: [...under] }
        })()`)) as { y: number; covered: string[]; under: string[] }
        row.strip = s.covered.length === 0 ? `no (strip top ${Math.round(strip.top)}, height ${Math.round(strip.height)})` : `yes: ${s.covered.join(', ')}`
        row.under = s.under.length === 0 ? 'none' : s.under.join(', ')
        console.log(`strip ${JSON.stringify(strip)} ${JSON.stringify(s)}`)
      }

      // 5. The article (news): the first article link of the front page, opened by its address.
      if (spec.article && spec.nav) {
        const links = (await page.evaluate(`[...document.querySelectorAll('a[href]')].map((a) => a.href)`)) as string[]
        // UTLE_ARTICLE_<site>=<address> reads that article instead (to see a fixed fault on the page it was seen on).
        const target = process.env[`UTLE_ARTICLE_${spec.key}`] ?? links.find((h) => spec.article?.test(h))
        if (!target) {
          row.article = row.articleOk = `n/a: no article link matched ${spec.article.source}`
        } else {
          row.articleUrl = target
          const st = await go(target)
          console.log(`article ${target}: ${st}`)
          if (!st.startsWith('ok')) row.article = row.articleOk = `n/a: ${st}`
          else {
            const late = await consentOnScreen(page)
            if (late.layers.length + late.frames.length + late.inFrames.length > 0) console.log(`consent again on the article: ${JSON.stringify(late)} accepted: ${await acceptConsent(page)}`)
            const read = await run({ kind: 'read', what: 'page' })
            const sentences = read.reading?.sentences ?? []
            row.sentences = sentences.slice(0, 3)
            row.sentenceCount = sentences.length
            const h1 = norm(((await page.evaluate(`(() => { const all = [...document.querySelectorAll('h1')].filter((h) => h.getBoundingClientRect().height > 0); const inMain = all.find((h) => h.closest('article, main, [role="main"]')); return (inMain || all[0] || { innerText: '' }).innerText })()`)) as string))
            const first = norm(sentences[0] ?? '')
            const headline = first !== '' && h1 !== '' && h1.startsWith(first.replace(/[.!?…]+$/u, ''))
            const navHit = spec.nav.filter((w) => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, 'iu').test(row.sentences.join(' ')))
            row.article = `${sentences.length} sentences`
            const key = (t: string): string => norm(t).toLowerCase().replace(/[.!?…]+$/u, '')
            const twice = row.sentences.length > 1 && key(row.sentences[0] ?? '') === key(row.sentences[1] ?? '')
            row.articleOk = headline && navHit.length === 0 && !twice ? 'article ok' : `article FAULT: ${headline ? '' : `first sentence is not the h1 ("${h1.slice(0, 80)}")`}${navHit.length > 0 ? ` nav words ${navHit.join(', ')}` : ''}${twice ? ' the headline is read twice' : ''}`
            console.log(`${row.articleOk === 'article ok' ? 'article ok' : row.articleOk} ${spec.key}: h1=${JSON.stringify(h1)} first three=${JSON.stringify(row.sentences)}`)
            await page.screenshot({ path: join(proof, `r9-real-${spec.key}-article.png`) })
          }
        }
      }
    }
  } finally {
    await context.close().catch(() => undefined)
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
  await writeTable(rows)
}

/** The accept button's line, short: reachable, or under the strip (where a pointer or dwell cannot click it). */
const acceptCell = (accepted: string): string => {
  if (accepted === '') return 'n/a: no consent layer at load'
  const label = accepted.split(',')[0] ?? ''
  const y = /button y (\d+ to \d+)/.exec(accepted)?.[1] ?? '?'
  return accepted.includes('could not') ? `FAULT: "${label}" at y ${y} is under the strip, the pointer cannot click it` : `"${label}" at y ${y}, the pointer clicked it`
}

const cell = (s: string): string => norm(s).replace(/\|/g, '\\|')

async function writeTable(fresh: Row[]): Promise<void> {
  const jsonPath = join(proof, 'r9-real-pages.json')
  const old: Row[] = existsSync(jsonPath) ? (JSON.parse(await readFile(jsonPath, 'utf8')) as Row[]) : []
  const rows = SITES.map((s) => fresh.find((r) => r.key === s.key) ?? old.find((r) => r.key === s.key)).filter((r): r is Row => r !== undefined)
  await writeFile(jsonPath, `${JSON.stringify(rows, null, 2)}\n`)
  const mdPath = join(proof, 'r9-real-pages.md')
  const kept = existsSync(mdPath) ? (await readFile(mdPath, 'utf8')).split('<!-- fixes -->')[1] ?? '' : ''
  const lines = [
    '# What Ütle sees on real public pages (round 9, REALPAGES)',
    '',
    `Written by \`npx tsx scripts/real-pages.ts\`, last run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, Playwright Chromium ${WIDTH}x${HEIGHT}, locale et-EE, a fresh profile, no login. Method and columns: docs/ARCHITECTURE.md 30.4.`,
    '',
    '| site | page | banner first (readPage before any click) | items (after accepting) | search field (SEARCH_FIELDS) | #movie_player | article (`loe ette`) | headline, no nav | strip covered | page bars under the strip | accept button and the pointer |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.key} | ${cell(r.url)} | ${cell(r.banner)} | ${cell(r.items)} | ${cell(r.search)} | ${cell(r.player)} | ${cell(r.article)} | ${cell(r.articleOk)} | ${cell(r.strip)} | ${cell(r.under)} | ${cell(acceptCell(r.accepted))} |`),
    '',
    '## Detail per site',
    '',
    ...rows.flatMap((r) => [
      `### ${r.key}`,
      '',
      `- Load: ${r.status}. Screenshot: \`docs/proof/r9-real-${r.key}.png\`${r.articleUrl ? `, article \`docs/proof/r9-real-${r.key}-article.png\`` : ''}.`,
      `- Consent layer seen: ${r.bannerDetail || 'none'}. Accepted with: ${r.accepted || 'nothing clicked'}.`,
      `- readPage before any click: ${r.itemsBefore ?? 'n/a'} items; the first six: ${r.firstItems.length > 0 ? r.firstItems.map((t) => `\`${cell(t)}\``).join(', ') : 'n/a'}.`,
      ...(r.articleUrl ? [`- Article: ${r.articleUrl}, ${r.sentenceCount ?? 0} sentences. The first three:`, ...r.sentences.map((s, k) => `  ${k + 1}. ${cell(s)}`)] : []),
      '',
    ]),
    '<!-- fixes -->',
  ]
  await writeFile(mdPath, `${lines.join('\n')}${kept === '' ? '\n' : kept}`)
  console.log(`\nwrote ${mdPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

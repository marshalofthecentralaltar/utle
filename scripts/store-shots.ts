/**
 * The five Chrome Web Store screenshots (ARCHITECTURE 30.6), 1280×800 each, into extension/store/.
 * The built extension on a fresh profile, the suite's stand-in pages only: no real site, no login.
 *
 *   npx tsx scripts/store-shots.ts
 *
 * Builds the extension first. Uses port 5185 (STORE_SHOTS_PORT to change it).
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { buildExtension } from './ext.ts'
import { driver, launch, pngSize, repoRoot, waitUntil } from './ext-harness.ts'
import type { BridgeResult, Harness } from './ext-harness.ts'
import { initialInpage, inpageStep } from '../src/core/inpage.ts'
import { STRINGS } from '../src/core/strings.ts'

/* The browser's API, as far as the callbacks below use it (this file is compiled without the chrome and DOM types). */
declare const chrome: {
  runtime: { getURL: (path: string) => string }
  storage: {
    local: { set: (items: Record<string, unknown>) => Promise<void> }
    session: { get: (key: string) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void> }
  }
  tabs: { query: (q: Record<string, never>) => Promise<Array<{ id?: number; url?: string; pendingUrl?: string }>>; remove: (id: number) => Promise<void> }
}
declare const document: { getElementById: (id: string) => { readyState?: number; click: () => void; scrollIntoView: (o: { block: string }) => void } | null }
declare const window: { scrollTo: (x: number, y: number) => void; scrollBy: (x: number, y: number) => void }

const PORT = Number(process.env.STORE_SHOTS_PORT ?? 5185)
const SIZE = { width: 1280, height: 800 }
const OUT = join(repoRoot, 'extension', 'store')
const NOBOX = { present: false, text: '', armed: false }
const MESSAGE = 'Tere, Mari! Jõuan homme kell kolm.'

const fromWords = (words: string): unknown => inpageStep(initialInpage('et'), words, NOBOX).commands[0]

function ok(r: BridgeResult, what: string): void {
  if (r === 'timeout' || !r.ok) throw new Error(`${what}: ${r === 'timeout' ? 'no answer' : `${r.code}: ${r.message}`}`)
}

async function pageWhere(h: Harness, test: (url: string) => boolean): Promise<Page> {
  await waitUntil(async () => h.ctx.pages().some((p) => test(p.url())), 8000)
  const page = h.ctx.pages().find((p) => test(p.url()))
  if (!page) throw new Error('page not found')
  await page.waitForLoadState('load')
  return page
}

const written: string[] = []

async function shoot(page: Page, name: string): Promise<void> {
  await page.bringToFront()
  await page.waitForTimeout(600)
  const path = join(OUT, name)
  await page.screenshot({ path })
  written.push(path)
}

async function main(): Promise<void> {
  await buildExtension()
  mkdirSync(OUT, { recursive: true })
  const h = await launch(join(repoRoot, 'extension'), PORT, SIZE)
  try {
    // 3. The welcome page opens by itself on install.
    const welcomeBase = await h.sw.evaluate(() => chrome.runtime.getURL('welcome.html'))
    const welcome = await pageWhere(h, (u) => u.startsWith(welcomeBase))
    await welcome.waitForTimeout(1500)
    // The page moves on to the first open card by itself; the shot shows it from the top.
    await welcome.evaluate(() => window.scrollTo(0, 0))
    await shoot(welcome, '3-welcome.png')
    await welcome.close()

    const first = h.ctx.pages()[0] ?? (await h.ctx.newPage())
    await first.goto(`${h.base}/page-one.html`)
    const d = await driver(h, PORT)

    // 1. The WhatsApp stand-in: Mari's chat open, the message in the box, the strip showing the words.
    await h.sw.evaluate((prefix) => chrome.storage.local.set({ siteOverrides: { [prefix]: 'whatsapp' } }), `${h.base}/whatsapp`)
    ok(await d.send({ kind: 'goTo', url: `${h.base}/whatsapp.html` }), 'goTo whatsapp')
    ok(await d.send({ kind: 'openConversation', name: 'Marile' }), 'openConversation')
    ok(await d.send({ kind: 'setText', text: MESSAGE }), 'setText')
    const wa = await pageWhere(h, (u) => u === `${h.base}/whatsapp.html`)
    await h.sw.evaluate(
      async (patch) => {
        const now = (await chrome.storage.session.get('stripState')).stripState as Record<string, unknown> | undefined
        await chrome.storage.session.set({ stripState: { ...now, ...patch } })
      },
      { listening: true, connection: 'connected', problem: '', heard: 'tere mari jõuan homme kell kolm', line: STRINGS.et.promptDraft },
    )
    await shoot(wa, '1-message.png')
    await h.sw.evaluate(async () => {
      const now = (await chrome.storage.session.get('stripState')).stripState as Record<string, unknown> | undefined
      await chrome.storage.session.set({ stripState: { ...now, listening: false, heard: '', line: '' } })
    })

    // 2. The video stand-in with the numbered labels.
    ok(await d.send({ kind: 'goTo', url: `${h.base}/video.html` }), 'goTo video')
    const video = await pageWhere(h, (u) => u === `${h.base}/video.html`)
    await video.waitForFunction(() => (document.getElementById('v')?.readyState ?? 0) >= 2)
    await video.evaluate(() => document.getElementById('cookie-accept')?.click())
    ok(await d.send(fromWords('näita numbreid')), 'näita numbreid')
    await shoot(video, '2-numbers.png')
    ok(await d.send({ kind: 'hideHints' }), 'hideHints')

    // 4. The settings page.
    const options = await h.ctx.newPage()
    await options.goto(await h.sw.evaluate(() => chrome.runtime.getURL('options.html')))
    await options.waitForLoadState('load')
    // The Server section, the part a helper fills in.
    await options.evaluate(() => document.getElementById('server')?.scrollIntoView({ block: 'start' }))
    await shoot(options, '4-settings.png')
    await options.close()

    // 5. The help page, by "abi": the first group (Sõnumid) open.
    ok(await d.send(fromWords('abi')), 'abi')
    const helpBase = await h.sw.evaluate(() => chrome.runtime.getURL('help.html'))
    const help = await pageWhere(h, (u) => u.startsWith(helpBase))
    await help.waitForSelector('#open h2')
    // The open group's phrases, with the last rows of groups above them.
    await help.evaluate(() => {
      document.getElementById('open')?.scrollIntoView({ block: 'start' })
      window.scrollBy(0, -260)
    })
    await shoot(help, '5-help.png')
  } finally {
    await h.close()
  }

  let bad = 0
  for (const path of written) {
    const { width, height } = pngSize(readFileSync(path))
    const right = width === SIZE.width && height === SIZE.height
    if (!right) bad++
    console.log(`${right ? 'OK  ' : 'BAD '} ${width}x${height}  ${path}`)
  }
  if (written.length !== 5) bad++
  console.log(bad === 0 ? `five screenshots, each ${SIZE.width}x${SIZE.height}` : `${bad} problem(s)`)
  process.exitCode = bad === 0 ? 0 : 1
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

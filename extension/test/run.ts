// End-to-end test of the extension in Playwright's bundled Chromium.
// Run from the repository root: npx tsx extension/test/run.ts
//
// The fake Ütle page is served at http://localhost:5183 (the configured Ütle origin) and the
// target pages at http://127.0.0.1:5183, a different origin on the same server.

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { BrowserContext, Page, Worker } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const extensionDir = resolve(here, '..')
const repoRoot = resolve(extensionDir, '..')
const PORT = 5183
const UTLE = `http://localhost:${PORT}/fixtures/utle.html`
const T = `http://127.0.0.1:${PORT}/fixtures`
// The messaging site: another origin on the same server (IPv6 loopback).
const M = `http://[::1]:${PORT}/fixtures`
const ESTONIAN = 'Tere! Jõuan homme kell kolm.'
// Headed: Playwright's headless Chromium crashes as soon as the extension's service worker is evaluated.
const headed = true

type Result = { ok: true; tab?: { title: string; url: string }; hints?: number } | { ok: false; code: string; message: string }

const kindsSeen = new Set<string>()
let failures = 0

function line(kind: string, label: string, pass: boolean, detail: string): void {
  kindsSeen.add(kind)
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${kind.padEnd(16)} ${label.padEnd(44)} ${detail}`)
}

function check(label: string, pass: boolean, detail = ''): void {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${'(assert)'.padEnd(16)} ${label.padEnd(44)} ${detail}`)
}

function serve(): Promise<Server> {
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    const file = resolve(here, `.${path}`)
    if (!file.startsWith(here)) {
      res.writeHead(403).end()
      return
    }
    readFile(file).then(
      (body) => res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body),
      () => res.writeHead(404).end('not found'),
    )
  })
  return new Promise((ok) => server.listen(PORT, () => ok(server)))
}

function describe(r: Result | 'timeout'): string {
  if (r === 'timeout') return 'no answer'
  if (r.ok) return `ok${r.hints !== undefined ? ` hints=${r.hints}` : ''}${r.tab ? ` tab="${r.tab.title}" ${r.tab.url}` : ''}`
  return `${r.code}: ${r.message}`
}

async function main(): Promise<void> {
  const server = await serve()
  const profile = await mkdtemp(join(tmpdir(), 'utle-ext-'))
  let context: BrowserContext | null = null
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: !headed,
      viewport: null,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    })
    const ctx = context
    const sw: Worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
    await sw.evaluate((url) => chrome.storage.local.set({ utleUrl: url }), UTLE)

    const first = ctx.pages()[0] ?? (await ctx.newPage())
    await first.goto(`${T}/page-one.html`)

    // ---------- 7. the dock ----------
    const dockPage = ctx.waitForEvent('page', (p) => p.url().startsWith(UTLE))
    dockPage.catch(() => undefined)
    await sw.evaluate(() => (globalThis as unknown as { utleOpenDock: () => Promise<unknown> }).utleOpenDock())
    const utle: Page = await dockPage
    await utle.waitForLoadState('load')
    await sw.evaluate(() => (globalThis as unknown as { utleOpenDock: () => Promise<unknown> }).utleOpenDock())
    const windows = await sw.evaluate(async () => {
      const all = await chrome.windows.getAll({ populate: true })
      return all.map((w) => ({ type: w.type, left: w.left, top: w.top, width: w.width, height: w.height, urls: (w.tabs ?? []).map((t) => t.url) }))
    })
    for (const w of windows) console.log(`      window ${w.type} left=${w.left} top=${w.top} width=${w.width} height=${w.height} ${w.urls.join(' ')}`)
    const popups = windows.filter((w) => w.type === 'popup')
    check('dock: exactly one popup after two clicks', popups.length === 1, `popups=${popups.length}`)
    check('dock: popup shows Ütle at the left, ~440 wide', popups[0]?.urls[0] === UTLE && popups[0]?.left === 0 && Math.abs((popups[0]?.width ?? 0) - 440) <= 20, JSON.stringify(popups[0]))
    const browserWin = windows.find((w) => w.type === 'normal')
    check('dock: browser window fills the rest', browserWin !== undefined && (browserWin.left ?? 0) >= 430, JSON.stringify(browserWin && { left: browserWin.left, width: browserWin.width }))
    await utle.screenshot({ path: join(repoRoot, 'docs/proof/ext-dock-utle.png') })

    const send = async (command: unknown): Promise<Result | 'timeout'> => utle.evaluate((c) => (window as unknown as { bridge: (c: unknown) => Promise<Result | 'timeout'> }).bridge(c), command)
    const activeTab = async (): Promise<{ title: string; url: string } | null> =>
      sw.evaluate(async () => {
        const [t] = await chrome.tabs.query({ active: true, windowType: 'normal' })
        return t ? { title: t.title ?? '', url: t.url ?? '' } : null
      })
    const utleUntouched = (): boolean => utle.url() === UTLE && !utle.isClosed()
    const pageAt = (url: string): Page | undefined => ctx.pages().find((p) => p.url() === url)

    // ---------- 1. ping ----------
    let r = await send({ kind: 'ping' })
    line('ping', 'answers at once', r !== 'timeout' && r.ok, describe(r))

    // ---------- 2. tabs ----------
    r = await send({ kind: 'newTab', url: `${T}/page-two.html` })
    line('newTab', 'with url opens in the target window', r !== 'timeout' && r.ok && r.tab?.title === 'Page two' && pageAt(`${T}/page-two.html`) !== undefined && utleUntouched(), describe(r))
    const tabsInWindow = await sw.evaluate(async () => (await chrome.tabs.query({ windowType: 'normal' })).length)
    check('newTab: target window now has 2 tabs', tabsInWindow === 2, `tabs=${tabsInWindow}`)

    r = await send({ kind: 'newTab' })
    line('newTab', 'without url opens an empty tab', r !== 'timeout' && r.ok, describe(r))
    r = await send({ kind: 'history', direction: 'back' })
    line('history', 'back on a fresh tab -> not_found', r !== 'timeout' && !r.ok && r.code === 'not_found', describe(r))
    r = await send({ kind: 'closeTab' })
    line('closeTab', 'closes the empty tab, page two is active', r !== 'timeout' && r.ok && r.tab?.title === 'Page two' && utleUntouched(), describe(r))

    r = await send({ kind: 'switchTab', to: 'previous' })
    line('switchTab', 'previous -> page one', r !== 'timeout' && r.ok && r.tab?.title === 'Page one' && (await activeTab())?.title === 'Page one', describe(r))
    r = await send({ kind: 'switchTab', to: 'next' })
    line('switchTab', 'next -> page two', r !== 'timeout' && r.ok && r.tab?.title === 'Page two' && (await activeTab())?.title === 'Page two', describe(r))
    r = await send({ kind: 'switchTab', to: { index: 1 } })
    line('switchTab', 'index 1 -> page one', r !== 'timeout' && r.ok && r.tab?.title === 'Page one', describe(r))
    r = await send({ kind: 'switchTab', to: { query: 'TWO' } })
    line('switchTab', 'query "TWO" -> page two', r !== 'timeout' && r.ok && r.tab?.title === 'Page two', describe(r))
    r = await send({ kind: 'switchTab', to: { index: 9 } })
    line('switchTab', 'index 9 -> not_found', r !== 'timeout' && !r.ok && r.code === 'not_found', describe(r))

    r = await send({ kind: 'goTo', url: `${T}/page-three.html` })
    line('goTo', 'page two -> page three', r !== 'timeout' && r.ok && r.tab?.title === 'Page three' && pageAt(`${T}/page-three.html`) !== undefined && utleUntouched(), describe(r))
    r = await send({ kind: 'goTo', url: 'javascript:alert(1)' })
    line('goTo', 'javascript: address -> not_allowed', r !== 'timeout' && !r.ok && r.code === 'not_allowed', describe(r))
    r = await send({ kind: 'history', direction: 'back' })
    line('history', 'back -> page two', r !== 'timeout' && r.ok && r.tab?.title === 'Page two' && utleUntouched(), describe(r))
    r = await send({ kind: 'history', direction: 'forward' })
    line('history', 'forward -> page three', r !== 'timeout' && r.ok && r.tab?.title === 'Page three', describe(r))
    const three = pageAt(`${T}/page-three.html`)
    await three?.evaluate(() => {
      ;(window as unknown as { marker: number }).marker = 1
    })
    r = await send({ kind: 'reload' })
    const markerGone = await three?.evaluate(() => (window as unknown as { marker?: number }).marker === undefined)
    line('reload', 'reloads page three (marker gone)', r !== 'timeout' && r.ok && r.tab?.title === 'Page three' && markerGone === true && utleUntouched(), describe(r))

    // ---------- 3. numbered labels ----------
    r = await send({ kind: 'goTo', url: `${T}/target.html` })
    const target = pageAt(`${T}/target.html`)
    if (!target) throw new Error('target page not found')
    await target.waitForFunction(() => (window as unknown as { lexicalReady?: boolean }).lexicalReady === true)
    r = await send({ kind: 'showHints' })
    // 3 links, 2 buttons, input, textarea, editor = 8; the hidden and the off-screen button do not count.
    line('showHints', 'counts only visible actionable elements', r !== 'timeout' && r.ok && r.hints === 8, describe(r))
    await target.screenshot({ path: join(repoRoot, 'docs/proof/ext-hints.png') })
    const layers = async (): Promise<number> => target.evaluate(() => document.querySelectorAll('utle-hints').length)
    check('labels survive until used', (await layers()) === 1)
    r = await send({ kind: 'hideHints' })
    line('hideHints', 'removes the labels', r !== 'timeout' && r.ok && (await layers()) === 0, describe(r))

    await send({ kind: 'showHints' })
    r = await send({ kind: 'clickHint', number: 6 })
    const focusedId = await target.evaluate(() => document.activeElement?.id)
    line('clickHint', '6 focuses the input, labels gone', r !== 'timeout' && r.ok && focusedId === 'name' && (await layers()) === 0, `${describe(r)} focused=${focusedId}`)
    r = await send({ kind: 'clickHint', number: 3 })
    line('clickHint', 'with no labels -> not_found', r !== 'timeout' && !r.ok && r.code === 'not_found', describe(r))

    // ---------- 4. insertText ----------
    r = await send({ kind: 'insertText', text: ESTONIAN, submit: false })
    const inputValue = await target.evaluate(() => (document.getElementById('name') as HTMLInputElement).value)
    line('insertText', 'into the focused input', r !== 'timeout' && r.ok && inputValue === ESTONIAN, `${describe(r)} value=${JSON.stringify(inputValue)}`)

    await send({ kind: 'showHints' })
    await send({ kind: 'clickHint', number: 7 })
    r = await send({ kind: 'insertText', text: ESTONIAN, submit: false })
    const areaValue = await target.evaluate(() => (document.getElementById('notes') as HTMLTextAreaElement).value)
    line('insertText', 'into the focused textarea', r !== 'timeout' && r.ok && areaValue === ESTONIAN, `${describe(r)} value=${JSON.stringify(areaValue)}`)

    await target.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    r = await send({ kind: 'insertText', text: ESTONIAN, submit: true })
    const sent = await target.evaluate(() => [...document.querySelectorAll('#sent li')].map((li) => li.textContent))
    const leftover = await target.evaluate(() => (window as unknown as { lexicalText: () => string }).lexicalText())
    line('insertText', 'Lexical message box + Enter sends once', r !== 'timeout' && r.ok && sent.length === 1 && sent[0] === ESTONIAN && leftover === '', `${describe(r)} sent=${JSON.stringify(sent)} editor=${JSON.stringify(leftover)}`)
    await target.screenshot({ path: join(repoRoot, 'docs/proof/ext-sent.png') })

    // ---------- scroll ----------
    const scrollY = async (): Promise<number> => target.evaluate(() => window.scrollY)
    r = await send({ kind: 'scroll', direction: 'down' })
    const afterDown = await scrollY()
    line('scroll', 'down', r !== 'timeout' && r.ok && afterDown > 0, `${describe(r)} y=${afterDown}`)
    r = await send({ kind: 'scroll', direction: 'up' })
    line('scroll', 'up', r !== 'timeout' && r.ok && (await scrollY()) < afterDown, `${describe(r)} y=${await scrollY()}`)
    r = await send({ kind: 'scroll', direction: 'bottom' })
    const atBottom = await scrollY()
    line('scroll', 'bottom', r !== 'timeout' && r.ok && atBottom > 2500, `${describe(r)} y=${atBottom}`)
    r = await send({ kind: 'scroll', direction: 'top' })
    line('scroll', 'top', r !== 'timeout' && r.ok && (await scrollY()) === 0, `${describe(r)} y=${await scrollY()}`)

    // clickHint on a link navigates (last, since it leaves the page)
    await send({ kind: 'showHints' })
    r = await send({ kind: 'clickHint', number: 2 })
    line('clickHint', '2 follows "Link two"', r !== 'timeout' && r.ok && r.tab?.title === 'Page two' && utleUntouched(), describe(r))

    // ---------- 5. openConversation on the messaging site ----------
    const timed = async (command: unknown): Promise<[Result | 'timeout', number]> => {
      const t0 = Date.now()
      const res = await send(command)
      return [res, Date.now() - t0]
    }
    const tabCount = async (): Promise<number> => sw.evaluate(async () => (await chrome.tabs.query({ windowType: 'normal' })).length)
    let ms = 0

    // A messaging home with no conversation list (a login page).
    await send({ kind: 'goTo', url: `${T}/page-one.html` })
    await sw.evaluate((url) => chrome.storage.local.set({ messagingHome: url }), `${M}/login.html`)
    ;[r, ms] = await timed({ kind: 'openConversation', name: 'mari' })
    line('openConversation', 'home is a login page -> not_found', r !== 'timeout' && !r.ok && r.code === 'not_found' && /logging in/.test(r.message), `${describe(r)} (${ms} ms)`)

    // Not on the messaging site, no messaging tab: the target tab goes to the home; the list arrives 1.5 s after load.
    await send({ kind: 'goTo', url: `${T}/page-one.html` })
    await sw.evaluate((url) => chrome.storage.local.set({ messagingHome: url }), `${M}/messenger.html`)
    const tabsBefore = await tabCount()
    ;[r, ms] = await timed({ kind: 'openConversation', name: 'mari' })
    line('openConversation', 'from page-one -> home, late list, Mari', r !== 'timeout' && r.ok && r.tab?.url === `${M}/t/mari` && (await tabCount()) === tabsBefore, `${describe(r)} (${ms} ms) tabs ${tabsBefore}->${await tabCount()}`)
    const messenger = ctx.pages().find((p) => p.url().startsWith(`http://[::1]:${PORT}/`))
    if (!messenger) throw new Error('messaging page not found')

    // A same-document switch: the old composer goes at once, the new one appears 800 ms later.
    ;[r, ms] = await timed({ kind: 'openConversation', name: 'Märt' })
    line('openConversation', '"Märt" -> Märt Tamm (pushState)', r !== 'timeout' && r.ok && r.tab?.url === `${M}/t/mart`, `${describe(r)} (${ms} ms)`)
    ;[r, ms] = await timed({ kind: 'insertText', text: ESTONIAN, submit: true })
    const toMart = await messenger.evaluate(() => (window as unknown as { sentTo: (id: string) => string[] }).sentTo('mart'))
    const toMari = await messenger.evaluate(() => (window as unknown as { sentTo: (id: string) => string[] }).sentTo('mari'))
    line('insertText', 'lands in Märt list, not in Mari list', r !== 'timeout' && r.ok && toMart.length === 1 && toMart[0] === ESTONIAN && toMari.length === 0, `${describe(r)} (${ms} ms) mart=${JSON.stringify(toMart)} mari=${JSON.stringify(toMari)}`)
    await messenger.screenshot({ path: join(repoRoot, 'docs/proof/ext-messenger-sent.png') })

    for (const [spoken, id, who] of [['Jaani', 'jaan', 'Jaan Tamm'], ['Märdi', 'mart', 'Märt Tamm'], ['Peetri', 'peeter', 'Peeter Kask'], ['Mari', 'mari', 'Mari Maasikas']] as const) {
      ;[r, ms] = await timed({ kind: 'openConversation', name: spoken })
      line('openConversation', `"${spoken}" -> ${who}`, r !== 'timeout' && r.ok && r.tab?.url === `${M}/t/${id}`, `${describe(r)} (${ms} ms)`)
    }
    ;[r, ms] = await timed({ kind: 'openConversation', name: 'nobody' })
    line('openConversation', '"nobody" -> not_found', r !== 'timeout' && !r.ok && r.code === 'not_found', `${describe(r)} (${ms} ms)`)
    ;[r, ms] = await timed({ kind: 'openConversation', name: 'Broken Link' })
    line('openConversation', 'click that does not open -> failed', r !== 'timeout' && !r.ok && r.code === 'failed', `${describe(r)} (${ms} ms)`)

    // Not on the messaging site, but a messaging tab is open in the window: switch to it.
    await send({ kind: 'newTab', url: `${T}/page-one.html` })
    const tabsWithTwo = await tabCount()
    ;[r, ms] = await timed({ kind: 'openConversation', name: 'Märt' })
    const active = await activeTab()
    line('openConversation', 'messaging tab exists -> it becomes active', r !== 'timeout' && r.ok && r.tab?.url === `${M}/t/mart` && active?.url === `${M}/t/mart` && (await tabCount()) === tabsWithTwo, `${describe(r)} (${ms} ms) tabs ${tabsWithTwo}->${await tabCount()}`)

    // ---------- 6. failure paths ----------
    await send({ kind: 'goTo', url: `${T}/attacker.html` })
    const attacker = pageAt(`${T}/attacker.html`)
    if (!attacker) throw new Error('attacker page not found')
    await attacker.evaluate(() => (window as unknown as { attack: () => void }).attack())
    await attacker.waitForTimeout(2000)
    const answers = await attacker.evaluate(() => (window as unknown as { answers: unknown[] }).answers.length)
    line('ping', 'from a non-Ütle origin gets no answer', answers === 0, `answers=${answers}`)

    // A request from another window of the same origin, or a malformed one, is ignored too.
    const before = await utle.evaluate(() => (window as unknown as { responses: unknown[] }).responses.length)
    await utle.evaluate(() => {
      window.postMessage({ source: 'utle-app', id: 'x', command: { kind: 'ping' } }, window.location.origin)
      window.postMessage({ source: 'someone', id: 99, command: { kind: 'ping' } }, window.location.origin)
    })
    await utle.waitForTimeout(1000)
    const after = await utle.evaluate(() => (window as unknown as { responses: unknown[] }).responses.length)
    check('malformed requests get no answer', after === before, `before=${before} after=${after}`)

    await sw.evaluate(async () => {
      const [t] = await chrome.tabs.query({ active: true, windowType: 'normal' })
      if (t?.id !== undefined) await chrome.tabs.update(t.id, { url: 'chrome://extensions' })
    })
    await utle.waitForTimeout(1000)
    r = await send({ kind: 'scroll', direction: 'down' })
    line('scroll', 'on chrome://extensions -> not_allowed', r !== 'timeout' && !r.ok && r.code === 'not_allowed', describe(r))
    r = await send({ kind: 'insertText', text: 'x', submit: false })
    line('insertText', 'on chrome://extensions -> not_allowed', r !== 'timeout' && !r.ok && r.code === 'not_allowed', describe(r))

    await sw.evaluate(async () => {
      for (const w of await chrome.windows.getAll({ windowTypes: ['normal'] })) if (w.id !== undefined) await chrome.windows.remove(w.id)
    })
    await utle.waitForTimeout(500)
    r = await send({ kind: 'showHints' })
    line('showHints', 'with no ordinary window -> no_target', r !== 'timeout' && !r.ok && r.code === 'no_target', describe(r))
    r = await send({ kind: 'newTab', url: `${T}/page-one.html` })
    line('newTab', 'with no ordinary window -> no_target', r !== 'timeout' && !r.ok && r.code === 'no_target', describe(r))
    check('Ütle page still open and unchanged', utleUntouched())

    // ---------- every kind in the contract ----------
    const contract = readFileSync(join(repoRoot, 'src/browser/protocol.ts'), 'utf8')
    const kinds = [...contract.matchAll(/kind: '(\w+)'/g)].map((m) => m[1] ?? '')
    const missing = kinds.filter((k) => !kindsSeen.has(k))
    check(`every protocol kind exercised (${kinds.length})`, missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : kinds.join(' '))
  } finally {
    await context?.close()
    server.close()
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
  process.exitCode = failures === 0 ? 0 : 1
}

await mkdir(join(repoRoot, 'docs/proof'), { recursive: true })
main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

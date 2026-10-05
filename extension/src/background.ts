// Service worker: finds the target tab, runs browser commands, keeps the offscreen engine and the
// strip's state, opens the microphone permission page. See docs/ARCHITECTURE.md 20.2 and 21.2.

import type { BrowserCommand, BrowserFailure, BrowserResult } from '../../src/browser/protocol.ts'
import type { TabSummary } from '../../src/core/pageIntent.ts'
import { INITIAL_STATE, OFFSCREEN_CREATED_KEY, STATE_KEY } from './messages.ts'
import type { StripState, ToBackground, ToOffscreen, ToPage } from './messages.ts'
import type { PageCommand } from './page.ts'
import { SITES, siteOf } from './sites.ts'
import type { SiteName, SiteSettings } from './sites.ts'

/** Where the section 20 development page runs unless the options page says otherwise. */
const DEFAULT_UTLE_URL = 'http://localhost:5173'
const DEFAULT_ASR_URL = 'ws://localhost:5173/api/asr'
const LOAD_TIMEOUT_MS = 8000
/** After openConversation clicks, how long the address may take to change. */
const SETTLE_TIMEOUT_MS = 3000
/** After the address changed (or where it does not), time for the page to swap its composer. */
const SETTLE_QUIET_MS = 500

type Tab = chrome.tabs.Tab

// ---------- settings ----------

async function stored(key: string): Promise<unknown> {
  const all = await chrome.storage.local.get(key)
  return all[key]
}

async function utleOrigin(): Promise<string> {
  const value = await stored('utleUrl')
  try {
    return new URL(typeof value === 'string' && value !== '' ? value : DEFAULT_UTLE_URL).origin
  } catch {
    return new URL(DEFAULT_UTLE_URL).origin
  }
}

async function asrUrl(): Promise<string> {
  const value = await stored('asrUrl')
  return typeof value === 'string' && value !== '' ? value : DEFAULT_ASR_URL
}

async function siteSettings(): Promise<SiteSettings> {
  const { siteOverrides, messagingHome } = await chrome.storage.local.get(['siteOverrides', 'messagingHome'])
  return {
    siteOverrides: siteOverrides && typeof siteOverrides === 'object' ? (siteOverrides as Record<string, SiteName>) : {},
    messagingHome: typeof messagingHome === 'string' && messagingHome !== '' ? messagingHome : null,
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ---------- results ----------

const ok = (extra: Omit<Extract<BrowserResult, { ok: true }>, 'ok'> = {}): BrowserResult => ({ ok: true, ...extra })
const fail = (code: BrowserFailure, message: string): BrowserResult => ({ ok: false, code, message })
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function tabInfo(tab: Tab): { title: string; url: string } {
  return { title: tab.title ?? '', url: tab.url ?? tab.pendingUrl ?? '' }
}

// ---------- the target window ----------

// Most recently focused ordinary windows, newest first. Kept in session storage because the
// service worker sleeps and loses its memory.
async function recentWindows(): Promise<number[]> {
  const { recentWindows: list } = await chrome.storage.session.get('recentWindows')
  return Array.isArray(list) ? (list as number[]) : []
}

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  try {
    const win = await chrome.windows.get(windowId)
    if (win.type !== 'normal') return
    const list = (await recentWindows()).filter((id) => id !== windowId)
    list.unshift(windowId)
    await chrome.storage.session.set({ recentWindows: list.slice(0, 20) })
  } catch {
    // the window closed while we looked
  }
})

/** The most recently focused ordinary window that is not the sender's (the offscreen engine has none). */
async function targetWindow(senderWindowId: number | undefined): Promise<chrome.windows.Window | null> {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
  const candidates = windows.filter((w) => w.id !== senderWindowId)
  if (candidates.length === 0) return null
  const recent = await recentWindows()
  const rank = (w: chrome.windows.Window): number => {
    const i = w.id === undefined ? -1 : recent.indexOf(w.id)
    return i === -1 ? (w.focused ? recent.length : recent.length + 1) : i
  }
  candidates.sort((a, b) => rank(a) - rank(b))
  return candidates[0] ?? null
}

async function targetTab(senderWindowId: number | undefined): Promise<Tab | null> {
  const win = await targetWindow(senderWindowId)
  if (!win) return null
  const [tab] = await chrome.tabs.query({ windowId: win.id, active: true })
  return tab ?? null
}

const NO_TARGET = (): BrowserResult => fail('no_target', 'There is no browser window to act on.')

/** The tabs of the window being driven, left to right, as the model sees them (M7). */
async function tabSummaries(): Promise<TabSummary[]> {
  const win = await targetWindow(undefined)
  if (!win) return []
  const tabs = await chrome.tabs.query({ windowId: win.id })
  // IntentRequestSchema takes at most 60 tabs; a request beyond that would be a 400.
  return tabs.slice(0, 60).map((t, i) => ({ index: i + 1, title: (t.title ?? '').slice(0, 300), active: t.active }))
}

// ---------- waiting for a page ----------

/** Runs action, then waits until the tab has finished loading (or the timeout). */
async function andWaitForLoad(tabId: number, action: () => Promise<unknown>): Promise<void> {
  let sawLoading = false
  let finish: () => void = () => undefined
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })
  const listener = (id: number, change: { status?: string }): void => {
    if (id !== tabId) return
    if (change.status === 'loading') sawLoading = true
    if (change.status === 'complete' && sawLoading) finish()
  }
  const closed = (id: number): void => {
    if (id === tabId) finish()
  }
  chrome.tabs.onUpdated.addListener(listener)
  chrome.tabs.onRemoved.addListener(closed)
  try {
    await action()
    const timer = setTimeout(finish, LOAD_TIMEOUT_MS)
    // If nothing starts loading soon, the action did not navigate.
    const quiet = setTimeout(() => {
      if (!sawLoading) finish()
    }, 700)
    await done
    clearTimeout(timer)
    clearTimeout(quiet)
  } finally {
    chrome.tabs.onUpdated.removeListener(listener)
    chrome.tabs.onRemoved.removeListener(closed)
  }
}

async function freshTab(tabId: number): Promise<BrowserResult> {
  try {
    return ok({ tab: tabInfo(await chrome.tabs.get(tabId)) })
  } catch {
    return ok()
  }
}

async function waitForComplete(tabId: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < LOAD_TIMEOUT_MS) {
    try {
      const t = await chrome.tabs.get(tabId)
      if (t.status === 'complete' && t.url) return
    } catch {
      return
    }
    await sleep(100)
  }
}

async function waitForUrlChange(tabId: number, before: string | undefined, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const t = await chrome.tabs.get(tabId).catch(() => null)
    if (!t) return false
    if ((t.pendingUrl ?? t.url) !== before) return true
    await sleep(100)
  }
  return false
}

// ---------- what may be scripted ----------

function webAddress(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function scriptable(url: string | undefined): boolean {
  if (!url) return false
  if (!/^(https?|file):/.test(url)) return false
  if (/^https:\/\/chromewebstore\.google\.com\//.test(url)) return false
  if (/^https:\/\/chrome\.google\.com\/webstore/.test(url)) return false
  return true
}

const NOT_ALLOWED = (tab: Tab): BrowserResult =>
  fail('not_allowed', `Chrome does not let extensions work on this page (${tab.url ?? 'a browser page'}). Go to an ordinary web page first.`)

type PageAnswer = BrowserResult | { ok: true; href: string; settled?: boolean }

/** How long the new-tab page may take to answer a page command (setText waits up to 3 s for a box). */
const NEWTAB_TIMEOUT_MS = 6000

/** The extension's own new-tab page (21.3). Chrome reports it as chrome://newtab/. */
function ourNewTab(url: string | undefined): boolean {
  const u = url ?? ''
  // The options page (M7) runs page commands the same way, so its buttons can be numbered by voice.
  return url === 'chrome://newtab/' || u.startsWith(chrome.runtime.getURL('newtab.html')) || u.startsWith(chrome.runtime.getURL('options.html'))
}

/** The worker cannot inject into an extension page: the new-tab page runs the command with its own page.js. */
async function runOnNewTab(tab: Tab, tabId: number, command: BrowserCommand): Promise<PageAnswer> {
  const message: ToPage = { type: 'utle-page-run', tabId, command: { ...command, site: null } }
  // A tab opened a moment ago may not be listening yet.
  await waitForComplete(tabId)
  const deadline = Date.now() + NEWTAB_TIMEOUT_MS
  while (Date.now() < deadline) {
    const answer = (await Promise.race([chrome.runtime.sendMessage(message).catch(() => undefined), sleep(deadline - Date.now()).then(() => undefined)])) as PageAnswer | undefined
    if (answer && typeof answer.ok === 'boolean') return answer
    await sleep(200)
  }
  return NOT_ALLOWED(tab)
}

async function runInPage(tab: Tab, command: BrowserCommand): Promise<PageAnswer> {
  if (tab.id !== undefined && ourNewTab(tab.url ?? tab.pendingUrl)) return runOnNewTab(tab, tab.id, command)
  if (!scriptable(tab.url) || tab.id === undefined) return NOT_ALLOWED(tab)
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['dist/page.js'] })
    const pageCommand: PageCommand = { ...command, site: siteOf(tab.url, await siteSettings()) }
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (cmd: PageCommand) => {
        const utle = globalThis.__utle
        return utle ? utle.run(cmd) : { ok: false, code: 'failed', message: 'The page script is missing.' }
      },
      args: [pageCommand],
    })
    const result = frame?.result as PageAnswer | undefined
    if (!result || typeof result.ok !== 'boolean') return fail('failed', 'The page did not answer.')
    return result
  } catch (error) {
    const message = errorText(error)
    if (/cannot access|cannot be scripted|extensions gallery|permission/i.test(message)) return NOT_ALLOWED(tab)
    return fail('failed', `The page could not run the command: ${message}`)
  }
}

/** A page answer without the page's own fields (href, settled). */
function clean(answer: PageAnswer): BrowserResult {
  if (!answer.ok) return answer
  const { tab, hints, box, page } = answer as Extract<BrowserResult, { ok: true }>
  return ok({ ...(tab ? { tab } : {}), ...(hints !== undefined ? { hints } : {}), ...(box ? { box } : {}), ...(page ? { page } : {}) })
}

// ---------- commands ----------

function normalize(s: string | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

async function switchTab(tab: Tab, to: Extract<BrowserCommand, { kind: 'switchTab' }>['to']): Promise<BrowserResult> {
  const tabs = await chrome.tabs.query({ windowId: tab.windowId })
  tabs.sort((a, b) => a.index - b.index)
  const at = tabs.findIndex((t) => t.id === tab.id)
  let next: Tab | null = null
  if (to === 'next') next = tabs[(at + 1) % tabs.length] ?? null
  else if (to === 'previous') next = tabs[(at - 1 + tabs.length) % tabs.length] ?? null
  else if ('index' in to) {
    next = tabs[to.index - 1] ?? null
    if (!next) return fail('not_found', `There is no tab ${to.index}. This window has ${tabs.length} tabs.`)
  } else {
    const q = normalize(to.query)
    const matches = tabs.filter((t) => normalize(t.title).includes(q) || normalize(t.url).includes(q))
    // Prefer a title match, then the first tab after the current one.
    const byTitle = matches.filter((t) => normalize(t.title).includes(q))
    const pool = byTitle.length > 0 ? byTitle : matches
    next = pool.find((t) => t.index > tab.index) ?? pool[0] ?? null
    if (!next) return fail('not_found', `No tab matches "${to.query}".`)
  }
  if (!next || next.id === undefined) return fail('not_found', 'There is no other tab.')
  const updated = await chrome.tabs.update(next.id, { active: true })
  return ok({ tab: tabInfo(updated ?? next) })
}

async function execute(command: BrowserCommand, senderWindowId: number | undefined): Promise<BrowserResult> {
  if (command.kind === 'ping') return ok()

  const tab = await targetTab(senderWindowId)
  if (!tab || tab.id === undefined) return NO_TARGET()
  const tabId = tab.id

  switch (command.kind) {
    case 'newTab': {
      if (command.url !== undefined && !webAddress(command.url)) return fail('not_allowed', `Only web addresses can be opened: ${command.url}`)
      if (command.url === undefined) {
        const created = await chrome.tabs.create({ windowId: tab.windowId, active: true })
        return ok({ tab: tabInfo(created) })
      }
      const created = await chrome.tabs.create({ windowId: tab.windowId, active: true, url: command.url })
      if (created.id === undefined) return ok({ tab: tabInfo(created) })
      await waitForComplete(created.id)
      return freshTab(created.id)
    }
    case 'closeTab': {
      const windowId = tab.windowId
      await chrome.tabs.remove(tabId)
      try {
        const [now] = await chrome.tabs.query({ windowId, active: true })
        return now ? ok({ tab: tabInfo(now) }) : ok()
      } catch {
        return ok()
      }
    }
    case 'switchTab':
      return switchTab(tab, command.to)
    case 'goTo': {
      if (!webAddress(command.url)) return fail('not_allowed', `Only web addresses can be opened: ${command.url}`)
      await andWaitForLoad(tabId, () => chrome.tabs.update(tabId, { url: command.url }))
      return freshTab(tabId)
    }
    case 'history':
      return history(tab, tabId, command.direction === 'back')
    case 'reload':
      await andWaitForLoad(tabId, () => chrome.tabs.reload(tabId))
      return freshTab(tabId)
    case 'scroll':
    case 'showHints':
    case 'hideHints':
    case 'insertText':
    case 'readBox':
    case 'setText':
    case 'pressSend':
    case 'readPage':
    case 'focusItem':
    case 'media':
    case 'pressKey':
    case 'caret':
    case 'select':
    case 'typeText':
    case 'clearField':
    case 'arm':
      return clean(await runInPage(tab, command))
    case 'siteSearch': {
      // The search submits and usually loads a results page.
      let result: PageAnswer = fail('failed', 'The page did not answer.')
      await andWaitForLoad(tabId, async () => {
        result = await runInPage(tab, command)
      })
      if (!result.ok) return result
      return freshTab(tabId)
    }
    case 'bar':
      await patchState({ hidden: !command.show })
      return ok()
    case 'openConversation':
      return openConversation(tab, command)
    case 'clickHint':
    case 'clickItem': {
      let result: PageAnswer = fail('failed', 'The page did not answer.')
      await andWaitForLoad(tabId, async () => {
        result = await runInPage(tab, command)
      })
      if (!result.ok) return result
      return freshTab(tabId)
    }
  }
}

async function history(tab: Tab, tabId: number, back: boolean): Promise<BrowserResult> {
  const nothing = fail('not_found', back ? 'There is no page to go back to.' : 'There is no page to go forward to.')
  try {
    await andWaitForLoad(tabId, async () => {
      try {
        await (back ? chrome.tabs.goBack(tabId) : chrome.tabs.goForward(tabId))
      } catch (error) {
        // Chrome skips history entries made without a user gesture (every navigation an
        // extension makes), so tabs.goBack can refuse where the page's own history.back works.
        if (!scriptable(tab.url)) throw error
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (b: boolean) => (b ? window.history.back() : window.history.forward()),
          args: [back],
        })
      }
    })
  } catch (error) {
    const message = errorText(error)
    return /cannot find/i.test(message) ? nothing : fail('failed', `Could not go ${back ? 'back' : 'forward'}: ${message}`)
  }
  const now = await chrome.tabs.get(tabId).catch(() => null)
  if (now && now.url === tab.url) return nothing
  return now ? ok({ tab: tabInfo(now) }) : ok()
}

/**
 * Opens a conversation on a messaging site. A target tab elsewhere first switches to a tab of
 * WhatsApp or Messenger in the same window (WhatsApp first), or goes to the messaging home.
 * Answers ok only once the conversation is open, so a following setText cannot type into the
 * conversation that was open before.
 */
async function openConversation(tab: Tab, command: BrowserCommand): Promise<BrowserResult> {
  const settings = await siteSettings()
  let t: Tab = tab
  if (siteOf(t.url, settings) === null) {
    const tabs = await chrome.tabs.query({ windowId: t.windowId })
    const there = tabs.find((x) => siteOf(x.url, settings) === 'whatsapp') ?? tabs.find((x) => siteOf(x.url, settings) === 'messenger')
    if (there?.id !== undefined) {
      const thereId = there.id
      await chrome.tabs.update(thereId, { active: true })
      await waitForComplete(thereId)
      t = await chrome.tabs.get(thereId)
    } else if (t.id !== undefined) {
      const home = settings.messagingHome ?? SITES.whatsapp.home
      const id = t.id
      await andWaitForLoad(id, () => chrome.tabs.update(id, { url: home }))
      t = await chrome.tabs.get(id)
    }
  }
  if (t.id === undefined) return NO_TARGET()
  const before = t.url
  const result = await runInPage(t, command)
  if (!result.ok) return result
  const answer = result as { href?: unknown; settled?: unknown }
  if (answer.settled === true) return freshTab(t.id)
  const href = typeof answer.href === 'string' ? answer.href : ''
  if (href !== '' && href === before) return freshTab(t.id)
  const changed = await waitForUrlChange(t.id, before, SETTLE_TIMEOUT_MS)
  if (changed) await waitForComplete(t.id)
  else if (href !== '') return fail('failed', 'The conversation did not open, so nothing will be typed. Try again or use the numbers.')
  await sleep(SETTLE_QUIET_MS)
  return freshTab(t.id)
}

// ---------- the strip's state ----------

// The strips read the state from session storage, which content scripts may not read by default.
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })

let stateWrite: Promise<void> = Promise.resolve()

function patchState(patch: Partial<StripState>): Promise<void> {
  stateWrite = stateWrite.then(async () => {
    const now = (await chrome.storage.session.get(STATE_KEY))[STATE_KEY] as StripState | undefined
    await chrome.storage.session.set({ [STATE_KEY]: { ...INITIAL_STATE, ...now, ...patch } })
  })
  return stateWrite.catch(() => undefined)
}

// ---------- the offscreen engine ----------

let creating: Promise<void> | null = null

/** The speech engine chosen on the options page (round 3): local (TalTech) or soniox. */
async function speechEngine(): Promise<'local' | 'soniox'> {
  const value = await stored('speechEngine')
  return value === 'soniox' ? 'soniox' : 'local'
}

async function ensureOffscreen(): Promise<void> {
  const base = chrome.runtime.getURL('offscreen.html')
  // The engine is in the address, so a changed setting makes a new document on the next start.
  const wanted = `${base}?asr=${encodeURIComponent(await asrUrl())}&engine=${await speechEngine()}`
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })
  const existing = contexts.find((c) => c.documentUrl?.startsWith(base))
  if (existing && existing.documentUrl === wanted) return
  if (creating) return creating
  creating = (async () => {
    if (existing) {
      // The old engine dies with its document without a word: what it published is no longer true.
      await chrome.offscreen.closeDocument().catch(() => undefined)
      await patchState({ listening: false, thinking: false, lag: 0 })
    }
    await chrome.offscreen.createDocument({
      url: wanted,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Ütle listens to the microphone for the whole browser.',
    })
    const count = (await chrome.storage.session.get(OFFSCREEN_CREATED_KEY))[OFFSCREEN_CREATED_KEY]
    await chrome.storage.session.set({ [OFFSCREEN_CREATED_KEY]: (typeof count === 'number' ? count : 0) + 1 })
    // A new engine is not listening, whatever an earlier one said.
    await patchState({ listening: false, resting: false, heard: '' })
  })()
  try {
    await creating
  } finally {
    creating = null
  }
}

async function toOffscreen(type: 'toggle' | 'start'): Promise<void> {
  await sendOffscreen({ target: 'offscreen', type })
}

async function sendOffscreen(message: ToOffscreen): Promise<void> {
  await ensureOffscreen()
  await chrome.runtime.sendMessage(message).catch(() => undefined)
}

async function openPermissionPage(): Promise<void> {
  const url = chrome.runtime.getURL('permission.html')
  const first = (await chrome.tabs.query({})).find((t) => (t.url ?? t.pendingUrl ?? '') === url)
  if (first?.id !== undefined) {
    await chrome.tabs.update(first.id, { active: true })
    return
  }
  await chrome.tabs.create({ url, active: true })
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void openPermissionPage()
})

chrome.action.onClicked.addListener(() => {
  void toOffscreen('toggle')
})

// ---------- messages ----------

chrome.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string' || sender.id !== chrome.runtime.id) return false
  switch (message.type) {
    case 'utle-toggle':
      void toOffscreen('toggle')
      return false
    case 'utle-state':
      void patchState(message.patch)
      return false
    case 'utle-bar':
      void patchState({ hidden: !message.show })
      return false
    case 'utle-listen':
      // From the strip in gaze mode (round 3).
      void sendOffscreen(message.on ? { target: 'offscreen', type: 'start' } : { target: 'offscreen', type: 'stop', flush: message.flush })
      return false
    case 'utle-open-options':
      void chrome.runtime.openOptionsPage()
      return false
    case 'utle-mic-blocked':
      void chrome.storage.session.set({ wantListening: true }).then(openPermissionPage)
      return false
    case 'utle-mic-granted':
      void chrome.storage.session.get('wantListening').then(async ({ wantListening }) => {
        if (wantListening !== true) return
        await chrome.storage.session.set({ wantListening: false })
        await toOffscreen('start')
      })
      return false
    case 'utle-tabs': {
      // From the offscreen engine (M7): the tabs of the window being driven, for the model.
      if (sender.tab) return false
      tabSummaries().then(
        (tabs) => sendResponse({ tabs }),
        () => sendResponse({ tabs: [] }),
      )
      return true
    }
    case 'utle-run': {
      // From the offscreen engine: it has no tab, so the target is the most recent ordinary window.
      if (sender.tab) return false
      execute(message.command, undefined).then(
        (result) => sendResponse({ result }),
        (error: unknown) => sendResponse({ result: fail('failed', errorText(error)) }),
      )
      return true
    }
    case 'utle-command': {
      // From the section 20 development page through relay.js. Only the configured page may drive the browser.
      const tab = sender.tab
      if (!tab) return false
      void (async () => {
        if (sender.origin !== (await utleOrigin())) return { ignored: true }
        try {
          return { result: await execute(message.command, tab.windowId) }
        } catch (error) {
          return { result: fail('failed', errorText(error)) }
        }
      })().then(sendResponse)
      return true
    }
    default:
      return false
  }
})

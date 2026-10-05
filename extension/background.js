// Service worker: finds the target tab, runs browser commands, docks the Ütle window.
// The contract is src/browser/protocol.ts; this file follows it by hand. See docs/ARCHITECTURE.md 20.2.

// Defines globalThis.__utleSites: the messaging site's address rules and home.
import './sites.js'

/** Where Ütle runs unless the options page says otherwise. */
export const DEFAULT_UTLE_URL = 'http://localhost:5173'
const DOCK_WIDTH = 440
const LOAD_TIMEOUT_MS = 8000
/** After openConversation clicks, how long the address may take to change. */
const SETTLE_TIMEOUT_MS = 3000
/** After the address changed (or where it does not), time for the page to swap its composer. */
const SETTLE_QUIET_MS = 500

// ---------- settings ----------

async function utleUrl() {
  const { utleUrl: stored } = await chrome.storage.local.get('utleUrl')
  return typeof stored === 'string' && stored.length > 0 ? stored : DEFAULT_UTLE_URL
}

async function utleOrigin() {
  try {
    return new URL(await utleUrl()).origin
  } catch {
    return new URL(DEFAULT_UTLE_URL).origin
  }
}

/** The messaging site's home. Stored 'messagingHome' overrides sites.js (the test uses it). */
async function messagingHome() {
  const { messagingHome: stored } = await chrome.storage.local.get('messagingHome')
  return typeof stored === 'string' && stored.length > 0 ? stored : globalThis.__utleSites.messenger.home
}

function onMessaging(url, home) {
  try {
    const u = new URL(url)
    return globalThis.__utleSites.messenger.isHere(u) || u.origin === new URL(home).origin
  } catch {
    return false
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------- results ----------

const ok = (extra) => ({ ok: true, ...extra })
const fail = (code, message) => ({ ok: false, code, message })

function tabInfo(tab) {
  return { title: tab.title || '', url: tab.url || tab.pendingUrl || '' }
}

// ---------- the target window ----------

// Most recently focused ordinary windows, newest first. Kept in session storage because the
// service worker sleeps and loses its memory.
async function recentWindows() {
  const { recentWindows: list } = await chrome.storage.session.get('recentWindows')
  return Array.isArray(list) ? list : []
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

/** The target window: the most recently focused ordinary window that is not the sender's. */
async function targetWindow(senderWindowId) {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
  const candidates = windows.filter((w) => w.id !== senderWindowId)
  if (candidates.length === 0) return null
  const recent = await recentWindows()
  const rank = (w) => {
    const i = recent.indexOf(w.id)
    return i === -1 ? (w.focused ? recent.length : recent.length + 1) : i
  }
  candidates.sort((a, b) => rank(a) - rank(b))
  return candidates[0]
}

async function targetTab(senderWindowId) {
  const win = await targetWindow(senderWindowId)
  if (!win) return null
  const [tab] = await chrome.tabs.query({ windowId: win.id, active: true })
  return tab || null
}

const NO_TARGET = () => fail('no_target', 'There is no browser window to act on. Open a browser window next to Ütle.')

// ---------- waiting for a page ----------

/** Runs action, then waits until the tab has finished loading (or the timeout). */
async function andWaitForLoad(tabId, action) {
  let sawLoading = false
  let finish
  const done = new Promise((resolve) => {
    finish = resolve
  })
  const listener = (id, change) => {
    if (id !== tabId) return
    if (change.status === 'loading') sawLoading = true
    if (change.status === 'complete' && sawLoading) finish()
  }
  const closed = (id) => {
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

async function freshTab(tabId) {
  try {
    return ok({ tab: tabInfo(await chrome.tabs.get(tabId)) })
  } catch {
    return ok()
  }
}

// ---------- what may be scripted ----------

function webAddress(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function scriptable(url) {
  if (!url) return false
  if (!/^(https?|file):/.test(url)) return false
  if (/^https:\/\/chromewebstore\.google\.com\//.test(url)) return false
  if (/^https:\/\/chrome\.google\.com\/webstore/.test(url)) return false
  return true
}

const NOT_ALLOWED = (tab) =>
  fail('not_allowed', `Chrome does not let extensions work on this page (${tab.url || 'a browser page'}). Go to an ordinary web page first.`)

async function runInPage(tab, command) {
  if (!scriptable(tab.url)) return NOT_ALLOWED(tab)
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['sites.js', 'page.js'] })
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (cmd) => globalThis.__utle.run(cmd),
      args: [{ ...command, onMessaging: onMessaging(tab.url, await messagingHome()) }],
    })
    const result = frame && frame.result
    if (!result || typeof result.ok !== 'boolean') return fail('failed', 'The page did not answer.')
    return result
  } catch (error) {
    const message = String(error && error.message ? error.message : error)
    if (/cannot access|cannot be scripted|extensions gallery|permission/i.test(message)) return NOT_ALLOWED(tab)
    return fail('failed', `The page could not run the command: ${message}`)
  }
}

// ---------- commands ----------

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

async function switchTab(tab, to) {
  const tabs = await chrome.tabs.query({ windowId: tab.windowId })
  tabs.sort((a, b) => a.index - b.index)
  const at = tabs.findIndex((t) => t.id === tab.id)
  let next = null
  if (to === 'next') next = tabs[(at + 1) % tabs.length]
  else if (to === 'previous') next = tabs[(at - 1 + tabs.length) % tabs.length]
  else if (to && typeof to.index === 'number') {
    next = tabs[to.index - 1] || null
    if (!next) return fail('not_found', `There is no tab ${to.index}. This window has ${tabs.length} tabs.`)
  } else if (to && typeof to.query === 'string') {
    const q = normalize(to.query)
    const matches = tabs.filter((t) => normalize(t.title).includes(q) || normalize(t.url).includes(q))
    // Prefer a title match, then the first tab after the current one.
    const byTitle = matches.filter((t) => normalize(t.title).includes(q))
    const pool = byTitle.length > 0 ? byTitle : matches
    next = pool.find((t) => t.index > tab.index) || pool[0] || null
    if (!next) return fail('not_found', `No tab matches "${to.query}".`)
  } else return fail('failed', 'switchTab needs next, previous, an index or a query.')
  const updated = await chrome.tabs.update(next.id, { active: true })
  return ok({ tab: tabInfo(updated) })
}

async function execute(command, senderWindowId) {
  if (command.kind === 'ping') return ok()

  const tab = await targetTab(senderWindowId)
  if (!tab) return NO_TARGET()

  switch (command.kind) {
    case 'newTab': {
      if (command.url !== undefined && !webAddress(command.url)) return fail('not_allowed', `Only web addresses can be opened: ${command.url}`)
      if (command.url === undefined) {
        const created = await chrome.tabs.create({ windowId: tab.windowId, active: true })
        return ok({ tab: tabInfo(created) })
      }
      // The new tab's id is unknown until it exists, so poll its status afterwards.
      const created = await chrome.tabs.create({ windowId: tab.windowId, active: true, url: command.url })
      await waitForComplete(created.id)
      return freshTab(created.id)
    }
    case 'closeTab': {
      const windowId = tab.windowId
      await chrome.tabs.remove(tab.id)
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
      await andWaitForLoad(tab.id, () => chrome.tabs.update(tab.id, { url: command.url }))
      return freshTab(tab.id)
    }
    case 'history': {
      const back = command.direction === 'back'
      const nothing = fail('not_found', back ? 'There is no page to go back to.' : 'There is no page to go forward to.')
      try {
        await andWaitForLoad(tab.id, async () => {
          try {
            await (back ? chrome.tabs.goBack(tab.id) : chrome.tabs.goForward(tab.id))
          } catch (error) {
            // Chrome skips history entries made without a user gesture (every navigation an
            // extension makes), so tabs.goBack can refuse where the page's own history.back works.
            if (!scriptable(tab.url)) throw error
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (b) => (b ? history.back() : history.forward()), args: [back] })
          }
        })
      } catch (error) {
        const message = String(error && error.message ? error.message : error)
        return /cannot find/i.test(message) ? nothing : fail('failed', `Could not go ${command.direction}: ${message}`)
      }
      const now = await chrome.tabs.get(tab.id).catch(() => null)
      if (now && now.url === tab.url) return nothing
      return now ? ok({ tab: tabInfo(now) }) : ok()
    }
    case 'reload':
      await andWaitForLoad(tab.id, () => chrome.tabs.reload(tab.id))
      return freshTab(tab.id)
    case 'scroll':
    case 'showHints':
    case 'hideHints':
    case 'insertText':
      return runInPage(tab, command)
    case 'openConversation':
      return openConversation(tab, command)
    case 'clickHint': {
      let result = null
      await andWaitForLoad(tab.id, async () => {
        result = await runInPage(tab, command)
      })
      if (!result.ok) return result
      return freshTab(tab.id)
    }
    default:
      return fail('failed', `Unknown command "${command.kind}".`)
  }
}

async function waitForUrlChange(tabId, before, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const t = await chrome.tabs.get(tabId).catch(() => null)
    if (!t) return false
    if ((t.pendingUrl || t.url) !== before) return true
    await sleep(100)
  }
  return false
}

/**
 * Opens a conversation on the messaging site. A target tab elsewhere first switches to a
 * messaging tab in the same window, or goes to the messaging home. Answers ok only once the
 * address has moved to the clicked conversation, so a following insertText cannot type into the
 * conversation that was open before.
 */
async function openConversation(tab, command) {
  const home = await messagingHome()
  let t = tab
  if (!onMessaging(t.url, home)) {
    const tabs = await chrome.tabs.query({ windowId: t.windowId })
    const there = tabs.find((x) => onMessaging(x.url, home))
    if (there) {
      t = await chrome.tabs.update(there.id, { active: true })
      await waitForComplete(t.id)
    } else {
      await andWaitForLoad(t.id, () => chrome.tabs.update(t.id, { url: home }))
    }
    t = await chrome.tabs.get(t.id)
  }
  const before = t.url
  const result = await runInPage(t, command)
  if (!result.ok) return result
  const href = typeof result.href === 'string' ? result.href : ''
  if (href !== '' && href === before) return freshTab(t.id)
  const changed = await waitForUrlChange(t.id, before, SETTLE_TIMEOUT_MS)
  if (changed) await waitForComplete(t.id)
  else if (href !== '') return fail('failed', 'The conversation did not open, so nothing will be typed. Try again or use the numbers.')
  await sleep(SETTLE_QUIET_MS)
  return freshTab(t.id)
}

async function waitForComplete(tabId) {
  const start = Date.now()
  while (Date.now() - start < LOAD_TIMEOUT_MS) {
    try {
      const t = await chrome.tabs.get(tabId)
      if (t.status === 'complete' && t.url) return
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'utle-command' || sender.id !== chrome.runtime.id || !sender.tab) return false
  ;(async () => {
    // Only the configured Ütle page may drive the browser; anyone else gets no answer.
    if (sender.origin !== (await utleOrigin())) return { ignored: true }
    try {
      return { result: await execute(message.command, sender.tab.windowId) }
    } catch (error) {
      return { result: fail('failed', String(error && error.message ? error.message : error)) }
    }
  })().then(sendResponse)
  return true
})

// ---------- the dock ----------

async function workArea(win) {
  try {
    const displays = await chrome.system.display.getInfo()
    const cx = (win.left || 0) + (win.width || 0) / 2
    const cy = (win.top || 0) + (win.height || 0) / 2
    const hit = displays.find((d) => cx >= d.bounds.left && cx < d.bounds.left + d.bounds.width && cy >= d.bounds.top && cy < d.bounds.top + d.bounds.height)
    const display = hit || displays.find((d) => d.isPrimary) || displays[0]
    if (display) return display.workArea
  } catch {
    // fall through
  }
  return { left: 0, top: 0, width: (win.width || 1280) + (win.left || 0), height: win.height || 800 }
}

/** Opens Ütle docked on the left, or focuses it when it is already open. Returns its window. */
export async function openDock() {
  const url = await utleUrl()
  const origin = await utleOrigin()
  const popups = await chrome.windows.getAll({ windowTypes: ['popup'], populate: true })
  const existing = popups.find((w) => (w.tabs || []).some((t) => (t.url || t.pendingUrl || '').startsWith(origin)))
  if (existing) {
    return chrome.windows.update(existing.id, { focused: true })
  }
  let browser = null
  try {
    browser = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
  } catch {
    browser = null
  }
  const area = await workArea(browser || {})
  const dock = await chrome.windows.create({
    url,
    type: 'popup',
    left: area.left,
    top: area.top,
    width: DOCK_WIDTH,
    height: area.height,
    focused: true,
  })
  if (browser && browser.id !== undefined) {
    try {
      if (browser.state !== 'normal') await chrome.windows.update(browser.id, { state: 'normal' })
      await chrome.windows.update(browser.id, {
        left: area.left + DOCK_WIDTH,
        top: area.top,
        width: Math.max(area.width - DOCK_WIDTH, 400),
        height: area.height,
      })
      // The browser stays the target: remember it as the most recent ordinary window.
      const list = (await recentWindows()).filter((id) => id !== browser.id)
      list.unshift(browser.id)
      await chrome.storage.session.set({ recentWindows: list })
    } catch {
      // a fullscreen or locked window: leave it where it is
    }
  }
  await chrome.windows.update(dock.id, { focused: true })
  return dock
}

chrome.action.onClicked.addListener(() => {
  openDock()
})

// For the test script and for debugging from the service worker console.
globalThis.utleOpenDock = openDock

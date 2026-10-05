// Injected into the page in front (isolated world) by background.ts. Defines globalThis.__utle
// once; background.ts then calls __utle.run(command) and gets a BrowserResult back.
// See docs/ARCHITECTURE.md 20.2 and 21.2.

import type { BoxState, BrowserCommand, BrowserResult } from '../../src/browser/protocol.ts'
import { SITES } from './sites.ts'
import type { Site, SiteName } from './sites.ts'
import { findMessageBox, isTextField, readText, visible } from './box.ts'

/** What background.ts sends: a command plus which messaging site the page is. */
export type PageCommand = BrowserCommand & { site: SiteName | null }

/** openConversation keeps looking this long for the name (lists render after load). */
const FIND_TIMEOUT_MS = 4000
/** insertText and setText keep looking this long for a message box (composers render late). */
const BOX_TIMEOUT_MS = 3000
/** After Enter, how long the text may stay in the box before the send button is tried. */
const ENTER_GRACE_MS = 500
/** pressSend waits this long for the box to empty. */
const SEND_TIMEOUT_MS = 2000
/** On a site whose address does not change, how long a conversation may take to open. */
const OPEN_TIMEOUT_MS = 3000
/** How often the searches look again. */
const POLL_MS = 150

type PageResult = BrowserResult | { ok: true; href: string; settled?: boolean }

const ok = (extra: { box?: BoxState; hints?: number } = {}): BrowserResult => ({ ok: true, ...extra })
const fail = (code: 'not_found' | 'failed', message: string): BrowserResult => ({ ok: false, code, message })
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function siteOf(name: SiteName | null): Site | null {
  return name === null ? null : SITES[name]
}

// ---------- numbered labels ----------

const ACTIONABLE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="textbox"]',
  '[onclick]',
].join(', ')

let hintLayer: HTMLElement | null = null
let hinted: HTMLElement[] = []

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

function sameBox(a: DOMRect, b: DOMRect): boolean {
  return Math.abs(a.left - b.left) < 4 && Math.abs(a.top - b.top) < 4 && Math.abs(a.width - b.width) < 8 && Math.abs(a.height - b.height) < 8
}

function isDisabled(el: HTMLElement): boolean {
  return ('disabled' in el && (el as HTMLButtonElement).disabled === true) || el.getAttribute('aria-disabled') === 'true'
}

function collectActionable(): HTMLElement[] {
  const found: HTMLElement[] = []
  for (const el of document.querySelectorAll<HTMLElement>(ACTIONABLE)) {
    if (isDisabled(el)) continue
    if (!visible(el)) continue
    found.push(el)
  }
  // A nested element with nearly the same box as an actionable ancestor is the same target.
  return found.filter((el) => {
    const box = el.getBoundingClientRect()
    for (const other of found) {
      if (other !== el && other.contains(el) && sameBox(other.getBoundingClientRect(), box)) return false
    }
    return true
  })
}

function hideHints(): void {
  hintLayer?.remove()
  hintLayer = null
  hinted = []
}

function showHints(): BrowserResult {
  hideHints()
  const elements = collectActionable()
  const host = document.createElement('utle-hints')
  host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;'
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    .n { position: absolute; font: bold 15px/1 system-ui, sans-serif; color: #000; background: #ffd400;
         border: 2px solid #000; border-radius: 4px; padding: 2px 5px; box-shadow: 0 1px 3px rgba(0,0,0,.5);
         white-space: nowrap; pointer-events: none; }`
  root.append(style)
  const labels = elements.map((_el, i) => {
    const label = document.createElement('span')
    label.className = 'n'
    label.textContent = String(i + 1)
    root.append(label)
    return label
  })
  document.documentElement.append(host)
  placeLabels(labels, elements)
  hintLayer = host
  hinted = elements
  return ok({ hints: elements.length })
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

// Each label goes outside its element so it never hides the element's text. Spots in order:
// left, above, right, below. The first one that stays in the viewport and covers nothing wins;
// if every spot covers something, the one covering least. Only when no outside spot fits in the
// viewport does the label sit on the element's corner.
function placeLabels(labels: HTMLElement[], elements: HTMLElement[]): void {
  const rects = elements.map((el) => el.getBoundingClientRect())
  const taken: Box[] = []
  elements.forEach((_el, i) => {
    const label = labels[i]
    const r = rects[i]
    if (!label || !r) return
    const w = label.offsetWidth
    const h = label.offsetHeight
    const gap = 2
    const spots: Box[] = [
      [r.left - w - gap, r.top + Math.max((r.height - h) / 2, 0)],
      [r.left, r.top - h - gap],
      [r.right + gap, r.top + Math.max((r.height - h) / 2, 0)],
      [r.left, r.bottom + gap],
    ].map(([x = 0, y = 0]) => ({ left: x, top: y, right: x + w, bottom: y + h }))
    const area = (a: Box, b: Box): number =>
      overlaps(a, b) ? (Math.min(a.right, b.right) - Math.max(a.left, b.left)) * (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0
    // Cost of a spot: how much it covers other elements and labels. Never its own element.
    const cost = (b: Box): number => {
      if (b.left < 0 || b.top < 0 || b.right > window.innerWidth || b.bottom > window.innerHeight || overlaps(b, r)) return Infinity
      return rects.reduce((sum, o) => sum + area(b, o), 0) + taken.reduce((sum, o) => sum + area(b, o) * 4, 0)
    }
    const costs = spots.map(cost)
    const best = costs.indexOf(Math.min(...costs))
    const chosen = spots[best]
    const spot: Box =
      chosen !== undefined && (costs[best] ?? Infinity) < Infinity
        ? chosen
        : { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.max(r.left, 0) + w, bottom: Math.max(r.top, 0) + h }
    taken.push(spot)
    label.style.left = `${spot.left + window.scrollX}px`
    label.style.top = `${spot.top + window.scrollY}px`
  })
}

function caretToEnd(el: HTMLElement): void {
  el.focus()
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    try {
      const end = el.value.length
      el.setSelectionRange(end, end)
    } catch {
      // number and email inputs have no selection range
    }
    return
  }
  const selection = window.getSelection()
  if (!selection) return
  if (selection.rangeCount > 0 && el.contains(selection.anchorNode)) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function activate(el: HTMLElement): void {
  const r = el.getBoundingClientRect()
  const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
  el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse', isPrimary: true }))
  el.dispatchEvent(new MouseEvent('mousedown', init))
  el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse', isPrimary: true }))
  el.dispatchEvent(new MouseEvent('mouseup', init))
  el.click()
}

function clickHint(number: number): BrowserResult {
  const el = hinted[number - 1]
  if (!el) {
    return fail('not_found', hinted.length === 0 ? 'No numbers are showing. Say "numbers" first.' : `There is no number ${number}. The numbers go up to ${hinted.length}.`)
  }
  hideHints()
  if (!el.isConnected) return fail('not_found', `Number ${number} is no longer on the page.`)
  if (isTextField(el)) caretToEnd(el)
  else activate(el)
  return ok()
}

// ---------- scroll ----------

function scrollTarget(): Element {
  let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
  while (el && el !== document.body && el !== document.documentElement) {
    const s = getComputedStyle(el)
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el
    el = el.parentElement
  }
  return document.scrollingElement ?? document.documentElement
}

function scroll(direction: string): BrowserResult {
  const el = scrollTarget()
  const page = Math.round(el.clientHeight * 0.8) || Math.round(window.innerHeight * 0.8)
  if (direction === 'down') el.scrollBy({ top: page, behavior: 'instant' })
  else if (direction === 'up') el.scrollBy({ top: -page, behavior: 'instant' })
  else if (direction === 'top') el.scrollTo({ top: 0, behavior: 'instant' })
  else if (direction === 'bottom') el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
  else return fail('failed', `Unknown scroll direction "${direction}".`)
  return ok()
}

// ---------- the message box ----------

function boxState(el: HTMLElement | null): BoxState {
  return el === null ? { present: false, text: '', armed: false } : { present: true, text: readText(el), armed: true }
}

function nativeSetValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
}

function exec(command: string, value?: string): boolean {
  try {
    return document.execCommand(command, false, value)
  } catch {
    return false
  }
}

/** Types text at the current selection the way a person would, with fallbacks for pages that refuse execCommand. */
async function typeAtSelection(el: HTMLElement, text: string): Promise<void> {
  const before = readText(el)
  if (exec('insertText', text)) {
    if (readText(el) !== before) return
    // Editors that cancel the native edit (Lexical over a selection) apply it in their own update.
    await sleep(30)
    if (readText(el) !== before) return
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    nativeSetValue(el, el.value.slice(0, start) + text + el.value.slice(end))
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    return
  }
  // Rich editors (Lexical, Draft, ProseMirror) handle beforeinput themselves.
  const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: text })
  if (el.dispatchEvent(event)) {
    // Nobody handled it: insert at the caret and tell the page.
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      range.deleteContents()
      range.insertNode(document.createTextNode(text))
      range.collapse(false)
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }
}

async function insertInto(el: HTMLElement, text: string): Promise<void> {
  caretToEnd(el)
  await typeAtSelection(el, text)
}

/** A line break that is never a send: insertLineBreak in a contenteditable (Shift+Enter), a newline in a textarea. */
async function lineBreak(el: HTMLElement): Promise<void> {
  if (el instanceof HTMLTextAreaElement) {
    await typeAtSelection(el, '\n')
    return
  }
  if (el instanceof HTMLInputElement) return
  // Rich editors (Lexical) take a beforeinput insertLineBreak, the event Shift+Enter produces. A
  // plain contenteditable does not handle it, so the browser's own line break follows.
  const handled = !el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertLineBreak' }))
  if (!handled) exec('insertLineBreak')
  // Let the editor apply it and move the caret before the next line is typed.
  await sleep(30)
}

async function selectAllIn(el: HTMLElement): Promise<void> {
  el.focus()
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.select()
    return
  }
  const selection = window.getSelection()
  if (selection) {
    const range = document.createRange()
    range.selectNodeContents(el)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  // Editors such as Lexical read the selection on selectionchange, which fires as a task.
  await sleep(30)
}

/** Puts the caret at the very end of el. True when it had to move (an editor needs a moment to see that). */
function caretAtEnd(el: HTMLElement): boolean {
  el.focus()
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const end = el.value.length
    if (el.selectionStart === end && el.selectionEnd === end) return false
    try {
      el.setSelectionRange(end, end)
    } catch {
      // number and email inputs have no selection range
    }
    return false
  }
  const selection = window.getSelection()
  if (!selection) return false
  if (selection.rangeCount > 0 && selection.isCollapsed && el.contains(selection.anchorNode)) {
    const rest = document.createRange()
    rest.selectNodeContents(el)
    rest.setStart(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset)
    if (rest.toString() === '') return false
  }
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

async function setText(text: string, site: Site | null): Promise<BrowserResult> {
  const el = await waitFor(() => findMessageBox(site), BOX_TIMEOUT_MS)
  if (!el) return fail('not_found', 'There is no message box on this page.')
  // Live dictation (21.3) mostly adds words at the end: type only those, so the box never blanks.
  const current = readText(el)
  const tail = text.slice(current.length)
  if (current !== '' && text.startsWith(current) && !/[\r\n]/.test(tail)) {
    if (caretAtEnd(el)) await sleep(30)
    if (tail !== '') await typeAtSelection(el, tail)
    await sleep(30)
    if (readText(el) === text) return ok({ box: boxState(el) })
  }
  await selectAllIn(el)
  if (readText(el) !== '') {
    const deleted = exec('delete')
    if (deleted && readText(el) !== '') await sleep(30)
    if (!deleted || readText(el) !== '') {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        nativeSetValue(el, '')
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }))
      } else {
        el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'deleteContentBackward' }))
      }
    }
    await sleep(30)
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (const [i, line] of lines.entries()) {
    const target = el.isConnected ? el : findMessageBox(site) ?? el
    if (i > 0) await lineBreak(target)
    if (line !== '') await typeAtSelection(target, line)
  }
  // Let the page's editor commit its state before reading it back.
  await sleep(60)
  return ok({ box: boxState(el.isConnected ? el : findMessageBox(site)) })
}

function pressEnter(el: HTMLElement): void {
  const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 0, bubbles: true, cancelable: true, composed: true }
  el.dispatchEvent(new KeyboardEvent('keydown', init))
  el.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: 13 }))
  el.dispatchEvent(new KeyboardEvent('keyup', init))
}

function sendButton(site: Site | null): HTMLElement | null {
  if (!site) return null
  const hit = document.querySelector<HTMLElement>(site.sendButton)
  if (!hit) return null
  // An icon inside the button: click the button around it.
  return hit.closest<HTMLElement>('button, [role="button"]') ?? hit
}

async function waitFor<T>(find: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = find()
    if (found || Date.now() >= deadline) return found
    await sleep(POLL_MS)
  }
}

/** Enter, then the site's send button, then the form. True once the text has left the box. */
async function send(el: HTMLElement, text: string, site: Site | null): Promise<boolean> {
  const gone = (): boolean => {
    const now = el.isConnected ? el : findMessageBox(site)
    return now === null || !readText(now).includes(text.trim())
  }
  pressEnter(el)
  if (await waitFor(() => (gone() ? true : null), ENTER_GRACE_MS)) return true
  const button = sendButton(site)
  if (button) activate(button)
  else if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.form) el.form.requestSubmit()
  else return false
  return (await waitFor(() => (gone() ? true : null), SEND_TIMEOUT_MS)) === true
}

async function insertText(text: string, submit: boolean, site: Site | null): Promise<BrowserResult> {
  const el = await waitFor(() => findMessageBox(site), BOX_TIMEOUT_MS)
  if (!el) return fail('not_found', 'There is no message box on this page.')
  await insertInto(el, text)
  // Let the page's editor commit its state before Enter.
  await sleep(60)
  if (!submit) return ok()
  const target = el.isConnected ? el : findMessageBox(site) ?? el
  if (await send(target, text, site)) return ok()
  return fail('failed', 'The text is in the box, but pressing Enter did not send it.')
}

async function pressSend(site: Site | null): Promise<BrowserResult> {
  const el = findMessageBox(site)
  if (!el) return fail('not_found', 'There is no message box on this page.')
  const text = readText(el)
  if (text.trim() === '') return fail('failed', 'The message box is empty.')
  if (await send(el, text, site)) return ok({ box: boxState(el.isConnected ? el : findMessageBox(site)) })
  return fail('failed', 'The text is still in the box: it was not sent.')
}

// ---------- open a conversation ----------

function normalize(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function stemMatch(a: string, b: string): boolean {
  const shorter = Math.min(a.length, b.length)
  let p = 0
  while (p < shorter && a[p] === b[p]) p++
  return p >= 3 && p >= shorter - 2
}

function score(query: string, name: string): number {
  if (!query || !name) return 0
  if (name === query) return 100
  const words = name.split(' ')
  const spoken = query.split(' ')
  if (spoken.every((w) => words.includes(w))) return 80
  if (spoken.every((w) => words.some((x) => x.startsWith(w)))) return 60
  if (name.includes(query)) return 40
  // Estonian case endings change the stem (Jaanile -> jaani, Märdile -> mardi, Peetrile ->
  // peetri): a spoken word matches a name word sharing a prefix of at least 3 letters that is
  // at least all but the last two letters of the shorter word.
  if (spoken.every((w) => words.some((x) => stemMatch(w, x)))) return 20
  return 0
}

function nameOf(el: HTMLElement, site: Site | null): string {
  if (site?.rowName && site.conversationRows && el.matches(site.conversationRows)) {
    const titled = el.querySelector(site.rowName)
    const title = titled?.getAttribute('title')
    if (title && title.trim()) return title
  }
  const label = el.getAttribute('aria-label')
  if (label && label.trim()) return label
  const text = (el.innerText || el.textContent || '').trim()
  return text.split('\n')[0] ?? ''
}

const GENERIC_CANDIDATES = 'a[href], [role="link"], li, [role="listitem"], [role="row"], [role="option"]'

/** One pass: the best visible match, and whether a conversation list is on screen at all. */
function findConversation(query: string, site: Site | null): { best: HTMLElement | null; listSeen: boolean } {
  const own = site ? site.conversationRows ?? site.conversationLinks ?? null : null
  const selectors = own ? [own, GENERIC_CANDIDATES] : [GENERIC_CANDIDATES]
  let listSeen = site?.chatList ? document.querySelector(site.chatList) !== null : false
  for (const [i, selector] of selectors.entries()) {
    let best: HTMLElement | null = null
    let bestScore = 0
    let bestLength = Infinity
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (!visible(el)) continue
      if (i === 0 && own) listSeen = true
      const candidate = normalize(nameOf(el, site))
      const s = score(query, candidate)
      if (s > bestScore || (s === bestScore && s > 0 && candidate.length < bestLength)) {
        best = el
        bestScore = s
        bestLength = candidate.length
      }
    }
    if (best) return { best, listSeen }
    // On a site with its own rows, the generic search would match messages and buttons.
    if (site?.conversationRows) break
  }
  return { best: null, listSeen }
}

async function search(name: string, site: Site): Promise<boolean> {
  if (!site.searchField) return false
  const field = document.querySelector<HTMLElement>(site.searchField)
  if (!field || !isTextField(field)) return false
  await selectAllIn(field)
  await typeAtSelection(field, name)
  return true
}

async function openConversation(name: string, site: Site | null): Promise<PageResult> {
  const query = normalize(name)
  if (!query) return fail('not_found', 'No name was given.')
  let last: { best: HTMLElement | null; listSeen: boolean } = { best: null, listSeen: false }
  const look = (): HTMLElement | null => {
    last = findConversation(query, site)
    return last.best
  }
  // On a site with a search field, look briefly first, then search.
  const searchable = site?.searchField !== undefined
  let best = await waitFor(look, searchable ? 1200 : FIND_TIMEOUT_MS)
  if (!best && site && searchable && (await search(name, site))) best = await waitFor(look, FIND_TIMEOUT_MS)
  if (!best) {
    if (site && !last.listSeen) return fail('not_found', 'There is no conversation list on this page. The site may need logging in.')
    return fail('not_found', `No conversation called "${name}" is visible here.`)
  }
  if (site?.conversationRows && best.matches(site.conversationRows)) return openRow(best, site)
  // A list item is not clickable itself; click the link inside it when there is one.
  const clickable = best.matches('a[href], [role="link"], [role="button"]') ? best : best.querySelector<HTMLElement>('a[href], [role="link"], [role="button"]') ?? best
  const href = clickable instanceof HTMLAnchorElement ? clickable.href : ''
  activate(clickable)
  // background.ts waits for the address to change and strips href before answering.
  return { ok: true, href }
}

/** A chat row that opens without changing the address: wait here for its composer and its name. */
async function openRow(row: HTMLElement, site: Site): Promise<PageResult> {
  const wanted = normalize(nameOf(row, site))
  const target = row.querySelector<HTMLElement>(site.rowName ?? 'span[title]') ?? row
  activate(target)
  const opened = await waitFor(() => {
    const composer = document.querySelector<HTMLElement>(site.composer)
    if (!composer || !visible(composer)) return null
    if (!site.openChatName) return true
    const header = document.querySelector(site.openChatName)
    // When the header is not found (an unverified selector), the composer alone is taken as proof.
    if (!header) return true
    return normalize(header.getAttribute('title') ?? header.textContent) === wanted ? true : null
  }, OPEN_TIMEOUT_MS)
  if (!opened) return fail('failed', 'The conversation did not open, so nothing will be typed. Try again or use the numbers.')
  // The search field may still have focus; the next words belong in the composer.
  const composer = document.querySelector<HTMLElement>(site.composer)
  if (composer) caretToEnd(composer)
  return { ok: true, href: '', settled: true }
}

// ---------- entry ----------

async function run(command: PageCommand): Promise<PageResult> {
  const site = siteOf(command.site)
  try {
    switch (command.kind) {
      case 'scroll':
        return scroll(command.direction)
      case 'showHints':
        return showHints()
      case 'hideHints':
        hideHints()
        return ok()
      case 'clickHint':
        return clickHint(command.number)
      case 'insertText':
        return await insertText(String(command.text), command.submit === true, site)
      case 'openConversation':
        return await openConversation(command.name, site)
      case 'readBox':
        return ok({ box: boxState(findMessageBox(site)) })
      case 'setText':
        return await setText(String(command.text), site)
      case 'pressSend':
        return await pressSend(site)
      default:
        return fail('failed', `The page does not know the command "${command.kind}".`)
    }
  } catch (error) {
    return fail('failed', `Something went wrong on the page: ${error instanceof Error ? error.message : String(error)}`)
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __utle: { run(command: PageCommand): Promise<PageResult> } | undefined
}

if (!globalThis.__utle) {
  globalThis.__utle = { run }
  // Same-document navigations do not unload the page, so remove the labels ourselves.
  const nav = (globalThis as { navigation?: EventTarget }).navigation
  nav?.addEventListener('navigate', hideHints)
  window.addEventListener('popstate', hideHints)
  window.addEventListener('hashchange', hideHints)
  window.addEventListener('pagehide', hideHints)
}

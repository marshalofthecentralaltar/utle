// Injected into the page in front (isolated world) by background.ts. Defines globalThis.__utle
// once; background.ts then calls __utle.run(command) and gets a BrowserResult back.
// See docs/ARCHITECTURE.md 20.2 and 21.2, and docs/plans/2026-10-05-m7-understanding.md (M7:
// readPage, clickItem, focusItem, siteSearch, media, pressKey, clearField, arm, the armed box).

import type { BoxState, BrowserCommand, BrowserResult, MediaAction, MediaState, PageContext, PageItem } from '../../src/browser/protocol.ts'
import { SITES, searchFieldFor } from './sites.ts'
import type { Site, SiteName } from './sites.ts'
import { armElement, armedElement, boxState, disarm, findMessageBox, focusedTextField, isTextField, onScreenRect, readText, visible } from './box.ts'

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
/** clickItem on a chat row: how long the row itself gets to open the chat before its name is clicked. */
const ROW_REACT_MS = 800
/** siteSearch: how long a search field may take to appear. */
const SEARCH_FIELD_MS = 1000
/** siteSearch: how long Enter gets to navigate before the form is submitted. */
const ENTER_NAVIGATE_MS = 600
/** siteSearch on a chat list: how long the filtered list gets to settle on one row. */
const FILTER_MS = 1500
/** media on YouTube: how long a keyboard shortcut gets to change the player's state. */
const SHORTCUT_MS = 250
/** readPage lists at most this many items. */
const MAX_ITEMS = 120
/** readPage looks at this many elements at most for a pointer cursor. */
const POINTER_SCAN = 2000
/** How often the searches look again. */
const POLL_MS = 150

type PageResult = BrowserResult | { ok: true; href: string; settled?: boolean }

const ok = (extra: { box?: BoxState; hints?: number; page?: PageContext } = {}): BrowserResult => ({ ok: true, ...extra })
const fail = (code: 'not_found' | 'failed', message: string): BrowserResult => ({ ok: false, code, message })
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function siteOf(name: SiteName | null): Site | null {
  return name === null ? null : SITES[name]
}

// ---------- the visible actionable elements (numbers and readPage) ----------

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
  '[role="row"]',
  '[role="listitem"]',
  '[role="gridcell"]',
  'summary',
  'video',
  'ytd-thumbnail',
  '[tabindex="0"]',
  '[onclick]',
].join(', ')

let hintLayer: HTMLElement | null = null
let hinted: HTMLElement[] = []
/** The elements of the last readPage, by id (1-based, the same numbers the labels would show). */
let pageItems: HTMLElement[] = []

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

function isOurs(el: Element): boolean {
  return el.localName.startsWith('utle-')
}

function roleOf(el: HTMLElement): string {
  const role = el.getAttribute('role')
  if (el instanceof HTMLMediaElement || el.localName === 'ytd-thumbnail') return 'video'
  if (el instanceof HTMLInputElement) return ['button', 'submit', 'reset', 'image', 'checkbox', 'radio'].includes(el.type) ? 'button' : 'field'
  // A plain boolean: the type guard would otherwise narrow el to never below.
  const typeable: boolean = isTextField(el)
  if (typeable || el instanceof HTMLSelectElement || role === 'textbox') return 'field'
  if (el instanceof HTMLAnchorElement || role === 'link') return 'link'
  if (el instanceof HTMLButtonElement || role === 'button' || role === 'checkbox' || el.localName === 'summary') return 'button'
  if (role === 'tab') return 'tab'
  if (role === 'option' || role === 'menuitem') return 'option'
  if (role === 'row' || role === 'listitem' || role === 'gridcell') return 'row'
  return 'other'
}

function firstLine(text: string): string {
  return (text.split('\n').find((line) => line.trim() !== '') ?? '').trim()
}

/** aria-label, else the first line of text, else title, else an inner image's alt, else the placeholder. */
function textOf(el: HTMLElement): string {
  const label = el.getAttribute('aria-label')?.trim()
  if (label) return label.slice(0, 60)
  const own = el instanceof HTMLInputElement ? el.value : firstLine(el.innerText || '')
  if (own.trim()) return own.trim().slice(0, 60)
  const title = el.getAttribute('title')?.trim()
  if (title) return title.slice(0, 60)
  const alt = el.querySelector('img[alt]')?.getAttribute('alt')?.trim()
  if (alt) return alt.slice(0, 60)
  const placeholder = el.getAttribute('placeholder')?.trim()
  if (placeholder) return placeholder.slice(0, 60)
  return ''
}

/** Elements that only their pointer cursor marks as clickable: short text, no actionable element around or inside. */
function pointerTargets(): HTMLElement[] {
  const found: HTMLElement[] = []
  const taken = new Set<HTMLElement>()
  let scanned = 0
  for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
    if (++scanned > POINTER_SCAN) break
    if (isOurs(el) || el.closest(ACTIONABLE) !== null) continue
    const parent = el.parentElement
    if (parent && taken.has(parent)) continue
    if (getComputedStyle(el).cursor !== 'pointer') continue
    const text = (el.innerText || '').trim()
    if (text === '' || text.length > 60 || text.split('\n').length > 2) continue
    if (el.querySelector(ACTIONABLE) !== null) continue
    if (!visible(el)) continue
    found.push(el)
    taken.add(el)
  }
  return found
}

/** Every visible actionable element, top to bottom then left to right. */
function collectActionable(): HTMLElement[] {
  const found: HTMLElement[] = []
  for (const el of document.querySelectorAll<HTMLElement>(ACTIONABLE)) {
    if (isOurs(el) || isDisabled(el)) continue
    if (!visible(el)) continue
    found.push(el)
  }
  found.push(...pointerTargets())
  const kept = found.filter((el) => {
    const box = el.getBoundingClientRect()
    const role = roleOf(el)
    for (const other of found) {
      if (other === el || !other.contains(el)) continue
      // A nested element with nearly the same box as an actionable ancestor is the same target.
      if (sameBox(other.getBoundingClientRect(), box)) return false
      // A cell or a plain element inside a listed row is part of the row.
      if (role === 'row' || role === 'other') return false
    }
    return true
  })
  const rects = new Map(kept.map((el) => [el, el.getBoundingClientRect()] as const))
  const band = (r: DOMRect): number => Math.round(r.top / 12)
  return kept.sort((a, b) => {
    const ra = rects.get(a) ?? new DOMRect()
    const rb = rects.get(b) ?? new DOMRect()
    return band(ra) - band(rb) || ra.left - rb.left
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

/** Focuses a text field the user picked and makes it the dictation target. */
function pick(el: HTMLElement): void {
  caretToEnd(el)
  armElement(el)
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
  if (isTextField(el)) pick(el)
  else activate(el)
  return ok()
}

// ---------- readPage, clickItem, focusItem ----------

/** The largest video on screen, else a playing audio, else any audio. */
function mediaElement(): HTMLMediaElement | null {
  let best: HTMLMediaElement | null = null
  let bestArea = 0
  for (const video of document.querySelectorAll<HTMLVideoElement>('video')) {
    const r = onScreenRect(video)
    if (!r) continue
    const area = (Math.min(r.right, window.innerWidth) - Math.max(r.left, 0)) * (Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))
    if (area > bestArea) {
      best = video
      bestArea = area
    }
  }
  if (best) return best
  const audios = [...document.querySelectorAll<HTMLAudioElement>('audio')]
  return audios.find((a) => !a.paused) ?? audios[0] ?? null
}

function mediaState(el: HTMLMediaElement | null): MediaState | null {
  if (!el) return null
  return { playing: !el.paused, muted: el.muted || el.volume === 0, volume: el.volume, fullscreen: document.fullscreenElement !== null }
}

function readPage(site: Site | null): BrowserResult {
  const elements = collectActionable()
  pageItems = elements
  const items: PageItem[] = []
  elements.forEach((el, i) => {
    if (items.length >= MAX_ITEMS) return
    const role = roleOf(el)
    const text = textOf(el)
    if (text === '' && role !== 'field' && role !== 'video') return
    items.push({ id: i + 1, role, text })
  })
  const page: PageContext = {
    url: location.href,
    title: document.title,
    box: boxState(findMessageBox(site), site),
    items,
    media: mediaState(mediaElement()),
    hints: hintLayer !== null,
  }
  return ok({ page })
}

function itemOf(id: number): HTMLElement | BrowserResult {
  const el = pageItems[id - 1]
  if (!el) return fail('not_found', pageItems.length === 0 ? 'The page has not been read yet.' : `There is no item ${id}. The items go up to ${pageItems.length}.`)
  if (!el.isConnected) return fail('not_found', `Item ${id} is no longer on the page.`)
  return el
}

async function clickItem(id: number, site: Site | null): Promise<PageResult> {
  const el = itemOf(id)
  if (!(el instanceof HTMLElement)) return el
  hideHints()
  const typeable: boolean = isTextField(el)
  if (typeable) {
    pick(el)
    return ok({ box: boxState(el, site) })
  }
  if (site?.conversationRows && el.matches(site.conversationRows)) return clickRow(el, site)
  activate(el)
  return ok()
}

function focusItem(id: number, site: Site | null): BrowserResult {
  const el = itemOf(id)
  if (!(el instanceof HTMLElement)) return el
  const typeable: boolean = isTextField(el)
  const field = typeable ? el : [...el.querySelectorAll<HTMLElement>('input, textarea, [contenteditable], [role="textbox"]')].find((x) => isTextField(x)) ?? null
  if (!field) return fail('not_found', `Item ${id} is not a text field.`)
  hideHints()
  pick(field)
  return ok({ box: boxState(field, site) })
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

/** Selects everything in the field and deletes it, with fallbacks for editors that refuse execCommand. */
async function emptyField(el: HTMLElement): Promise<void> {
  await selectAllIn(el)
  if (readText(el) === '') return
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
    if (readText(el) === text) return ok({ box: boxState(el, site) })
  }
  await emptyField(el)
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (const [i, line] of lines.entries()) {
    const target = el.isConnected ? el : findMessageBox(site) ?? el
    if (i > 0) await lineBreak(target)
    if (line !== '') await typeAtSelection(target, line)
  }
  // Let the page's editor commit its state before reading it back.
  await sleep(60)
  return ok({ box: boxState(el.isConnected ? el : findMessageBox(site), site) })
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
  if (await send(el, text, site)) return ok({ box: boxState(el.isConnected ? el : findMessageBox(site), site) })
  return fail('failed', 'The text is still in the box: it was not sent.')
}

// ---------- clearField, arm, pressKey ----------

/** The user's armed field, else the focused text field, else the site's composer. */
function fieldToClear(site: Site | null): HTMLElement | null {
  const chosen = armedElement()
  if (chosen && isTextField(chosen)) return chosen
  const active = focusedTextField()
  if (active) return active
  const box = findMessageBox(site)
  return box && boxState(box, site).armed ? box : null
}

async function clearField(site: Site | null): Promise<BrowserResult> {
  const el = fieldToClear(site)
  if (!el) return fail('not_found', 'There is no field to clear.')
  await emptyField(el)
  await sleep(60)
  return ok({ box: boxState(el, site) })
}

function arm(on: boolean, site: Site | null): BrowserResult {
  if (!on) {
    disarm()
    return ok({ box: boxState(findMessageBox(site), site) })
  }
  const el = focusedTextField()
  if (!el) return fail('not_found', 'Nothing that takes text is focused. Say "numbers" and pick a field.')
  armElement(el)
  return ok({ box: boxState(el, site) })
}

function pressKey(key: 'Escape' | 'Enter'): BrowserResult {
  let target: Element = document.activeElement ?? document.body
  while (target.shadowRoot?.activeElement) target = target.shadowRoot.activeElement
  const code = key === 'Enter' ? 13 : 27
  const init = { key, code: key, keyCode: code, which: code, charCode: 0, bubbles: true, cancelable: true, composed: true }
  target.dispatchEvent(new KeyboardEvent('keydown', init))
  if (key === 'Enter') target.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: 13 }))
  target.dispatchEvent(new KeyboardEvent('keyup', init))
  if (key === 'Escape' && target instanceof HTMLElement && isTextField(target)) target.blur()
  return ok()
}

// ---------- siteSearch ----------

const GENERIC_SEARCH_FIELDS = [
  'input[type="search"]',
  '[role="searchbox"]',
  'input[name="q"]',
  'textarea[name="q"]',
  'input#search',
  'input[name="search_query"]',
  'input[placeholder*="otsi" i]',
  'input[placeholder*="search" i]',
]

function searchField(site: Site | null): HTMLElement | null {
  const selectors = [searchFieldFor(location.hostname), site?.searchField ?? null, ...GENERIC_SEARCH_FIELDS]
  for (const selector of selectors) {
    if (!selector) continue
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (isTextField(el) && visible(el)) return el
    }
  }
  return null
}

/** True once the page has started leaving (the answer may then never arrive; background.ts waits for the load). */
let leaving = false

async function siteSearch(query: string, site: Site | null): Promise<PageResult> {
  const text = query.trim()
  if (text === '') return fail('not_found', 'Nothing to search for.')
  const field = await waitFor(() => searchField(site), SEARCH_FIELD_MS)
  if (!field) return fail('not_found', 'This page has no search field.')
  await emptyField(field)
  await typeAtSelection(field, text)
  await sleep(60)
  const rows = site?.conversationRows
  if (site && rows) {
    // A chat list: the search filters it. One row left is the one meant.
    const single = await waitFor(() => {
      const shown = [...document.querySelectorAll<HTMLElement>(rows)].filter((row) => visible(row))
      return shown.length === 1 ? shown[0] ?? null : null
    }, FILTER_MS)
    if (single) return openRow(single, site)
    return ok()
  }
  const before = location.href
  pressEnter(field)
  const form = field.closest('form')
  if (form) {
    const navigated = await waitFor(() => (leaving || location.href !== before ? true : null), ENTER_NAVIGATE_MS)
    if (!navigated) form.requestSubmit()
  }
  return ok()
}

// ---------- media ----------

type Check = (el: HTMLMediaElement) => boolean

/** The YouTube shortcut for an action, and how to tell it worked. null: no shortcut (exitFullscreen). */
function shortcutFor(action: MediaAction, el: HTMLMediaElement): { key: string; done: Check } | null {
  const volume = el.volume
  const time = el.currentTime
  switch (action) {
    case 'play':
      return el.paused ? { key: 'k', done: (m) => !m.paused } : { key: '', done: () => true }
    case 'pause':
      return el.paused ? { key: '', done: () => true } : { key: 'k', done: (m) => m.paused }
    case 'toggle':
      return { key: 'k', done: (m) => m.paused !== el.paused }
    case 'mute':
      return el.muted ? { key: '', done: () => true } : { key: 'm', done: (m) => m.muted }
    case 'unmute':
      return el.muted ? { key: 'm', done: (m) => !m.muted } : { key: '', done: () => true }
    case 'volumeUp':
      return { key: 'ArrowUp', done: (m) => !m.muted && (m.volume > volume || volume >= 1) }
    case 'volumeDown':
      return { key: 'ArrowDown', done: (m) => m.volume < volume || volume <= 0 }
    case 'fullscreen':
      return { key: 'f', done: () => document.fullscreenElement !== null }
    case 'exitFullscreen':
      return null
    case 'forward':
      return { key: 'l', done: (m) => m.currentTime > time + 5 || m.ended }
    case 'back':
      return { key: 'j', done: (m) => m.currentTime < time - 5 || time < 10 }
  }
}

/** On YouTube, the player's own keyboard shortcut; true when the element shows it worked. */
async function youtubeShortcut(player: HTMLElement, el: HTMLMediaElement, action: MediaAction): Promise<boolean> {
  const shortcut = shortcutFor(action, el)
  if (!shortcut) return false
  if (shortcut.key === '') return true
  const key = shortcut.key
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key
  const init = { key, code, bubbles: true, cancelable: true, composed: true }
  player.focus()
  player.dispatchEvent(new KeyboardEvent('keydown', init))
  player.dispatchEvent(new KeyboardEvent('keyup', init))
  await sleep(SHORTCUT_MS)
  return shortcut.done(el)
}

async function media(action: MediaAction): Promise<BrowserResult> {
  const el = mediaElement()
  if (!el) return fail('not_found', 'There is no video or audio on this page.')
  if (action === 'exitFullscreen') {
    if (document.fullscreenElement) await document.exitFullscreen()
    return ok()
  }
  const player = document.querySelector<HTMLElement>('#movie_player')
  if (player && player.contains(el) && (await youtubeShortcut(player, el, action))) return ok()
  try {
    switch (action) {
      case 'play':
        await el.play()
        break
      case 'pause':
        el.pause()
        break
      case 'toggle':
        if (el.paused) await el.play()
        else el.pause()
        break
      case 'mute':
        el.muted = true
        break
      case 'unmute':
        el.muted = false
        if (el.volume === 0) el.volume = 0.2
        break
      case 'volumeUp':
        el.volume = Math.min(1, Math.round((el.volume + 0.2) * 10) / 10)
        el.muted = false
        break
      case 'volumeDown':
        el.volume = Math.max(0, Math.round((el.volume - 0.2) * 10) / 10)
        break
      case 'fullscreen':
        await (player ?? el.closest<HTMLElement>('.html5-video-player') ?? el).requestFullscreen()
        break
      case 'forward':
        el.currentTime = Number.isFinite(el.duration) ? Math.min(el.duration, el.currentTime + 10) : el.currentTime + 10
        break
      case 'back':
        el.currentTime = Math.max(0, el.currentTime - 10)
        break
    }
  } catch (error) {
    return fail('failed', `The video did not take "${action}": ${error instanceof Error ? error.message : String(error)}`)
  }
  await sleep(60)
  return ok()
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

/** True once the conversation called wanted is open: its composer is visible and its header says the name. */
function conversationOpen(site: Site, wanted: string): true | null {
  const composer = document.querySelector<HTMLElement>(site.composer)
  if (!composer || !visible(composer)) return null
  if (!site.openChatName) return true
  const header = document.querySelector(site.openChatName)
  // When the header is not found (an unverified selector), the composer alone is taken as proof.
  if (!header) return true
  return normalize(header.getAttribute('title') ?? header.textContent) === wanted ? true : null
}

/** The chat is open: the next words belong in its composer, which is armed. */
function settleInComposer(site: Site): PageResult {
  const composer = document.querySelector<HTMLElement>(site.composer)
  if (composer) pick(composer)
  return { ok: true, href: '', settled: true }
}

/** A chat row that opens without changing the address: wait here for its composer and its name. */
async function openRow(row: HTMLElement, site: Site): Promise<PageResult> {
  const wanted = normalize(nameOf(row, site))
  const target = row.querySelector<HTMLElement>(site.rowName ?? 'span[title]') ?? row
  activate(target)
  const opened = await waitFor(() => conversationOpen(site, wanted), OPEN_TIMEOUT_MS)
  if (!opened) return fail('failed', 'The conversation did not open, so nothing will be typed. Try again or use the numbers.')
  return settleInComposer(site)
}

/** clickItem on a chat row: the row itself first; when the chat does not open, the name inside it. */
async function clickRow(row: HTMLElement, site: Site): Promise<PageResult> {
  const wanted = normalize(nameOf(row, site))
  activate(row)
  let opened = await waitFor(() => conversationOpen(site, wanted), ROW_REACT_MS)
  if (!opened) {
    const name = row.querySelector<HTMLElement>(site.rowName ?? 'span[title]')
    if (name) activate(name)
    opened = await waitFor(() => conversationOpen(site, wanted), OPEN_TIMEOUT_MS)
  }
  if (!opened) return fail('failed', 'The conversation did not open. Try again or use the numbers.')
  return settleInComposer(site)
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
        return ok({ box: boxState(findMessageBox(site), site) })
      case 'setText':
        return await setText(String(command.text), site)
      case 'pressSend':
        return await pressSend(site)
      case 'readPage':
        return readPage(site)
      case 'clickItem':
        return await clickItem(Number(command.id), site)
      case 'focusItem':
        return focusItem(Number(command.id), site)
      case 'siteSearch':
        return await siteSearch(String(command.query), site)
      case 'media':
        return await media(command.action)
      case 'pressKey':
        return pressKey(command.key)
      case 'clearField':
        return await clearField(site)
      case 'arm':
        return arm(command.on === true, site)
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

/** A navigation: the labels go, and the armed field with them (it belonged to the page before). */
function onNavigation(): void {
  hideHints()
  disarm()
}

if (!globalThis.__utle) {
  globalThis.__utle = { run }
  // Same-document navigations do not unload the page, so remove the labels ourselves.
  const nav = (globalThis as { navigation?: EventTarget }).navigation
  nav?.addEventListener('navigate', onNavigation)
  window.addEventListener('popstate', onNavigation)
  window.addEventListener('hashchange', onNavigation)
  window.addEventListener('pagehide', onNavigation)
  window.addEventListener('beforeunload', () => {
    leaving = true
  })
}

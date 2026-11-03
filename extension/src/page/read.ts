// readPage and what acts on its items (click, hint, focus, hover, context menu), the mouse events and the hover state.

import type { BrowserResult, MediaState, PageContext, PageItem } from '../../../src/browser/protocol.ts'
import type { Site } from '../sites.ts'
import { boxState, disarm, elementAt, findMessageBox, isTextField, onScreenRect } from '../box.ts'
import type { PageResult } from './common.ts'
import { fail, leaving, ok, sleep } from './common.ts'
import { clickRow } from './conversation.ts'
import { docsBox } from './document.ts'
import { hideHints, hintLayer, hinted } from './hints.ts'
import { DIALOG, DIALOG_PREFIX, NEAR_PREFIX, TEXT_MAX, TOTAL_MAX, clean, collect, collectText, cut, firstLine, isOurs, mediaElement, pick } from './items.ts'
import { readContacts } from './mail.ts'
import { waitFor } from './messageBox.ts'
import { stopSlowScroll } from './scroll.ts'

/** How long a click gets to show a reaction before the next way of clicking is tried. */
const REACT_MS = 400
/** A clicked item below the fold is scrolled into view and gets this long to settle first. */
const SCROLL_SETTLE_MS = 200
/** A mutation burst of this many nodes counts as the page reacting to a click. */
const BURST_NODES = 20
/** hover re-sends the pointer this often, for this long, so hover-only controls stay while the page is read again. */
const HOVER_REPEAT_MS = 200
const HOVER_HOLD_MS = 3000
/**
 * The elements of the last readPage, by id (1-based). The visible ones first, in the order the
 * numbers would have, then the ones within a viewport below the fold, then the page's markers
 * (its heading, the open chat).
 */
let pageItems: HTMLElement[] = []
/** The elements of pageItems that are below the fold: clickItem scrolls to them first. */
let nearItems = new Set<HTMLElement>()
/** The elements of pageItems that are text items (round 4): clickItem clicks at their centre, nothing more. */
let textItems = new Set<HTMLElement>()
/** The element the pointer rests on (hover), while the page may still react to it. */
let hovered: HTMLElement | null = null
let hoverTimer: ReturnType<typeof setInterval> | null = null

/** The centre of the element's box, clamped to the screen, as event coordinates. */
function centreOf(el: HTMLElement): { clientX: number; clientY: number } {
  const r = el.getBoundingClientRect()
  return {
    clientX: (Math.max(r.left, 0) + Math.min(r.right, window.innerWidth)) / 2,
    clientY: (Math.max(r.top, 0) + Math.min(r.bottom, window.innerHeight)) / 2,
  }
}

function mouseInit(el: HTMLElement, button = 0): MouseEventInit {
  return { bubbles: true, cancelable: true, composed: true, view: window, ...centreOf(el), button, buttons: button === 2 ? 2 : 1 }
}

function pointerInit(el: HTMLElement, button = 0): PointerEventInit {
  return { ...mouseInit(el, button), pointerType: 'mouse', isPrimary: true }
}

/** The element at el's centre when it is inside el (a span of a message), else el: where a real pointer would land. */
function targetAt(el: HTMLElement): HTMLElement {
  const { clientX, clientY } = centreOf(el)
  const hit = elementAt(clientX, clientY)
  return hit instanceof HTMLElement && el.contains(hit) ? hit : el
}

/** The pointer and mouse moves, as a pointer resting on el sends them. */
function move(el: HTMLElement): void {
  el.dispatchEvent(new PointerEvent('pointermove', { ...pointerInit(el), buttons: 0 }))
  el.dispatchEvent(new MouseEvent('mousemove', { ...mouseInit(el), buttons: 0 }))
}

/**
 * The events a mouse sends when it arrives over el: over (bubbling) and enter (on el and on each
 * ancestor, as the browser fires them) for pointer and mouse, then a move. Hover-only controls
 * (WhatsApp's message arrow, YouTube's card menu, Gmail's row actions) show on these.
 */
function arrive(el: HTMLElement): void {
  const pointer = { ...pointerInit(el), buttons: 0 }
  const mouse = { ...mouseInit(el), buttons: 0 }
  el.dispatchEvent(new PointerEvent('pointerover', pointer))
  el.dispatchEvent(new MouseEvent('mouseover', mouse))
  const chain: HTMLElement[] = []
  for (let node: HTMLElement | null = el; node && node !== document.documentElement; node = node.parentElement) chain.unshift(node)
  for (const node of chain) {
    node.dispatchEvent(new PointerEvent('pointerenter', { ...pointer, bubbles: false }))
    node.dispatchEvent(new MouseEvent('mouseenter', { ...mouse, bubbles: false }))
  }
  move(el)
}

/** The events a mouse sends when it leaves el. */
function leave(el: HTMLElement): void {
  const pointer = { ...pointerInit(el), buttons: 0 }
  const mouse = { ...mouseInit(el), buttons: 0 }
  el.dispatchEvent(new PointerEvent('pointerout', pointer))
  el.dispatchEvent(new MouseEvent('mouseout', mouse))
  for (let node: HTMLElement | null = el; node && node !== document.documentElement; node = node.parentElement) {
    node.dispatchEvent(new PointerEvent('pointerleave', { ...pointer, bubbles: false }))
    node.dispatchEvent(new MouseEvent('mouseleave', { ...mouse, bubbles: false }))
  }
}

/** The pointer comes to rest on el: whatever it rested on before (hover) is left, unless el is inside it. */
function restOn(el: HTMLElement): void {
  stopHover(el)
  hovered = el
}

/** The hover sequence, the pointer sequence and a click, as a mouse would send them. */
export function activate(el: HTMLElement): void {
  restOn(el)
  arrive(el)
  el.dispatchEvent(new PointerEvent('pointerdown', pointerInit(el)))
  el.dispatchEvent(new MouseEvent('mousedown', mouseInit(el)))
  el.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit(el), buttons: 0 }))
  el.dispatchEvent(new MouseEvent('mouseup', { ...mouseInit(el), buttons: 0 }))
  el.click()
}

function keyOn(el: Element, key: string): void {
  const code = key === ' ' ? 'Space' : key
  const keyCode = key === 'Enter' ? 13 : key === ' ' ? 32 : key === 'Escape' ? 27 : 0
  const init = { key, code, keyCode, which: keyCode, charCode: 0, bubbles: true, cancelable: true, composed: true }
  el.dispatchEvent(new KeyboardEvent('keydown', init))
  if (key === 'Enter') el.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: 13 }))
  el.dispatchEvent(new KeyboardEvent('keyup', init))
}

const STATE_ATTRIBUTES = ['aria-pressed', 'aria-expanded', 'aria-selected', 'aria-checked', 'class']

/**
 * Watches for any sign that the page reacted to an activation of el: the address or the title
 * changed, the focus moved, a dialog opened or closed, the element's state attributes changed,
 * the element or its surroundings mutated, a burst of nodes changed, or the element went away.
 */
function watchReaction(el: HTMLElement): { seen(): boolean; stop(): void } {
  const url = location.href
  const title = document.title
  const focus = document.activeElement
  const dialogs = document.querySelectorAll(DIALOG).length
  const states = STATE_ATTRIBUTES.map((name) => el.getAttribute(name))
  const above = new Set<Node>()
  for (let node = el.parentElement, depth = 0; node && depth < 3; node = node.parentElement, depth++) above.add(node)
  let burst = 0
  let touched = false
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      burst += record.addedNodes.length + record.removedNodes.length
      if (!touched && (record.target === el || el.contains(record.target) || above.has(record.target))) touched = true
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true })
  return {
    seen: () =>
      leaving ||
      touched ||
      burst >= BURST_NODES ||
      !el.isConnected ||
      location.href !== url ||
      document.title !== title ||
      document.activeElement !== focus ||
      document.querySelectorAll(DIALOG).length !== dialogs ||
      STATE_ATTRIBUTES.some((name, i) => el.getAttribute(name) !== states[i]),
    stop: () => observer.disconnect(),
  }
}

/**
 * Clicks el and makes sure something happened: the pointer sequence and click first; when the page
 * shows no reaction within REACT_MS, focus and Enter, then Space (elements that listen to keys
 * only); when still nothing and el is a link, the address itself.
 */
async function press(el: HTMLElement): Promise<void> {
  const reacted = async (act: () => void): Promise<boolean> => {
    const watch = watchReaction(el)
    act()
    const seen = await waitFor(() => (watch.seen() ? true : null), REACT_MS)
    watch.stop()
    return seen === true || !el.isConnected
  }
  if (await reacted(() => activate(el))) return
  el.focus()
  if (await reacted(() => keyOn(el, 'Enter'))) return
  if (await reacted(() => keyOn(el, ' '))) return
  if (!(el instanceof HTMLAnchorElement)) return
  const raw = el.getAttribute('href') ?? ''
  if (raw === '' || raw.startsWith('#') || /^javascript:/i.test(raw)) return
  if (el.target !== '' && el.target !== '_self') return
  location.assign(el.href)
}

export async function clickHint(number: number): Promise<BrowserResult> {
  const el = hinted[number - 1]
  if (!el) {
    return fail('not_found', hinted.length === 0 ? 'No numbers are showing. Say "numbers" first.' : `There is no number ${number}. The numbers go up to ${hinted.length}.`)
  }
  hideHints()
  if (!el.isConnected) return fail('not_found', `Number ${number} is no longer on the page.`)
  if (isTextField(el)) pick(el)
  else await press(el)
  return ok()
}

function mediaState(el: HTMLMediaElement | null): MediaState | null {
  if (!el) return null
  return { playing: !el.paused, muted: el.muted || el.volume === 0, volume: el.volume, fullscreen: document.fullscreenElement !== null }
}

/** The page's own markers for the model: its heading, and on a messaging site the open chat's name. */
function markers(site: Site | null): Array<{ el: HTMLElement; text: string }> {
  const found: Array<{ el: HTMLElement; text: string }> = []
  for (const h1 of document.querySelectorAll<HTMLElement>('h1')) {
    if (isOurs(h1)) continue
    const text = firstLine(h1.innerText || h1.textContent || '')
    if (text === '' || text.length > 100) continue
    found.push({ el: h1, text: `[pealkiri] ${cut(text)}` })
    break
  }
  if (site?.openChatName) {
    const header = document.querySelector<HTMLElement>(site.openChatName)
    const name = header ? clean(header.getAttribute('title') || header.textContent) : ''
    if (header && name !== '' && onScreenRect(header) !== null) found.push({ el: header, text: `[vestlus] ${cut(name)}` })
  }
  return found
}

export function readPage(site: Site | null): BrowserResult {
  const { visible, near } = collect(site)
  const extra = markers(site)
  const actionable = [...visible, ...near]
  // The text items come last, so the numbers (showHints) and the ids agree on the actionable ones.
  const texts = collectText(site, new Set(extra.map((m) => m.el)), Math.min(TEXT_MAX, TOTAL_MAX - actionable.length - extra.length))
  pageItems = [...actionable.map((c) => c.el), ...extra.map((m) => m.el), ...texts.map((t) => t.el)]
  nearItems = new Set(near.map((c) => c.el))
  textItems = new Set(texts.map((t) => t.el))
  const items: PageItem[] = []
  for (const [i, c] of actionable.entries()) {
    if (c.text === '' && c.role !== 'field' && c.role !== 'video') continue
    const text = c.near ? `${NEAR_PREFIX}${c.text}` : c.dialog ? `${DIALOG_PREFIX}${c.text}` : c.text
    items.push({ id: i + 1, role: c.role, text, ...(c.color === undefined ? {} : { color: c.color }) })
  }
  for (const [i, m] of extra.entries()) items.push({ id: actionable.length + i + 1, role: 'other', text: m.text })
  for (const [i, t] of texts.entries()) items.push({ id: actionable.length + extra.length + i + 1, role: 'text', text: t.text })
  const page: PageContext = {
    url: location.href,
    title: document.title,
    box: docsBox() ?? boxState(findMessageBox(site), site),
    items,
    media: mediaState(mediaElement()),
    hints: hintLayer !== null,
  }
  // mail (29.3.3): the addresses and numbers on the page, when there are any.
  const contacts = readContacts()
  if (contacts.length > 0) page.contacts = contacts
  return ok({ page })
}

function itemOf(id: number): HTMLElement | BrowserResult {
  const el = pageItems[id - 1]
  if (!el) return fail('not_found', pageItems.length === 0 ? 'The page has not been read yet.' : `There is no item ${id}. The items go up to ${pageItems.length}.`)
  if (!el.isConnected) return fail('not_found', `Item ${id} is no longer on the page.`)
  return el
}

/** An item below the fold is scrolled to the middle of the screen before it is used. */
async function bringIntoView(el: HTMLElement): Promise<void> {
  if (!nearItems.has(el) && onScreenRect(el) !== null) return
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  await sleep(SCROLL_SETTLE_MS)
}

export async function clickItem(id: number, site: Site | null): Promise<PageResult> {
  const el = itemOf(id)
  if (!(el instanceof HTMLElement)) return el
  hideHints()
  await bringIntoView(el)
  // A text item (a message) is not a control: the click lands at its centre, with no fallbacks.
  if (textItems.has(el)) {
    activate(targetAt(el))
    return ok()
  }
  const typeable: boolean = isTextField(el)
  if (typeable) {
    pick(el)
    return ok({ box: boxState(el, site) })
  }
  if (site?.conversationRows && el.matches(site.conversationRows)) return clickRow(el, site)
  await press(el)
  return ok()
}

/** The pointer leaves what it rested on. Leaving a parent of the next target would hide what he is after, so that is kept. */
function stopHover(next: HTMLElement | null = null): void {
  if (hoverTimer !== null) clearInterval(hoverTimer)
  hoverTimer = null
  const old = hovered
  hovered = null
  if (old && old.isConnected && old !== next && !(next && old.contains(next))) leave(old)
}

/**
 * Rests the pointer on an item (round 4): the hover sequence at its centre, then a move every
 * HOVER_REPEAT_MS for HOVER_HOLD_MS, so a control that shows on hover only (WhatsApp's message
 * arrow) is there when the page is read again and clicked.
 */
export async function hover(id: number): Promise<BrowserResult> {
  const el = itemOf(id)
  if (!(el instanceof HTMLElement)) return el
  hideHints()
  await bringIntoView(el)
  restOn(el)
  const target = targetAt(el)
  arrive(target)
  const until = Date.now() + HOVER_HOLD_MS
  hoverTimer = setInterval(() => {
    if (hovered !== el || !el.isConnected || Date.now() > until) {
      if (hoverTimer !== null) clearInterval(hoverTimer)
      hoverTimer = null
      return
    }
    move(target.isConnected ? target : el)
  }, HOVER_REPEAT_MS)
  return ok()
}

/** A right click at the item's centre (round 4): the page's own context menu, for sites whose actions live there. */
export async function contextMenu(id: number): Promise<BrowserResult> {
  const el = itemOf(id)
  if (!(el instanceof HTMLElement)) return el
  hideHints()
  await bringIntoView(el)
  const target = targetAt(el)
  restOn(el)
  arrive(target)
  target.dispatchEvent(new PointerEvent('pointerdown', pointerInit(target, 2)))
  target.dispatchEvent(new MouseEvent('mousedown', mouseInit(target, 2)))
  target.dispatchEvent(new MouseEvent('contextmenu', mouseInit(target, 2)))
  target.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit(target, 2), buttons: 0 }))
  target.dispatchEvent(new MouseEvent('mouseup', { ...mouseInit(target, 2), buttons: 0 }))
  return ok()
}

/** Scrolls the item to the middle of the view (round 4). */
export async function scrollToItem(id: number): Promise<BrowserResult> {
  const el = itemOf(id)
  if (!(el instanceof HTMLElement)) return el
  hideHints()
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  await sleep(SCROLL_SETTLE_MS)
  return ok()
}

export async function focusItem(id: number, site: Site | null): Promise<BrowserResult> {
  const el = itemOf(id)
  if (!(el instanceof HTMLElement)) return el
  const typeable: boolean = isTextField(el)
  const field = typeable ? el : [...el.querySelectorAll<HTMLElement>('input, textarea, [contenteditable], [role="textbox"]')].find((x) => isTextField(x)) ?? null
  if (!field) return fail('not_found', `Item ${id} is not a text field.`)
  hideHints()
  await bringIntoView(field)
  pick(field)
  return ok({ box: boxState(field, site) })
}

/** A navigation: the labels go, the armed field with them, and the items of the last readPage (all belonged to the page before). */
export function onNavigation(): void {
  stopSlowScroll()
  hideHints()
  disarm()
  pageItems = []
  textItems = new Set()
  // The pointer still rests where it was (a same-document navigation keeps the element); only the repeat stops.
  if (hoverTimer !== null) clearInterval(hoverTimer)
  hoverTimer = null
}

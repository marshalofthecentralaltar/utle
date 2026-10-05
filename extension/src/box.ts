// Finding and reading the page's message box, and which box is armed for dictation (M7). Shared by
// page.ts (the commands) and strip.ts (making room for the strip). See docs/ARCHITECTURE.md 20.2
// and 21.2, and docs/plans/2026-10-05-m7-understanding.md ("The armed box").

import type { BoxState } from '../../src/browser/protocol.ts'
import type { Site } from './sites.ts'

/** The element's box when it is on screen and not hidden by style, else null. No hit test. */
export function onScreenRect(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return null
  if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) return null
  if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return null
  return r
}

function hitTest(el: Element, r: DOMRect): boolean {
  const left = Math.max(r.left, 0)
  const right = Math.min(r.right, window.innerWidth)
  const top = Math.max(r.top, 0)
  const bottom = Math.min(r.bottom, window.innerHeight)
  const points: Array<[number, number]> = [
    [(left + right) / 2, (top + bottom) / 2],
    [left + 2, top + 2],
    [right - 2, top + 2],
    [left + 2, bottom - 2],
    [right - 2, bottom - 2],
  ]
  for (const [x, y] of points) {
    const hit = document.elementFromPoint(x, y)
    if (hit && (hit === el || el.contains(hit))) return true
  }
  return false
}

/** On screen, not hidden, and not under something else (a dialog, or the strip). */
export function visible(el: Element): boolean {
  const r = onScreenRect(el)
  return r !== null && hitTest(el, r)
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', ''])

export function isTextField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has((el.getAttribute('type') ?? '').toLowerCase()) && !el.readOnly && !el.disabled
  return el.isContentEditable
}

/** The box's text: a field's value, or a contenteditable's text without trailing line breaks. */
export function readText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value
  return (el.innerText || '').replace(/\n+$/, '')
}

/** The focused text field, looking through shadow roots; null when the focus is elsewhere. */
export function focusedTextField(): HTMLElement | null {
  let active: Element | null = document.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return isTextField(active) && active !== document.body ? active : null
}

// ---------- the armed box ----------

// The field the user picked through Ütle (a number, an item, a conversation, "kirjuta siia"). It
// stays armed until the user releases it or the page navigates (page.ts clears it then). A WeakRef,
// so a page that drops the element does not keep it alive through us.
let armed: WeakRef<HTMLElement> | null = null

export function armElement(el: HTMLElement): void {
  armed = new WeakRef(el)
}

export function disarm(): void {
  armed = null
}

/** The element the user armed, while it is still on the page. */
export function armedElement(): HTMLElement | null {
  const el = armed?.deref() ?? null
  if (el && el.isConnected) return el
  if (el) armed = null
  return null
}

const SEARCH_WORDS = /search|otsi|otsing/i

/** A search box: its type or role says so, or its name, id, placeholder or label does. */
export function isSearchField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.type === 'search') return true
  if (el.getAttribute('role') === 'searchbox') return true
  const clues = [el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label')]
  return clues.some((clue) => clue !== null && clue !== '' && SEARCH_WORDS.test(clue))
}

const SEND_WORDS = /(^|[^a-zäöõü])(send|saada|post|postita|comment|kommenteeri|submit|reply|vasta)/i
const BUTTONS = 'button, input[type="submit"], input[type="button"], [role="button"]'
/** How far to the right or below a field its send button may sit. */
const SEND_NEAR_PX = 200

function buttonLabel(el: HTMLElement): string {
  const own = el instanceof HTMLInputElement ? el.value : el.innerText || el.textContent || ''
  return [el.getAttribute('aria-label') ?? '', own, el.getAttribute('title') ?? ''].join(' ')
}

/** A send, post, comment or reply button in the field's form, or within 200 px to its right or below. */
export function sendButtonBeside(el: HTMLElement): HTMLElement | null {
  const form = el.closest('form')
  const r = el.getBoundingClientRect()
  for (const button of document.querySelectorAll<HTMLElement>(BUTTONS)) {
    if (!SEND_WORDS.test(buttonLabel(button))) continue
    if (form && form.contains(button)) return button
    const b = button.getBoundingClientRect()
    if (b.width < 1 || b.height < 1) continue
    const toTheRight = b.left >= r.right - 1 && b.left <= r.right + SEND_NEAR_PX && b.top < r.bottom + SEND_NEAR_PX && b.bottom > r.top - SEND_NEAR_PX
    const below = b.top >= r.bottom - 1 && b.top <= r.bottom + SEND_NEAR_PX && b.left < r.right + SEND_NEAR_PX && b.right > r.left - SEND_NEAR_PX
    if (toTheRight || below) return button
  }
  return null
}

/**
 * What kind of box an element is. The site's composer is a composer; a search box is a search box;
 * on an unknown site a textarea or contenteditable with a send button beside it is a composer too.
 */
export function boxKind(el: HTMLElement, site: Site | null): 'composer' | 'search' | 'field' {
  if (site && el.matches(site.composer)) return 'composer'
  if (isSearchField(el)) return 'search'
  if (!(el instanceof HTMLInputElement) && sendButtonBeside(el)) return 'composer'
  return 'field'
}

/** The field's placeholder, label or title, at most 60 characters. */
export function boxLabel(el: HTMLElement): string {
  const raw = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('title') || ''
  return raw.trim().slice(0, 60)
}

/** The box as the page reports it. Armed: a composer, or the element the user armed. */
export function boxState(el: HTMLElement | null, site: Site | null): BoxState {
  if (el === null) return { present: false, text: '', armed: false, kind: 'none' }
  const kind = boxKind(el, site)
  return { present: true, text: readText(el), armed: kind === 'composer' || armedElement() === el, kind, label: boxLabel(el) }
}

function lowestVisible(selector: string): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestBottom = -Infinity
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (!isTextField(el) || !visible(el)) continue
    const bottom = el.getBoundingClientRect().bottom
    if (bottom > bestBottom) {
      best = el
      bestBottom = bottom
    }
  }
  return best
}

/**
 * The armed element while it is on screen, else the focused text field, else the site's composer,
 * else the lowest visible textbox, textarea or input.
 */
export function findMessageBox(site: Site | null): HTMLElement | null {
  const chosen = armedElement()
  if (chosen && isTextField(chosen) && visible(chosen)) return chosen
  const active = focusedTextField()
  if (active) return active
  const pick = lowestVisible
  if (site) {
    const composer = pick(site.composer)
    if (composer) return composer
  }
  return (
    pick('[contenteditable="true"][role="textbox"], [contenteditable=""][role="textbox"], [contenteditable="plaintext-only"][role="textbox"]') ??
    pick('textarea') ??
    pick('input')
  )
}

/** Like lowestVisible, without the hit test: for a box that may be under the strip. */
function lowestPresent(selector: string): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestBottom = -Infinity
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (!isTextField(el) || onScreenRect(el) === null) continue
    const bottom = el.getBoundingClientRect().bottom
    if (bottom > bestBottom) {
      best = el
      bestBottom = bottom
    }
  }
  return best
}

/** The lowest message box on screen, whether or not something covers it: what the strip must not cover. */
export function bottomBox(site: Site | null): HTMLElement | null {
  if (site) {
    const composer = lowestPresent(site.composer)
    if (composer) return composer
  }
  return (
    lowestPresent('[contenteditable="true"][role="textbox"], [contenteditable=""][role="textbox"], [contenteditable="plaintext-only"][role="textbox"]') ??
    lowestPresent('textarea')
  )
}

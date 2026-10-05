// Finding and reading the page's message box. Shared by page.ts (the commands) and strip.ts
// (making room for the strip). See docs/ARCHITECTURE.md 20.2 and 21.2.

import type { Site } from './sites.ts'

function boxVisible(el: Element): DOMRect | null {
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
  const r = boxVisible(el)
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

/** The focused text field, else the site's composer, else the lowest visible textbox, textarea or input. */
export function findMessageBox(site: Site | null): HTMLElement | null {
  let active: Element | null = document.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  if (isTextField(active) && active !== document.body) return active
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
    if (!isTextField(el) || boxVisible(el) === null) continue
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

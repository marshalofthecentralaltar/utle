// The actionable elements and their names: what readPage and showHints number (M7, round 4).

import type { Site } from '../sites.ts'
import { armElement, hitTest, isTextField, onScreenRect, visible } from '../box.ts'
import { colorName, isFilled, looksLikeButton } from '../buttonLook.ts'

/** readPage lists at most this many items. */
const MAX_ITEMS = 120
/** Of them, at most this many below the fold. */
const NEAR_MAX = 30
/** readPage looks at this many elements at most for a pointer cursor. */
const POINTER_SCAN = 2000

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
  '[tabindex="0"]',
  '[onclick]',
].join(', ')

/** An open dialog: its items come first in readPage, marked "[dialog]". */
export const DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]'
/** A cookie banner is a dialog too: a fixed or absolute layer over a fifth of the viewport that says so. */
const COOKIE_WORDS = /cookie|küpsis|nõustu|accept|consent/i
/** A link to a video (YouTube's watch and shorts pages). */
const VIDEO_HREF = /\/watch\?(.*&)?v=|\/shorts\//
/** Where the page's own content is, against its header, sidebars and footer. */
const MAIN = 'main, [role="main"], #content, #primary, article'
const EDGES = 'header, nav, aside, footer, [role="banner"], [role="navigation"], [role="complementary"], [role="contentinfo"]'
/** The headings and title-like elements an anchor without text takes its name from. */
const TITLES = 'h1, h2, h3, h4, h5, h6, [id*="title" i], [class*="title" i]'
/** An item's text is at most this long. */
const NAME_MAX = 60
/** The text of readPage's items below the fold begins with this. */
export const NEAR_PREFIX = '[allpool] '
/** The text of readPage's items inside an open dialog begins with this. */
export const DIALOG_PREFIX = '[dialog] '
/** The text of readPage's message items (the open chat's messages) begins with this. */
const MESSAGE_PREFIX = '[sõnum] '
/** His own messages (sites.ts messageMine) are "[sõnum] mina: …". */
const MINE_PREFIX = 'mina: '
/** readPage lists at most this many text items (messages, headings, paragraphs) after the actionable ones. */
export const TEXT_MAX = 40
/** readPage lists at most this many items in all: the intent schema's cap. */
export const TOTAL_MAX = 150
/** The things he may refer to that are not clickable: headings, list items and paragraphs. */
const TEXTUAL = 'h1, h2, h3, p, li, [role="listitem"]'
/** A list item or paragraph shorter than this is a label or a crumb; longer than TEXT_LONG, an article. */
const TEXT_MIN = 12
const TEXT_LONG = 160
/** The name of a message's menu control (sites.ts messageMenu): WhatsApp's arrow that appears on hover. */
const MESSAGE_MENU_NAME = 'sõnumi menüü'

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** One actionable element as the collector sees it. */
interface Candidate {
  el: HTMLElement
  /** Its box; for a card merged from several links, the box of its topmost part. */
  rect: DOMRect
  /** Below the fold, within one viewport: present and not hidden, but not on screen. */
  near: boolean
  /** Inside an open dialog or a cookie banner. */
  dialog: boolean
  role: string
  text: string
  /** Round 10 (#5, 34.1): a filled button's colour in one plain word ("black"); absent otherwise. */
  color?: string
}

function sameBox(a: DOMRect, b: DOMRect): boolean {
  return Math.abs(a.left - b.left) < 4 && Math.abs(a.top - b.top) < 4 && Math.abs(a.width - b.width) < 8 && Math.abs(a.height - b.height) < 8
}

export function isDisabled(el: HTMLElement): boolean {
  return ('disabled' in el && (el as HTMLButtonElement).disabled === true) || el.getAttribute('aria-disabled') === 'true'
}

export function isOurs(el: Element): boolean {
  return el.localName.startsWith('utle-')
}

export function area(r: DOMRect): number {
  return Math.max(r.width, 0) * Math.max(r.height, 0)
}

/** The element's box when it is within one viewport below the fold and not hidden by style, else null. */
function nearRect(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return null
  if (r.top < window.innerHeight || r.top >= window.innerHeight * 2) return null
  if (r.right <= 0 || r.left >= window.innerWidth) return null
  if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return null
  return r
}

function roleOf(el: HTMLElement): string {
  const role = el.getAttribute('role')
  if (el instanceof HTMLMediaElement) return 'video'
  if (el instanceof HTMLAnchorElement && (VIDEO_HREF.test(el.href) || el.querySelector('video') !== null)) return 'video'
  if (el instanceof HTMLInputElement) return ['button', 'submit', 'reset', 'image', 'checkbox', 'radio'].includes(el.type) ? 'button' : 'field'
  // A plain boolean: the type guard would otherwise narrow el to never below.
  const typeable: boolean = isTextField(el)
  if (typeable || el instanceof HTMLSelectElement || role === 'textbox') return 'field'
  // Round 10 (#5, 34.1): a link styled as a button (role, class, or a filled box round short text) is a button.
  if (el instanceof HTMLAnchorElement) return looksLikeButton(linkLook(el)) ? 'button' : 'link'
  if (role === 'link') return 'link'
  if (el instanceof HTMLButtonElement || role === 'button' || role === 'checkbox' || el.localName === 'summary') return 'button'
  if (role === 'tab') return 'tab'
  if (role === 'option' || role === 'menuitem') return 'option'
  if (role === 'row' || role === 'listitem' || role === 'gridcell') return 'row'
  return 'other'
}

/**
 * Round 10 (#5, 34.1): the element whose box a link shows: the link, or the cell around it that
 * holds only it (a mail's button is often a filled table cell with the link inside), up to two up.
 */
function boxOfLink(a: HTMLElement): HTMLElement {
  const own = getComputedStyle(a)
  if (isFilled(own.backgroundColor, own.backgroundImage)) return a
  let inner: HTMLElement = a
  let node = a.parentElement
  for (let depth = 0; node && node !== document.body && depth < 2; depth++, inner = node, node = node.parentElement) {
    if (!holdsOnly(node, inner)) break
    const s = getComputedStyle(node)
    if (isFilled(s.backgroundColor, s.backgroundImage)) return node
  }
  return a
}

/**
 * True when nothing in `node` beside `inner` has text or a link, so its text is the link's and it
 * holds one link. Stops at the first sibling that has either: on a list or a menu of many links that
 * is the next one, so the walk costs the same per link however long the list is (round 10 defect 2:
 * comparing the parent's whole textContent made readPage quadratic in the list).
 */
function holdsOnly(node: HTMLElement, inner: HTMLElement): boolean {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child === inner) continue
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.textContent ?? '').trim() !== '') return false
    } else if (child instanceof Element) {
      if ((child.textContent ?? '').trim() !== '' || child.matches('a[href]') || child.querySelector('a[href]')) return false
    }
  }
  return true
}

/** What looksLikeButton reads of a link: its role, its class and its box's, its name, the fill and padding of its box. */
function linkLook(a: HTMLAnchorElement): Parameters<typeof looksLikeButton>[0] {
  const box = boxOfLink(a)
  const s = getComputedStyle(box)
  const inner = box === a ? null : getComputedStyle(a)
  const px = (outer: string, link: string | undefined): number => (Number.parseFloat(outer) || 0) + (link === undefined ? 0 : Number.parseFloat(link) || 0)
  return {
    role: a.getAttribute('role'),
    className: `${a.getAttribute('class') ?? ''} ${box === a ? '' : (box.getAttribute('class') ?? '')}`.trim(),
    // The name only matters for a filled box (looksLikeButton's third rule); innerText costs a layout read per link.
    text: isFilled(s.backgroundColor, s.backgroundImage) ? firstLine(a.innerText || a.textContent || '') : '',
    background: s.backgroundColor,
    backgroundImage: s.backgroundImage,
    padding: { top: px(s.paddingTop, inner?.paddingTop), right: px(s.paddingRight, inner?.paddingRight), bottom: px(s.paddingBottom, inner?.paddingBottom), left: px(s.paddingLeft, inner?.paddingLeft) },
  }
}

/** Round 10 (#5, 34.1): a button's fill in one plain word, or undefined (transparent, faint, a gradient). */
function buttonColor(el: HTMLElement): string | undefined {
  const box = el instanceof HTMLAnchorElement ? boxOfLink(el) : el
  return colorName(getComputedStyle(box).backgroundColor) ?? undefined
}

// ----- accessible names -----

/** Whitespace collapsed, trimmed. */
export function clean(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cut(text: string): string {
  return text.length > NAME_MAX ? text.slice(0, NAME_MAX).trimEnd() : text
}

export function firstLine(text: string): string {
  return clean(text.split('\n').find((line) => line.trim() !== '') ?? '')
}

/** The text of the elements aria-labelledby points to, joined. */
function labelledBy(el: HTMLElement): string {
  const ids = el.getAttribute('aria-labelledby')
  if (!ids) return ''
  return clean(
    ids
      .split(/\s+/)
      .map((id) => (id === '' ? '' : document.getElementById(id)?.textContent ?? ''))
      .join(' '),
  )
}

/** A field's <label for> or wrapping <label>. */
function labelOf(el: HTMLElement): string {
  const own = 'labels' in el ? (el as HTMLInputElement).labels : null
  if (own && own.length > 0) return clean([...own].map((label) => label.textContent).join(' '))
  if (el.id !== '') {
    const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    if (byFor) return clean(byFor.textContent)
  }
  const wrapping = el.closest('label')
  return wrapping ? clean(wrapping.textContent) : ''
}

function isFieldLike(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return !['button', 'submit', 'reset', 'image'].includes(el.type)
  const typeable: boolean = isTextField(el)
  return typeable || el instanceof HTMLSelectElement || el.getAttribute('role') === 'textbox'
}

/** An image's alt or an svg's title inside the element. */
function pictureName(el: HTMLElement): string {
  const alt = clean(el.querySelector('img[alt]')?.getAttribute('alt'))
  if (alt) return alt
  return clean(el.querySelector('svg title')?.textContent)
}

/** For a link without text: the heading or title in the card around it (a YouTube thumbnail's #video-title). */
function cardTitle(el: HTMLElement): string {
  let node = el.parentElement
  for (let depth = 0; node && node !== document.body && depth < 6; depth++, node = node.parentElement) {
    const titles = node.querySelectorAll<HTMLElement>(TITLES)
    // Many titles means the ancestor is a list of cards, not the card.
    if (titles.length === 0 || titles.length > 4) continue
    for (const title of titles) {
      const text = firstLine(title.innerText || title.textContent || '')
      if (text) return text
    }
  }
  return ''
}

/**
 * The element's name the way an accessibility tree computes it: aria-labelledby, aria-label, a
 * field's label, placeholder and title, an image's alt, the first line of visible text, title, an
 * inner image's alt or svg title, and for a link without text the title of its card. On a
 * messaging site a chat row's name is its title span (sites.ts).
 */
function nameOfItem(el: HTMLElement, site: Site | null): string {
  if (site?.rowName && site.conversationRows && el.matches(site.conversationRows)) {
    const titled = clean(el.querySelector(site.rowName)?.getAttribute('title'))
    if (titled) return cut(titled)
  }
  if (site?.messageMenu && (el.matches(site.messageMenu) || el.querySelector(site.messageMenu) !== null) && site.messageRows && el.closest(site.messageRows) !== null) return MESSAGE_MENU_NAME
  const by = labelledBy(el)
  if (by) return cut(by)
  const own = el instanceof HTMLInputElement ? '' : firstLine(el.innerText || '')
  const label = clean(el.getAttribute('aria-label'))
  // A label that spells out the visible text ("Title by Channel 3 weeks ago 10 minutes"): the visible text.
  if (label) return cut(own !== '' && label.startsWith(own) ? own : label)
  if (isFieldLike(el)) {
    const field = labelOf(el) || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title'))
    if (field) return cut(field)
  }
  if (el instanceof HTMLImageElement) {
    const alt = clean(el.alt)
    if (alt) return cut(alt)
  }
  if (own) return cut(own)
  if (el instanceof HTMLInputElement && clean(el.value)) return cut(el.value)
  const title = clean(el.getAttribute('title'))
  if (title) return cut(title)
  const picture = pictureName(el)
  if (picture) return cut(picture)
  if (el instanceof HTMLAnchorElement || el.getAttribute('role') === 'link') {
    const card = cardTitle(el)
    if (card) return cut(card)
  }
  return cut(clean(el.getAttribute('placeholder')))
}

// ----- which elements -----

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

/** True when the element is a cookie banner: fixed or absolute, layered, over a fifth of the viewport, and says so. */
function isCookieBanner(el: Element): boolean {
  const s = getComputedStyle(el)
  if (s.position !== 'fixed' && s.position !== 'absolute') return false
  if (s.position === 'absolute' && s.zIndex === 'auto') return false
  const r = el.getBoundingClientRect()
  if (r.height > window.innerHeight * 1.5) return false
  if (area(r) < window.innerWidth * window.innerHeight * 0.2) return false
  const text = el.textContent ?? ''
  return text.length < 3000 && COOKIE_WORDS.test(text)
}

/** Whether the element is inside an open dialog or a cookie banner; memo is per collection. */
function inDialog(el: Element, memo: Map<Element, boolean>): boolean {
  const known = memo.get(el)
  if (known !== undefined) return known
  let result = false
  if (el !== document.body && el !== document.documentElement) {
    result = el.matches(DIALOG) || isCookieBanner(el) || (el.parentElement !== null && inDialog(el.parentElement, memo))
  }
  memo.set(el, result)
  return result
}

/**
 * The address a link goes to, for merging a card's links into one item: without the hash, and for
 * a YouTube watch page just the video. A small container with a link inside shares the link's key.
 */
function hrefKey(el: HTMLElement, rect: DOMRect): string {
  let a: HTMLAnchorElement | null = el instanceof HTMLAnchorElement ? el : null
  if (!a && area(rect) < window.innerWidth * window.innerHeight * 0.25) a = el.querySelector('a[href]')
  if (!a) return ''
  const raw = a.getAttribute('href') ?? ''
  if (raw === '' || raw.startsWith('#') || /^javascript:/i.test(raw)) return ''
  try {
    const u = new URL(a.href)
    u.hash = ''
    const v = u.searchParams.get('v')
    if (u.pathname === '/watch' && v) return `${u.origin}/watch?v=${v}`
    return u.href
  } catch {
    return ''
  }
}

/** Items with text, in the main content, and larger come first when there are too many. */
function rank(c: Candidate): number {
  const inMain = c.el.closest(MAIN) !== null
  const atEdge = c.el.closest(EDGES) !== null
  return (c.text !== '' ? 4 : 0) + (inMain ? 2 : 0) + (atEdge ? 0 : 1) + Math.min(area(c.rect) / (window.innerWidth * window.innerHeight), 0.5)
}

/** Top to bottom in bands of 12 px, then left to right. */
function byPosition(a: { rect: DOMRect }, b: { rect: DOMRect }): number {
  const band = (r: DOMRect): number => Math.round(r.top / 12)
  return band(a.rect) - band(b.rect) || a.rect.left - b.rect.left
}

/** The main video, when it is on screen: listed even under the player's overlays. */
function mainVideo(): HTMLVideoElement | null {
  const el = mediaElement()
  return el instanceof HTMLVideoElement && onScreenRect(el) !== null ? el : null
}

/**
 * Every actionable element: the visible ones (the numbers), and the ones within a viewport below
 * the fold. Both lists are in reading order, with an open dialog's items first; links to the same
 * address are one item (a video card's thumbnail, title and duration), named by the best of them.
 */
export function collect(site: Site | null): { visible: Candidate[]; near: Candidate[] } {
  const video = mainVideo()
  const raw: Array<{ el: HTMLElement; rect: DOMRect; near: boolean }> = []
  for (const el of document.querySelectorAll<HTMLElement>(ACTIONABLE)) {
    if (isOurs(el) || isDisabled(el) || isMessagePart(el, site)) continue
    const on = onScreenRect(el)
    if (on && (el === video || hitTest(el, on))) raw.push({ el, rect: on, near: false })
    else if (!on) {
      const below = nearRect(el)
      if (below) raw.push({ el, rect: below, near: true })
    }
  }
  for (const el of pointerTargets()) {
    if (!isMessagePart(el, site)) raw.push({ el, rect: el.getBoundingClientRect(), near: false })
  }
  // A nested element with nearly the same box as an actionable ancestor is the same target; a cell
  // or a plain element inside a listed row is part of the row.
  const kept = raw.filter((c) => {
    const role = roleOf(c.el)
    for (const other of raw) {
      if (other === c || !other.el.contains(c.el)) continue
      if (sameBox(other.rect, c.rect)) return false
      if (role === 'row' || role === 'other') return false
    }
    return true
  })
  const memo = new Map<Element, boolean>()
  const named: Candidate[] = kept.map((c) => {
    const role = roleOf(c.el)
    const color = role === 'button' ? buttonColor(c.el) : undefined
    return {
      el: c.el,
      rect: c.rect,
      near: c.near,
      dialog: inDialog(c.el, memo),
      role,
      text: c.el === video ? 'praegune video' : nameOfItem(c.el, site),
      ...(color === undefined ? {} : { color }),
    }
  })
  // One item per address: the member with the longest name, placed where the topmost member is.
  const byHref = new Map<string, Candidate>()
  const merged: Candidate[] = []
  for (const c of named) {
    const key = hrefKey(c.el, c.rect)
    if (key === '') {
      merged.push(c)
      continue
    }
    const first = byHref.get(key)
    if (!first) {
      byHref.set(key, c)
      merged.push(c)
      continue
    }
    const better = (!c.near && first.near) || (c.near === first.near && c.text.length > first.text.length)
    if (better) {
      first.el = c.el
      first.text = c.text
      first.role = first.role === 'video' || c.role === 'video' ? 'video' : c.role
      first.near = c.near
      if (c.color === undefined) delete first.color
      else first.color = c.color
    }
    if (c.rect.top < first.rect.top) first.rect = c.rect
  }
  let visible = merged.filter((c) => !c.near)
  if (visible.length > MAX_ITEMS) {
    const dialogs = visible.filter((c) => c.dialog)
    const rest = visible.filter((c) => !c.dialog).sort((a, b) => rank(b) - rank(a))
    visible = [...dialogs, ...rest.slice(0, Math.max(MAX_ITEMS - dialogs.length, 0))]
  }
  visible.sort((a, b) => Number(b.dialog) - Number(a.dialog) || byPosition(a, b))
  // A banner over the whole page (delfi.ee's popup on a full-screen overlay, err.ee's modal, 30.4):
  // nothing outside it can be reached, so neither the items below the fold nor the main video are listed.
  const covered = visible.some((c) => c.dialog) && visible.every((c) => c.dialog || c.el === video)
  if (covered) visible = visible.filter((c) => c.dialog)
  const near = merged
    .filter((c) => c.near && !covered)
    .sort(byPosition)
    .slice(0, Math.max(Math.min(NEAR_MAX, MAX_ITEMS - visible.length), 0))
  return { visible, near }
}

// ----- the text items (round 4): what he may refer to that is not clickable -----

/**
 * A message of the open chat, or a plain part of one (sites.ts messageRows): the text items list
 * it as "[sõnum] …", so the actionable list leaves it out. A control inside a message (the hover
 * arrow, a link, a button) stays actionable.
 */
function isMessagePart(el: HTMLElement, site: Site | null): boolean {
  if (!site?.messageRows) return false
  const role = roleOf(el)
  if (role !== 'row' && role !== 'other') return false
  // Inside a message, or a row that wraps one (WhatsApp's role=row around each message).
  return el.closest(site.messageRows) !== null || el.querySelector(site.messageRows) !== null
}

/** One text item as the collector sees it. */
interface TextItem {
  el: HTMLElement
  rect: DOMRect
  text: string
}

/** The text of a message: its text element (sites.ts messageText), else its own text. */
function messageText(el: HTMLElement, site: Site | null): string {
  if (site?.messageText) {
    for (const part of el.querySelectorAll<HTMLElement>(site.messageText)) {
      const text = clean(part.innerText || part.textContent)
      if (text !== '') return text
    }
  }
  return clean(el.innerText || el.textContent)
}

/**
 * The things he may refer to that are not clickable: the open chat's messages ("[sõnum] …"), then
 * headings, list items and paragraphs. Visible, deduplicated, top to bottom, at most limit. In a
 * chat the last messages matter most, so over the limit the bottom-most are kept; elsewhere the
 * top-most. skip holds the elements already listed as markers (the page's heading).
 */
export function collectText(site: Site | null, skip: Set<Element>, limit: number): TextItem[] {
  if (limit <= 0) return []
  const found: TextItem[] = []
  const seen = new Set<string>()
  let chat = false
  if (site?.messageRows) {
    for (const el of document.querySelectorAll<HTMLElement>(site.messageRows)) {
      // Nested matches (a row and the bubble inside it) are one message: the outermost.
      if (isOurs(el) || el.parentElement?.closest(site.messageRows)) continue
      const rect = onScreenRect(el)
      if (!rect || !hitTest(el, rect)) continue
      const text = messageText(el, site)
      if (text === '') continue
      chat = true
      seen.add(text.toLowerCase())
      const mine = site.messageMine !== undefined && (el.matches(site.messageMine) || el.querySelector(site.messageMine) !== null)
      found.push({ el, rect, text: `${MESSAGE_PREFIX}${mine ? MINE_PREFIX : ''}${cut(text)}` })
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>(TEXTUAL)) {
    if (isOurs(el) || skip.has(el)) continue
    if (site?.messageRows && el.closest(site.messageRows) !== null) continue
    // Text inside or around a clickable thing is that thing's name already; a block holding
    // smaller blocks is listed through them.
    if (el.closest(ACTIONABLE) !== null || el.querySelector(ACTIONABLE) !== null || el.querySelector(TEXTUAL) !== null) continue
    const rect = onScreenRect(el)
    if (!rect || !hitTest(el, rect)) continue
    const text = clean(el.innerText || el.textContent)
    const heading = /^h[1-3]$/.test(el.localName)
    if (text.length < (heading ? 2 : TEXT_MIN) || text.length > TEXT_LONG) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ el, rect, text: cut(text) })
  }
  found.sort(byPosition)
  if (found.length <= limit) return found
  return chat ? found.slice(found.length - limit) : found.slice(0, limit)
}

export function caretToEnd(el: HTMLElement): void {
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
export function pick(el: HTMLElement): void {
  caretToEnd(el)
  armElement(el)
}

/** The largest video on screen, else a playing audio, else any audio. */
export function mediaElement(): HTMLMediaElement | null {
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

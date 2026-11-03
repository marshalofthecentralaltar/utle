// Reading aloud (29.5): the text of the page or the selection.

import type { BrowserResult } from '../../../src/browser/protocol.ts'
import type { Site } from '../sites.ts'
import { boxState, findMessageBox } from '../box.ts'
import { readingText } from '../../../src/core/reading.ts'
import { docsBox } from './document.ts'
import { clean } from './items.ts'

/** The blocks a reading is made of; a block holding another one is read through it. */
const READ_BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote'
/** Never read: the page's chrome around the article, dialogs, hidden parts, bylines, and Ütle's own elements. */
const READ_SKIP = [
  'nav', 'aside', 'footer', 'form', 'button', 'dialog', 'figcaption', 'address',
  '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', '[role="navigation"]', '[role="complementary"]',
  '[role="contentinfo"]', '[role="banner"]', '[role="search"]', '[hidden]', '[aria-hidden="true"]',
  '[class*="byline" i]', '[rel="author"]', '[itemprop="author"]', 'utle-strip', 'utle-hints',
].join(', ')
/** A paragraph or list item shorter than this is read only when it ends like a sentence. */
const READ_MIN = 40

/** The article's root: the main region, else the article, else the content column, else the body. */
function readRoot(): HTMLElement {
  for (const selector of ['main, [role="main"]', 'article', '#content, #primary']) {
    const el = document.querySelector<HTMLElement>(selector)
    if (el) return el
  }
  return document.body
}

/** Inside a fixed or sticky layer (a cookie banner without a role, a sticky header). */
function inFixedLayer(el: HTMLElement, root: HTMLElement, seen: Map<Element, boolean>): boolean {
  const chain: Element[] = []
  let found = false
  for (let at: Element | null = el; at !== null && at !== root.parentElement; at = at.parentElement) {
    const known = seen.get(at)
    if (known !== undefined) {
      found = known
      break
    }
    chain.push(at)
    const position = getComputedStyle(at).position
    if (position === 'fixed' || position === 'sticky') {
      found = true
      break
    }
  }
  for (const at of chain) seen.set(at, found)
  return found
}

/** Text beside a list in its wrapper, below which a list next to a button is a teaser, not the article. */
const TEASER_TEXT = 100

/**
 * A list of selling points beside a call to action (postimees.ee's subscriber teaser, 30.4): the
 * list's parent or grandparent holds a button outside the list and under TEASER_TEXT characters of
 * text besides it. An article's own list sits in the article's long text and is still read.
 */
function inTeaserList(el: HTMLElement, memo: Map<Element, boolean>): boolean {
  const list = el.closest('ul, ol')
  if (list === null) return false
  const known = memo.get(list)
  if (known !== undefined) return known
  const own = clean(list.textContent).length
  let result = false
  let wrap = list.parentElement
  for (let level = 0; level < 2 && wrap !== null && !result; level++, wrap = wrap.parentElement) {
    const button = [...wrap.querySelectorAll('button, [role="button"]')].some((b) => !list.contains(b))
    result = button && clean(wrap.textContent).length - own < TEASER_TEXT
  }
  memo.set(list, result)
  return result
}

/** The article's headings and paragraphs, in order, as plain text. */
function articleBlocks(): string[] {
  const root = readRoot()
  const fixed = new Map<Element, boolean>()
  const teasers = new Map<Element, boolean>()
  const seen = new Set<string>()
  const blocks: string[] = []
  for (const el of root.querySelectorAll<HTMLElement>(READ_BLOCKS)) {
    if (el.querySelector(READ_BLOCKS) !== null) continue
    if (el.closest(READ_SKIP) !== null) continue
    const header = el.closest('header')
    if (header !== null && header.closest('article, main, [role="main"]') === null) continue
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkVisibilityCSS: true })) continue
    if (inFixedLayer(el, root, fixed)) continue
    if (el.localName === 'li' && inTeaserList(el, teasers)) continue
    const text = clean(el.innerText || el.textContent)
    const heading = /^h[1-6]$/.test(el.localName)
    if (heading ? text.length < 2 : text.length < READ_MIN && !/[.!?…]["'”»)\]]*$/u.test(text)) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    blocks.push(text)
  }
  return blocks
}

/** read page, box or selection: the text and its sentences (29.5). The box and the selection fall back to the page when empty. */
export function readAloudText(what: 'page' | 'box' | 'selection' | 'continue' | 'stop', site: Site | null): BrowserResult {
  if (what === 'box') {
    const box = docsBox() ?? boxState(findMessageBox(site), site)
    if (box.armed && box.text.trim() !== '') return { ok: true, reading: readingText(box.text.split(/\n+/)) }
  }
  if (what === 'selection') {
    const selected = window.getSelection()?.toString() ?? ''
    if (selected.trim() !== '') return { ok: true, reading: readingText(selected.split(/\n+/)) }
  }
  return { ok: true, reading: readingText(articleBlocks()) }
}

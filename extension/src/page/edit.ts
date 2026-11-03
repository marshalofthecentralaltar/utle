// Editing inside the field (round 3, the edit lane): the text model, caret and select, typeText.

import type { BrowserResult, CaretTarget, PressableKey, SelectTarget } from '../../../src/browser/protocol.ts'
import type { Site } from '../sites.ts'
import { boxState, findMessageBox } from '../box.ts'
import { fail, ok, sleep } from './common.ts'
import { docsSelectDocument, lastWordsOf, paragraphAt } from './document.ts'
import { dispatchKey, fieldToClear } from './field.ts'
import { typeAtSelection } from './messageBox.ts'

//
// Every editing command works on one text model of the field: a value for input and textarea, and for
// a contenteditable the text of its text nodes in order with a line break for <br> and between blocks.
// Character offsets in that text map to DOM positions and back, so the caret, a selection and typing
// at the caret behave the same in both kinds of field. Google Docs has no text we can read (its editor
// is a canvas); there the keys and typing go to its keyboard target, and the rest answers failed.

/** Character offsets in the field's text: start <= end. */
export interface Span {
  start: number
  end: number
}

interface TextModel {
  text: string
  /** Contenteditable only: the text nodes in order, each with its offset in text. */
  segments: { node: Text; start: number }[]
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR', 'SECTION', 'ARTICLE', 'DD', 'DT'])

export function modelOf(el: HTMLElement): TextModel {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return { text: el.value, segments: [] }
  const segments: TextModel['segments'] = []
  let text = ''
  const walk = (node: Node): void => {
    if (node instanceof Text) {
      segments.push({ node, start: text.length })
      text += node.data
      return
    }
    if (!(node instanceof Element)) return
    if (node instanceof HTMLBRElement) {
      text += '\n'
      return
    }
    const block = BLOCK_TAGS.has(node.tagName)
    if (block && text !== '' && !text.endsWith('\n')) text += '\n'
    for (const child of node.childNodes) walk(child)
    if (block && text !== '' && !text.endsWith('\n')) text += '\n'
  }
  for (const child of el.childNodes) walk(child)
  // Trailing breaks (an editor's final <br>) are not positions he can mean.
  return { text: text.replace(/\n+$/, ''), segments }
}

/** The DOM position of a character offset: inside the text node that holds it, else the start of the next one. */
function domPosition(el: HTMLElement, model: TextModel, offset: number): { node: Node; offset: number } {
  for (const seg of model.segments) {
    const end = seg.start + seg.node.data.length
    if (offset >= seg.start && offset <= end) return { node: seg.node, offset: offset - seg.start }
  }
  const next = model.segments.find((seg) => seg.start >= offset)
  if (next) return { node: next.node, offset: 0 }
  const last = model.segments.at(-1)
  if (last) return { node: last.node, offset: last.node.data.length }
  return { node: el, offset: 0 }
}

/** The character offset of a DOM position: in its text node, else the first text node after it. */
function offsetOf(model: TextModel, node: Node, offset: number): number {
  for (const seg of model.segments) if (seg.node === node) return seg.start + offset
  try {
    const point = document.createRange()
    point.setStart(node, offset)
    point.collapse(true)
    for (const seg of model.segments) if (point.comparePoint(seg.node, 0) === 1) return seg.start
  } catch {
    // a node outside the document: the end
  }
  return model.text.length
}

/** The field's selection as offsets; the end of the text when the selection is elsewhere. */
export function spanOf(el: HTMLElement, model: TextModel): Span {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? model.text.length
    const end = el.selectionEnd ?? start
    return { start: Math.min(start, end), end: Math.max(start, end) }
  }
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !selection.focusNode || !el.contains(selection.anchorNode) || !el.contains(selection.focusNode)) {
    return { start: model.text.length, end: model.text.length }
  }
  const a = offsetOf(model, selection.anchorNode, selection.anchorOffset)
  const b = offsetOf(model, selection.focusNode, selection.focusOffset)
  return { start: Math.min(a, b), end: Math.max(a, b) }
}

/** Selects the offsets in the field (a collapsed span is the caret). Editors read the selection on a task, so a moment is given. */
export async function setSpan(el: HTMLElement, model: TextModel, span: Span): Promise<void> {
  el.focus()
  const start = Math.max(0, Math.min(span.start, model.text.length))
  const end = Math.max(start, Math.min(span.end, model.text.length))
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    try {
      el.setSelectionRange(start, end)
    } catch {
      // number and email inputs have no selection range
    }
    return
  }
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  const from = domPosition(el, model, start)
  const to = domPosition(el, model, end)
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  selection.removeAllRanges()
  selection.addRange(range)
  await sleep(30)
}

// The text rules: pure functions of the text and an offset.

const WORD_CHAR = /[\p{L}\p{N}'’-]/u
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && WORD_CHAR.test(ch)
export const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\t'
const SENTENCE_MARK = /[.!?…]/u

export function lineStartOf(text: string, pos: number): number {
  return text.lastIndexOf('\n', pos - 1) + 1
}

export function lineEndOf(text: string, pos: number): number {
  const i = text.indexOf('\n', pos)
  return i < 0 ? text.length : i
}

/** The start of the sentence the caret is in; from a sentence's very start, the one before. */
function sentenceStartOf(text: string, pos: number): number {
  let i = pos
  while (i > 0 && /[\s.!?…]/u.test(text.charAt(i - 1))) i--
  while (i > 0 && !/[.!?…\n]/u.test(text.charAt(i - 1))) i--
  while (i < pos && isSpace(text.charAt(i))) i++
  return i
}

/** Just after the sentence's closing mark (or marks), or at the line break or the end. */
function sentenceEndOf(text: string, pos: number): number {
  let i = pos
  while (i < text.length && !SENTENCE_MARK.test(text.charAt(i)) && text.charAt(i) !== '\n') i++
  while (i < text.length && SENTENCE_MARK.test(text.charAt(i))) i++
  return i
}

function wordBackOf(text: string, pos: number): number {
  let i = pos
  while (i > 0 && !isWordChar(text.charAt(i - 1))) i--
  while (i > 0 && isWordChar(text.charAt(i - 1))) i--
  return i
}

function wordForwardOf(text: string, pos: number): number {
  let i = pos
  while (i < text.length && !isWordChar(text.charAt(i))) i++
  while (i < text.length && isWordChar(text.charAt(i))) i++
  return i
}

/** The span plus the spaces after it, or, when none follow, the spaces before: deleting it leaves no double space. */
function withSpace(text: string, span: Span): Span {
  let end = span.end
  while (isSpace(text.charAt(end))) end++
  if (end > span.end) return { start: span.start, end }
  let start = span.start
  while (start > 0 && isSpace(text.charAt(start - 1))) start--
  return { start, end }
}

/** The word at the caret, else the word before it. */
function wordAt(text: string, pos: number): Span {
  let start = pos
  let end = pos
  while (start > 0 && isWordChar(text.charAt(start - 1))) start--
  while (end < text.length && isWordChar(text.charAt(end))) end++
  if (start === end) {
    end = wordBackOf(text, pos)
    start = end
    while (end < text.length && isWordChar(text.charAt(end))) end++
  }
  return withSpace(text, { start, end })
}

function sentenceAt(text: string, pos: number): Span {
  return withSpace(text, { start: sentenceStartOf(text, pos), end: sentenceEndOf(text, pos) })
}

/** The last word with its attached punctuation and the spaces before it (what "kustuta viimane sõna" takes). */
function lastWordOf(text: string): Span {
  const m = /[ \t]*\S+[ \t]*$/u.exec(text)
  return m ? { start: m.index, end: text.length } : { start: text.length, end: text.length }
}

/** Everything after the sentence end before the final one (what "kustuta viimane lause" takes). */
function lastSentenceOf(text: string): Span {
  const body = text.replace(/[\s.!?…]+$/u, '')
  const end = Math.max(...['.', '!', '?', '…', '\n'].map((mark) => body.lastIndexOf(mark)))
  return { start: end < 0 ? 0 : end + 1, end: text.length }
}

/** The caret after one arrow, Home or End: lines by the text's line breaks, keeping the column. */
export function moveBy(text: string, span: Span, key: PressableKey): number {
  const collapsed = span.start === span.end
  switch (key) {
    case 'ArrowLeft':
      return collapsed ? Math.max(0, span.start - 1) : span.start
    case 'ArrowRight':
      return collapsed ? Math.min(text.length, span.end + 1) : span.end
    case 'Home':
      return lineStartOf(text, span.start)
    case 'End':
      return lineEndOf(text, span.end)
    case 'ArrowUp': {
      const start = lineStartOf(text, span.start)
      if (start === 0) return 0
      const above = lineStartOf(text, start - 1)
      return Math.min(above + (span.start - start), start - 1)
    }
    case 'ArrowDown': {
      const end = lineEndOf(text, span.end)
      if (end >= text.length) return text.length
      const below = end + 1
      return Math.min(below + (span.end - lineStartOf(text, span.end)), lineEndOf(text, below))
    }
    default:
      return span.end
  }
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The nearest match of the spoken words: the last one before the caret, else the first after it.
 * Whole words first (case-insensitive, any spaces between words), then for one word the word in the
 * text that it extends, or that extends it, by one or two letters (the genitive: "kooli" finds "kool",
 * and "Koolid"), then a substring.
 */
function findSpan(text: string, pos: number, spoken: string): Span | null {
  const needle = spoken.trim()
  if (needle === '') return null
  const body = needle.split(/\s+/).map(escapeForRegExp).join('\\s+')
  let found = [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu'))].map((m) => ({ start: m.index, end: m.index + m[0].length }))
  if (found.length === 0 && !/\s/u.test(needle)) {
    const lower = needle.toLocaleLowerCase()
    found = [...text.matchAll(/[\p{L}\p{N}]+/gu)]
      .filter((m) => {
        const word = m[0].toLocaleLowerCase()
        const extra = lower.length - word.length
        return (word.length >= 3 && extra >= 1 && extra <= 2 && lower.startsWith(word)) || (lower.length >= 3 && extra <= -1 && extra >= -2 && word.startsWith(lower))
      })
      .map((m) => ({ start: m.index, end: m.index + m[0].length }))
  }
  if (found.length === 0) found = [...text.matchAll(new RegExp(body, 'giu'))].map((m) => ({ start: m.index, end: m.index + m[0].length }))
  if (found.length === 0) return null
  const before = found.filter((f) => f.start < pos)
  return before.at(-1) ?? found[0] ?? null
}

/** True when offset starts a sentence: the start of the text, or after . ! ? … or a line break (spaces between). */
function startsSentence(text: string, offset: number): boolean {
  const before = text.slice(0, offset).replace(/[ \t]+$/u, '')
  return before === '' || /[.!?…\n]$/u.test(before)
}

/** The spoken text as it goes in at the caret: a space before and after where letters meet, a capital at a sentence start, else a small first letter. */
function joinAtCaret(text: string, span: Span, spoken: string): string {
  const before = text.slice(0, span.start)
  const after = text.slice(span.end)
  const prev = before.at(-1)
  const next = after.charAt(0)
  const startsWithMark = /^[.,!?;:…)»”“]/u.test(spoken)
  const spaceBefore = prev !== undefined && !/\s/u.test(prev) && !startsWithMark
  const spaceAfter = next !== '' && /[\p{L}\p{N}(«„"']/u.test(next) && !/\s$/u.test(spoken)
  const first = spoken.charAt(0)
  const keeps = /\p{Lu}/u.test(spoken.slice(1).split(/\s/)[0] ?? '') || /^I(?:['’]|\s|$)/u.test(spoken)
  const body = startsSentence(text, span.start) ? first.toLocaleUpperCase() + spoken.slice(1) : keeps ? spoken : first.toLocaleLowerCase() + spoken.slice(1)
  return `${spaceBefore ? ' ' : ''}${body}${spaceAfter ? ' ' : ''}`
}

/** The field the editing commands act on: the armed one, else the focused one, else the box in front. */
export function editTarget(site: Site | null): HTMLElement | null {
  return fieldToClear(site) ?? findMessageBox(site)
}

export const DOCS_MISSING = 'The Google Docs editor was not found. Click into the document first.'
const DOCS_NO_TEXT = 'Google Docs has no text Ütle can read. Say the keys instead: "sõna tagasi", "rea algusesse", "kustuta täht", "võta tagasi".'

/**
 * Google Docs draws its page on a canvas; its keyboard target is a contenteditable inside the
 * `.docs-texteventtarget-iframe` document. null off Docs; 'missing' on Docs when it is not there.
 */
export function docsEditor(): HTMLElement | null | 'missing' {
  if (location.hostname !== 'docs.google.com') return null
  try {
    const frame = document.querySelector<HTMLIFrameElement>('iframe.docs-texteventtarget-iframe')
    const doc = frame?.contentDocument ?? null
    const el = doc?.querySelector<HTMLElement>('[contenteditable="true"], [contenteditable]') ?? doc?.body ?? null
    return el ?? 'missing'
  } catch {
    return 'missing'
  }
}

/** Types into Docs' keyboard target one character at a time, as Docs reads keypress events. */
export function docsType(el: HTMLElement, text: string): void {
  el.focus()
  for (const ch of text) {
    if (ch === '\n') {
      dispatchKey(el, 'Enter')
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    const init = { key: ch, code: '', keyCode: code, which: code, charCode: code, bubbles: true, cancelable: true, composed: true }
    el.dispatchEvent(new KeyboardEvent('keydown', { ...init, charCode: 0 }))
    el.dispatchEvent(new KeyboardEvent('keypress', init))
    el.dispatchEvent(new KeyboardEvent('keyup', { ...init, charCode: 0 }))
  }
}

/** On Docs the caret moves by keys: start and end of the text (Ctrl+Home/End), of the line (Home/End), a word (Ctrl+Arrow). */
function docsCaret(el: HTMLElement, to: CaretTarget): BrowserResult {
  if (typeof to === 'object' || to === 'sentenceStart' || to === 'sentenceEnd') return fail('failed', DOCS_NO_TEXT)
  const keys: Record<Exclude<CaretTarget, object | 'sentenceStart' | 'sentenceEnd'>, [string, boolean]> = {
    start: ['Home', true], end: ['End', true], lineStart: ['Home', false], lineEnd: ['End', false], wordBack: ['ArrowLeft', true], wordForward: ['ArrowRight', true],
  }
  const [key, ctrl] = keys[to]
  el.focus()
  dispatchKey(el, key, { ctrl })
  return ok()
}

function docsSelect(el: HTMLElement, what: SelectTarget): BrowserResult {
  el.focus()
  if (what === 'all') {
    dispatchKey(el, 'SelectAll')
    return ok()
  }
  if (what === 'word') {
    dispatchKey(el, 'ArrowLeft', { ctrl: true })
    dispatchKey(el, 'ArrowRight', { ctrl: true, shift: true })
    return ok()
  }
  if (what === 'lastWord') {
    dispatchKey(el, 'ArrowLeft', { ctrl: true, shift: true })
    return ok()
  }
  if (what === 'line') {
    dispatchKey(el, 'Home')
    dispatchKey(el, 'End', { shift: true })
    return ok()
  }
  const more = docsSelectDocument(el, what)
  if (more !== null) return more
  return fail('failed', DOCS_NO_TEXT)
}

export async function caret(to: CaretTarget, site: Site | null): Promise<BrowserResult> {
  const docs = docsEditor()
  if (docs === 'missing') return fail('failed', DOCS_MISSING)
  if (docs !== null) return docsCaret(docs, to)
  const el = editTarget(site)
  if (!el) return fail('not_found', 'No field is picked to write in.')
  const model = modelOf(el)
  const { text } = model
  const span = spanOf(el, model)
  let pos: number
  if (typeof to === 'object') {
    const found = findSpan(text, span.start, to.find)
    if (!found) return fail('not_found', 'That text is not in the field.')
    pos = to.where === 'before' ? found.start : found.end
  } else {
    switch (to) {
      case 'start':
        pos = 0
        break
      case 'end':
        pos = text.length
        break
      case 'lineStart':
        pos = lineStartOf(text, span.start)
        break
      case 'lineEnd':
        pos = lineEndOf(text, span.end)
        break
      case 'sentenceStart':
        pos = sentenceStartOf(text, span.start)
        break
      case 'sentenceEnd':
        pos = sentenceEndOf(text, span.end)
        break
      case 'wordBack':
        pos = wordBackOf(text, span.start)
        break
      case 'wordForward':
        pos = wordForwardOf(text, span.end)
        break
    }
  }
  await setSpan(el, model, { start: pos, end: pos })
  return ok({ box: boxState(el, site) })
}

export async function select(what: SelectTarget, site: Site | null): Promise<BrowserResult> {
  const docs = docsEditor()
  if (docs === 'missing') return fail('failed', DOCS_MISSING)
  if (docs !== null) return docsSelect(docs, what)
  const el = editTarget(site)
  if (!el) return fail('not_found', 'No field is picked to write in.')
  const model = modelOf(el)
  const { text } = model
  const span = spanOf(el, model)
  let chosen: Span | null
  if (typeof what === 'object' && 'find' in what) {
    chosen = findSpan(text, span.start, what.find)
    if (!chosen) return fail('not_found', 'That text is not in the field.')
  } else if (typeof what === 'object') {
    chosen = lastWordsOf(text, what.lastWords)
  } else {
    switch (what) {
      case 'all':
        chosen = { start: 0, end: text.length }
        break
      case 'word':
        chosen = wordAt(text, span.start)
        break
      case 'sentence':
        chosen = sentenceAt(text, span.start)
        break
      case 'line':
        chosen = { start: lineStartOf(text, span.start), end: lineEndOf(text, span.end) }
        break
      case 'lastWord':
        chosen = lastWordOf(text)
        break
      case 'lastSentence':
        chosen = lastSentenceOf(text)
        break
      case 'paragraph':
        chosen = paragraphAt(text, span.start)
        break
    }
  }
  await setSpan(el, model, chosen)
  return ok({ box: boxState(el, site) })
}

/** Types at the caret, replacing a selection, through the same typing path as setText, with the join rules of joinAtCaret. */
export async function typeText(text: string, site: Site | null): Promise<BrowserResult> {
  const docs = docsEditor()
  if (docs === 'missing') return fail('failed', DOCS_MISSING)
  if (docs !== null) {
    docsType(docs, text)
    return ok()
  }
  const el = editTarget(site)
  if (!el) return fail('not_found', 'No field is picked to write in.')
  const model = modelOf(el)
  const span = spanOf(el, model)
  // A selection elsewhere on the page means the caret is nowhere in the field: the end.
  await setSpan(el, model, span)
  await typeAtSelection(el, joinAtCaret(model.text, span, text.trim()))
  await sleep(60)
  return ok({ box: boxState(el, site) })
}

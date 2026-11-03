// Document mode (29.2): formatting, the paragraph, the selections, the Docs memory.

import type { BoxState, BrowserResult, FormatStyle, SelectTarget } from '../../../src/browser/protocol.ts'
import type { Site } from '../sites.ts'
import { boxState } from '../box.ts'
import { fail, ok, sleep } from './common.ts'
import type { Span } from './edit.ts'
import { DOCS_MISSING, docsEditor, docsType, editTarget, isSpace, lineEndOf, lineStartOf, modelOf, setSpan, spanOf } from './edit.ts'
import { dispatchKey } from './field.ts'
import { caretAtEnd, exec, typeAtSelection } from './messageBox.ts'

/**
 * Google Docs as a box (round 3). Docs has no text Ütle can read, so the box reports what Ütle itself
 * typed since the last utterance ended: the core joins its dictation onto that, and setText types only
 * the new tail (or erases with Backspace when the text shrinks, as a preview turning into a command does).
 * The hidden editor must exist and be focused; otherwise the page has no box at all.
 */
let docsTyped = ''
let docsTypedAt = 0
const DOCS_TYPED_RESET_MS = 4000

export function docsBox(): BoxState | null {
  const docs = docsEditor()
  if (docs === null || docs === 'missing') return null
  docsForget()
  return { present: true, text: docsTyped, armed: true, kind: 'composer', label: 'Google Docs', document: true }
}

export function docsSetText(text: string): BrowserResult {
  const docs = docsEditor()
  if (docs === null || docs === 'missing') return fail('not_found', DOCS_MISSING)
  docsForget()
  let common = 0
  while (common < docsTyped.length && common < text.length && docsTyped[common] === text[common]) common += 1
  const erase = docsTyped.length - common
  if (erase > 0) {
    const init = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true, composed: true }
    for (let i = 0; i < erase; i++) {
      docs.dispatchEvent(new KeyboardEvent('keydown', init))
      docs.dispatchEvent(new KeyboardEvent('keyup', init))
    }
  }
  const tail = text.slice(common)
  if (tail !== '') docsType(docs, tail)
  docsTyped = text
  docsTypedAt = Date.now()
  return ok({ box: { present: true, text: docsTyped, armed: true, kind: 'composer', label: 'Google Docs', document: true } })
}

/** A chord: one key with its modifiers. */
interface Chord {
  key: string
  code: string
  keyCode: number
  ctrl: boolean
  alt: boolean
  shift: boolean
}

/** Google Docs' shortcuts (Windows), which TipTap-based editors share; the fallback covers a plain contenteditable. */
const FORMAT_CHORDS: Record<Exclude<FormatStyle, 'paragraph'>, Chord> = {
  bold: { key: 'b', code: 'KeyB', keyCode: 66, ctrl: true, alt: false, shift: false },
  italic: { key: 'i', code: 'KeyI', keyCode: 73, ctrl: true, alt: false, shift: false },
  underline: { key: 'u', code: 'KeyU', keyCode: 85, ctrl: true, alt: false, shift: false },
  heading: { key: '1', code: 'Digit1', keyCode: 49, ctrl: true, alt: true, shift: false },
  normal: { key: '0', code: 'Digit0', keyCode: 48, ctrl: true, alt: true, shift: false },
  list: { key: '*', code: 'Digit8', keyCode: 56, ctrl: true, alt: false, shift: true },
}

const PLAIN_NO_FORMAT = 'A plain text box has no bold, italics, headings or lists; "uus lõik" works here.'
const LINE_NO_PARAGRAPH = 'A one-line field has no paragraphs.'

/** Sends the chord to the target. True when the page let it through (nobody cancelled the keydown). */
function sendChord(target: Element, chord: Chord): boolean {
  const init = { key: chord.key, code: chord.code, keyCode: chord.keyCode, which: chord.keyCode, charCode: 0, ctrlKey: chord.ctrl, altKey: chord.alt, shiftKey: chord.shift, bubbles: true, cancelable: true, composed: true }
  const through = target.dispatchEvent(new KeyboardEvent('keydown', init))
  target.dispatchEvent(new KeyboardEvent('keyup', init))
  return through
}

/** "paksuks", "kaldkirja", "pealkirjaks", "loendiks", "uus lõik": the editor's chord, else execCommand (29.2). */
export async function format(style: FormatStyle, site: Site | null): Promise<BrowserResult> {
  const docs = docsEditor()
  if (docs === 'missing') return fail('failed', DOCS_MISSING)
  if (docs !== null) return docsFormat(docs, style)
  const el = editTarget(site)
  if (!el) return fail('not_found', 'No field is picked to write in.')
  if (el instanceof HTMLInputElement) return fail('failed', style === 'paragraph' ? LINE_NO_PARAGRAPH : PLAIN_NO_FORMAT)
  if (style === 'paragraph') {
    await paragraphAtEnd(el)
    return ok({ box: boxState(el, site) })
  }
  if (el instanceof HTMLTextAreaElement) return fail('failed', PLAIN_NO_FORMAT)
  el.focus()
  if (style === 'bold' || style === 'italic' || style === 'underline') await trimSelection(el)
  const before = el.innerHTML
  const through = sendChord(el, FORMAT_CHORDS[style])
  await sleep(30)
  if (through && el.innerHTML === before) formatFallback(el, style)
  await sleep(30)
  return ok({ box: boxState(el, site) })
}

/** What a plain contenteditable cannot do from a key: the browser's own editing commands. */
function formatFallback(el: HTMLElement, style: Exclude<FormatStyle, 'paragraph'>): void {
  switch (style) {
    case 'bold':
    case 'italic':
    case 'underline':
      exec(style)
      return
    case 'heading':
      exec('formatBlock', 'h1')
      return
    case 'list':
      exec('insertUnorderedList')
      return
    case 'normal': {
      const anchor = window.getSelection()?.anchorNode ?? null
      const item = (anchor instanceof Element ? anchor : anchor?.parentElement ?? null)?.closest('li') ?? null
      if (item !== null && el.contains(item)) exec('insertUnorderedList')
      else exec('formatBlock', 'div')
    }
  }
}

/** A selection that starts or ends in spaces (as "vali see lause" leaves it) is shrunk to its letters, so exactly the words are styled. */
async function trimSelection(el: HTMLElement): Promise<void> {
  const model = modelOf(el)
  const span = spanOf(el, model)
  let { start, end } = span
  while (end > start && /\s/u.test(model.text.charAt(end - 1))) end--
  while (start < end && /\s/u.test(model.text.charAt(start))) start++
  if (start !== span.start || end !== span.end) await setSpan(el, model, { start, end })
}

/** "uus lõik" at the end, where dictation goes: a blank line in a textarea, a new block in a rich editor. */
async function paragraphAtEnd(el: HTMLElement): Promise<void> {
  if (el instanceof HTMLTextAreaElement) {
    caretAtEnd(el)
    await typeAtSelection(el, '\n\n')
    return
  }
  if (documentCaretAtEnd(el)) await sleep(30)
  const handled = !el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertParagraph' }))
  if (!handled) exec('insertParagraph')
  await sleep(30)
}

/**
 * The caret at the end of a document's text: inside its last text node, or before the <br> of an
 * empty last paragraph, so typing continues there and never starts a block of its own. True when it moved.
 */
export function documentCaretAtEnd(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return caretAtEnd(el)
  el.focus()
  const selection = window.getSelection()
  if (!selection) return false
  if (selection.rangeCount > 0 && selection.isCollapsed && el.contains(selection.anchorNode)) {
    const rest = document.createRange()
    rest.selectNodeContents(el)
    rest.setStart(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset)
    if (rest.toString() === '' && rest.cloneContents().querySelector('div, p, li, h1, h2, h3, h4, h5, h6') === null) return false
  }
  let node: Node = el
  while (node.lastChild !== null) node = node.lastChild
  const range = document.createRange()
  if (node instanceof Text) range.setStart(node, node.data.length)
  else if (node instanceof HTMLBRElement) range.setStartBefore(node)
  else range.setStart(node, node.childNodes.length)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

/** "vali lõik": the paragraph at the caret, from one line break to the next. */
export function paragraphAt(text: string, pos: number): Span {
  return { start: lineStartOf(text, pos), end: lineEndOf(text, pos) }
}

/** "vali viimased kolm sõna": the last n words with their marks, and the spaces before them on that line. */
export function lastWordsOf(text: string, n: number): Span {
  let pos = text.length
  while (pos > 0 && /\s/u.test(text.charAt(pos - 1))) pos--
  for (let i = 0; i < Math.max(1, Math.min(n, 50)); i++) {
    if (i > 0) while (pos > 0 && /\s/u.test(text.charAt(pos - 1))) pos--
    while (pos > 0 && !/\s/u.test(text.charAt(pos - 1))) pos--
  }
  while (pos > 0 && isSpace(text.charAt(pos - 1))) pos--
  return { start: pos, end: text.length }
}

/** On Docs (unverified): the paragraph by Ctrl+Up then Ctrl+Shift+Down, the last words by Ctrl+Shift+Left. Null for the other targets. */
export function docsSelectDocument(el: HTMLElement, what: SelectTarget): BrowserResult | null {
  if (what === 'paragraph') {
    dispatchKey(el, 'ArrowUp', { ctrl: true })
    dispatchKey(el, 'ArrowDown', { ctrl: true, shift: true })
    return ok()
  }
  if (typeof what === 'object' && 'lastWords' in what) {
    for (let i = 0; i < Math.max(1, Math.min(what.lastWords, 50)); i++) dispatchKey(el, 'ArrowLeft', { ctrl: true, shift: true })
    return ok()
  }
  return null
}

/** Docs: the chord on its keyboard target; "uus lõik" is Enter twice, and the memory learns the break. */
function docsFormat(el: HTMLElement, style: FormatStyle): BrowserResult {
  el.focus()
  if (style !== 'paragraph') {
    sendChord(el, FORMAT_CHORDS[style])
    return ok()
  }
  docsForget()
  docsType(el, '\n\n')
  docsTyped = `${docsTyped}\n\n`
  docsTypedAt = Date.now()
  return ok({ box: { present: true, text: docsTyped, armed: true, kind: 'composer', label: 'Google Docs', document: true } })
}

/**
 * REVIEW-R3 M5: after DOCS_TYPED_RESET_MS the memory of what Ütle typed keeps its last character
 * instead of emptying, so the next utterance is joined onto it ("Tere. Uus lause", not "Tere.Uus lause").
 */
function docsForget(): void {
  if (Date.now() - docsTypedAt > DOCS_TYPED_RESET_MS) docsTyped = docsTyped.slice(-1)
}

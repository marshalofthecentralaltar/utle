// The message box: typing into it, setText, insertText, pressSend.

import type { BrowserResult } from '../../../src/browser/protocol.ts'
import type { Site } from '../sites.ts'
import { boxState, boxText, composeWindowOf, findMessageBox, isDocument, readText, sendButtonBeside } from '../box.ts'
import { fail, ok, sleep } from './common.ts'
import { documentCaretAtEnd } from './document.ts'
import { caretToEnd } from './items.ts'
import { mailSendFor } from './mail.ts'
import { activate } from './read.ts'

/** insertText and setText keep looking this long for a message box (composers render late). */
const BOX_TIMEOUT_MS = 3000
/** After Enter, how long the text may stay in the box before the send button is tried. */
const ENTER_GRACE_MS = 500
/** pressSend waits this long for the box to empty. */
const SEND_TIMEOUT_MS = 2000
/** How often the searches look again. */
const POLL_MS = 150

export function nativeSetValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
}

export function exec(command: string, value?: string): boolean {
  try {
    return document.execCommand(command, false, value)
  } catch {
    return false
  }
}

/** Types text at the current selection the way a person would, with fallbacks for pages that refuse execCommand. */
export async function typeAtSelection(el: HTMLElement, text: string): Promise<void> {
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

export async function selectAllIn(el: HTMLElement): Promise<void> {
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
export async function emptyField(el: HTMLElement): Promise<void> {
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
export function caretAtEnd(el: HTMLElement): boolean {
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

export async function setText(text: string, site: Site | null): Promise<BrowserResult> {
  const el = await waitFor(() => findMessageBox(site), BOX_TIMEOUT_MS)
  if (!el) return fail('not_found', 'There is no message box on this page.')
  // Live dictation (21.3) mostly adds words at the end: type only those, so the box never blanks.
  // Round 5: a one-line input is never previewed, so it is always selected and replaced whole,
  // with the text as the core converted it (digits, an address), never appended to.
  const current = boxText(el, site)
  const tail = text.slice(current.length)
  if (!(el instanceof HTMLInputElement) && current !== '' && text.startsWith(current) && !/[\r\n]/.test(tail)) {
    if (isDocument(el, site) ? documentCaretAtEnd(el) : caretAtEnd(el)) await sleep(30)
    if (tail !== '') await typeAtSelection(el, tail)
    await sleep(30)
    if (boxText(el, site) === text) return ok({ box: boxState(el, site) })
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

export function pressEnter(el: HTMLElement): void {
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

export async function waitFor<T>(find: () => T | null, timeoutMs: number): Promise<T | null> {
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
  // mail (29.3.1): in a compose window Send is clicked, never Enter (Enter is a new line in a mail).
  const mailSend = mailSendFor(el)
  if (mailSend) {
    activate(mailSend)
    return (await waitFor(() => (!el.isConnected || composeWindowOf(el) === null || readText(el).trim() === '' ? true : null), SEND_TIMEOUT_MS)) === true
  }
  pressEnter(el)
  if (await waitFor(() => (gone() ? true : null), ENTER_GRACE_MS)) return true
  // F2 (30.3): on a page Ütle has no site entry for, the send, post or reply button beside the box (the one that makes it a composer).
  const button = sendButton(site) ?? (el instanceof HTMLInputElement ? null : sendButtonBeside(el))
  if (button) activate(button)
  else if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.form) el.form.requestSubmit()
  else return false
  return (await waitFor(() => (gone() ? true : null), SEND_TIMEOUT_MS)) === true
}

export async function insertText(text: string, submit: boolean, site: Site | null): Promise<BrowserResult> {
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

export async function pressSend(site: Site | null): Promise<BrowserResult> {
  const el = findMessageBox(site)
  if (!el) return fail('not_found', 'There is no message box on this page.')
  const text = readText(el)
  if (text.trim() === '') return fail('failed', 'The message box is empty.')
  if (await send(el, text, site)) return ok({ box: boxState(el.isConnected ? el : findMessageBox(site), site) })
  return fail('failed', 'The text is still in the box: it was not sent.')
}

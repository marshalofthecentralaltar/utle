// The armed field: clearField, arm, pressKey.

import type { BrowserResult, PressableKey } from '../../../src/browser/protocol.ts'
import type { Site } from '../sites.ts'
import { armElement, armedElement, boxState, disarm, findMessageBox, focusedTextField, isTextField, onScreenRect, readText } from '../box.ts'
import { fail, ok, sleep } from './common.ts'
import type { Span } from './edit.ts'
import { DOCS_MISSING, docsEditor, editTarget, modelOf, moveBy, setSpan, spanOf } from './edit.ts'
import { caretToEnd, isDisabled, isOurs } from './items.ts'
import { mailNextField } from './mail.ts'
import { emptyField, exec, nativeSetValue, selectAllIn } from './messageBox.ts'

/** The user's armed field, else the focused text field, else the site's composer. */
export function fieldToClear(site: Site | null): HTMLElement | null {
  const chosen = armedElement()
  if (chosen && isTextField(chosen)) return chosen
  const active = focusedTextField()
  if (active) return active
  const box = findMessageBox(site)
  return box && boxState(box, site).armed ? box : null
}

export async function clearField(site: Site | null): Promise<BrowserResult> {
  const el = fieldToClear(site)
  if (!el) return fail('not_found', 'There is no field to clear.')
  await emptyField(el)
  await sleep(60)
  return ok({ box: boxState(el, site) })
}

export function arm(on: boolean, site: Site | null): BrowserResult {
  if (!on) {
    disarm()
    return ok({ box: boxState(findMessageBox(site), site) })
  }
  const el = focusedTextField()
  if (!el) return fail('not_found', 'Nothing that takes text is focused. Say "numbers" and pick a field.')
  armElement(el)
  return ok({ box: boxState(el, site) })
}

const KEY_CODES: Record<PressableKey, number> = {
  Escape: 27, Enter: 13, Tab: 9, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Home: 36, End: 35, Undo: 90, Redo: 89, SelectAll: 65,
}

/** Keys that leave the field: a dialog closes, a form submits, the focus moves. The rest edit inside it. */
const LEAVING_KEYS = new Set<PressableKey>(['Escape', 'Enter', 'Tab'])

/** A key event as the page sees it. ctrl, shift: the modifiers (Undo is Ctrl+Z, a word step is Ctrl+Arrow). */
/** True when the page let the key through (nobody called preventDefault on the keydown). */
export function dispatchKey(target: Element, key: PressableKey | string, modifiers: { ctrl?: boolean; shift?: boolean } = {}): boolean {
  const named = key === 'Undo' ? 'z' : key === 'Redo' ? 'y' : key === 'SelectAll' ? 'a' : key
  const code = KEY_CODES[key as PressableKey] ?? (named.length === 1 ? named.toUpperCase().charCodeAt(0) : 0)
  const ctrl = modifiers.ctrl === true || key === 'Undo' || key === 'Redo' || key === 'SelectAll'
  const codeName = named.length === 1 ? (named === ' ' ? 'Space' : `Key${named.toUpperCase()}`) : named
  const init = { key: named, code: codeName, keyCode: code, which: code, charCode: 0, ctrlKey: ctrl, shiftKey: modifiers.shift === true, bubbles: true, cancelable: true, composed: true }
  const through = target.dispatchEvent(new KeyboardEvent('keydown', init))
  if (key === 'Enter') target.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: 13 }))
  target.dispatchEvent(new KeyboardEvent('keyup', init))
  return through
}

/**
 * Round 5 (fields): what a real Enter does in a one-line field of a form and a synthetic one does
 * not: implicit submission. The form submits when it has a submit button, or when the input is
 * its only text field (the HTML rules), through its own submit button so its handlers run.
 */
function implicitSubmit(input: HTMLInputElement): void {
  const form = input.form
  if (!form) return
  const submitter = form.querySelector<HTMLElement>('button:not([type]), button[type="submit" i], input[type="submit" i], input[type="image" i]')
  const fields = [...form.querySelectorAll('input')].filter((el) => isTextField(el))
  if (submitter === null && fields.length !== 1) return
  try {
    if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) form.requestSubmit(submitter)
    else form.requestSubmit()
  } catch {
    // A disabled or detached submit button: the form is not ready, as a real Enter would do nothing.
  }
}

function deepActive(): Element {
  let target: Element = document.activeElement ?? document.body
  while (target.shadowRoot?.activeElement) target = target.shadowRoot.activeElement
  return target
}

/**
 * A key on the focused element, times times (round 3, the edit lane). Inside a text field the editing
 * keys act through the field's text (the arrows, Home and End move the caret; Backspace and Delete,
 * Undo, Redo and SelectAll go through execCommand with fallbacks), because a synthetic key event
 * moves nothing by itself. Escape, Enter and Tab are sent as keys (Tab moves the focus ourselves).
 * On Google Docs every key goes to the editor's own keyboard target. Answers with the box where known.
 */
export async function pressKey(key: PressableKey, times = 1, site: Site | null): Promise<BrowserResult> {
  const count = Math.max(1, Math.min(times, 50))
  const docs = docsEditor()
  if (docs === 'missing') return fail('failed', DOCS_MISSING)
  let target: Element = docs ?? deepActive()
  if (docs === null && !LEAVING_KEYS.has(key) && !isTextField(target)) {
    const field = editTarget(site)
    if (field) {
      field.focus()
      target = field
    }
  }
  for (let i = 0; i < count; i++) {
    if (docs !== null) {
      dispatchKey(target, key)
      continue
    }
    if (target instanceof HTMLElement && isTextField(target) && !LEAVING_KEYS.has(key)) {
      await editKey(target, key)
      continue
    }
    if (key === 'Tab') {
      // mail (29.3.5): inside a compose window Tab goes to the next field of the group, past its buttons.
      target = mailNextField(target) ?? focusNext(target) ?? target
      continue
    }
    const through = dispatchKey(target, key)
    if (key === 'Enter' && through && target instanceof HTMLInputElement) implicitSubmit(target)
  }
  if (key === 'Escape' && target instanceof HTMLElement && isTextField(target)) target.blur()
  await sleep(30)
  if (docs !== null) return ok()
  const box = key === 'Tab' ? focusedTextField() : editTarget(site)
  return ok({ box: boxState(box ?? findMessageBox(site), site) })
}

/** One editing key inside a text field. */
async function editKey(el: HTMLElement, key: PressableKey): Promise<void> {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'Home':
    case 'End': {
      const model = modelOf(el)
      const span = spanOf(el, model)
      const pos = moveBy(model.text, span, key)
      await setSpan(el, model, { start: pos, end: pos })
      return
    }
    case 'SelectAll':
      await selectAllIn(el)
      return
    case 'Backspace':
    case 'Delete':
      await deleteAt(el, key === 'Backspace')
      return
    case 'Undo':
    case 'Redo': {
      const command = key === 'Undo' ? 'undo' : 'redo'
      const before = readText(el)
      if (exec(command)) {
        await sleep(30)
        if (readText(el) !== before) return
      }
      dispatchKey(el, key)
      await sleep(30)
      return
    }
    default:
      dispatchKey(el, key)
  }
}

/** Backspace or Delete: the selection, else one character, through execCommand, else through the text itself. */
async function deleteAt(el: HTMLElement, backward: boolean): Promise<void> {
  const before = readText(el)
  if (before === '') return
  const model = modelOf(el)
  const span = spanOf(el, model)
  if (span.start === span.end && (backward ? span.start === 0 : span.end >= model.text.length)) return
  if (exec(backward ? 'delete' : 'forwardDelete')) {
    await sleep(20)
    if (readText(el) !== before) return
  }
  const cut: Span = span.start !== span.end ? span : backward ? { start: span.start - 1, end: span.end } : { start: span.start, end: span.end + 1 }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    nativeSetValue(el, el.value.slice(0, cut.start) + el.value.slice(cut.end))
    el.setSelectionRange(cut.start, cut.start)
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: backward ? 'deleteContentBackward' : 'deleteContentForward' }))
    return
  }
  // Rich editors (Lexical, Draft) take the beforeinput a key would produce; a plain contenteditable gets the range cut.
  await setSpan(el, model, cut)
  const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: backward ? 'deleteContentBackward' : 'deleteContentForward' })
  if (el.dispatchEvent(event)) {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) selection.getRangeAt(0).deleteContents()
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: backward ? 'deleteContentBackward' : 'deleteContentForward' }))
  }
  await sleep(30)
}

const FOCUSABLE = 'a[href], button, input, textarea, select, [tabindex], [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]'

/** Tab: the next focusable element in page order (a synthetic Tab moves nothing). A text field reached this way is armed, as a real Tab arms it. */
export function focusNext(from: Element): Element | null {
  const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !isOurs(el) && el.tabIndex >= 0 && !isDisabled(el) && onScreenRect(el) !== null && el.closest('utle-strip, utle-hints') === null,
  )
  if (all.length === 0) return null
  const at = all.indexOf(from as HTMLElement)
  const next = all[(at + 1) % all.length]
  if (!next) return null
  next.focus()
  if (isTextField(next)) {
    caretToEnd(next)
    armElement(next)
  }
  return next
}

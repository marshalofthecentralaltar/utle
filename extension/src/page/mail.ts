// Mail (29.3): compose, the compose window's fields, the contacts.

import type { BrowserResult, MailField, PageContact } from '../../../src/browser/protocol.ts'
import type { MailPart } from '../box.ts'
import { boxState, composeWindowOf, isTextField, mailPartOf, onScreenRect, readText, subjectIn } from '../box.ts'
import type { ContactSource } from '../../../src/core/contacts.ts'
import { collectContacts } from '../../../src/core/contacts.ts'
import { MAIL, MAIL_NAMES } from '../sites.ts'
import { fail, ok, sleep } from './common.ts'
import { dispatchKey, focusNext } from './field.ts'
import { hideHints } from './hints.ts'
import { clean, isOurs, pick } from './items.ts'
import { emptyField, typeAtSelection, waitFor } from './messageBox.ts'
import { activate } from './read.ts'

// Gmail's compose window (docs/ARCHITECTURE.md 29.3.1, 29.3.5). The selectors are in sites.ts MAIL,
// all unverified on real Gmail; the controls are also found by their names (MAIL_NAMES), which is
// what the stand-in proves.

/** How long a compose window may take to appear after Compose, or after the compose page loaded. */
const MAIL_WINDOW_MS = 4000
/** How long Gmail may take to show contact suggestions under To. */
const MAIL_SUGGEST_MS = 800
/** How long the Cc field may take to appear after its button. */
const MAIL_CC_MS = 1500
const MAIL_CONTROLS = 'button, [role="button"], [role="link"], a'
/** readContacts reads at most this many text nodes, so a huge page answers in time. */
const CONTACT_NODES = 20_000

/** A visible control inside within whose name (aria-label, text or title) matches. */
function namedControl(names: RegExp, within: ParentNode = document): HTMLElement | null {
  for (const el of within.querySelectorAll<HTMLElement>(MAIL_CONTROLS)) {
    if (isOurs(el) || onScreenRect(el) === null) continue
    const name = clean(el.getAttribute('aria-label') || el.innerText || el.textContent || el.getAttribute('title'))
    if (names.test(name) || names.test(clean(el.getAttribute('title')))) return el
  }
  return null
}

/** The compose windows on screen, newest (last in the page) last. */
function composeWindows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(MAIL.window)].filter((w) => !isOurs(w) && onScreenRect(w) !== null && subjectIn(w) !== null)
}

/** One field of a compose window, by what box.ts takes it to be. */
function mailFieldIn(win: HTMLElement, part: MailPart): HTMLElement | null {
  const fields = [...win.querySelectorAll<HTMLElement>('input, textarea, [contenteditable="true"], [contenteditable=""]')]
  return fields.find((el) => isTextField(el) && onScreenRect(el) !== null && mailPartOf(el) === part) ?? null
}

/** A window nobody has written in yet: To, Subject and the body all empty. */
function emptyWindow(win: HTMLElement): boolean {
  return (['to', 'subject', 'body'] as const).every((part) => {
    const field = mailFieldIn(win, part)
    return field === null || readText(field).trim() === ''
  })
}

/** Replaces what the field holds with text, as setText does. */
async function typeInto(el: HTMLElement, text: string): Promise<void> {
  pick(el)
  await emptyField(el)
  await typeAtSelection(el, text)
  await sleep(60)
}

/** A name or an address in To or Cc: Enter on Gmail's first suggestion when one shows, else Tab out of the field. */
async function confirmRecipient(field: HTMLElement): Promise<void> {
  const suggestion = await waitFor(() => [...document.querySelectorAll<HTMLElement>(MAIL.suggestion)].find((el) => onScreenRect(el) !== null) ?? null, MAIL_SUGGEST_MS)
  if (suggestion) dispatchKey(field, 'Enter')
  else focusNext(field)
  await sleep(60)
}

/** The window's Send button, by Gmail's selector or its name. */
function mailSendIn(win: HTMLElement): HTMLElement | null {
  const hit = [...win.querySelectorAll<HTMLElement>(MAIL.send)].find((el) => onScreenRect(el) !== null)
  return hit ?? namedControl(MAIL_NAMES.send, win)
}

/** The Send button of the compose window el is in, or null outside one. */
export function mailSendFor(el: HTMLElement): HTMLElement | null {
  const win = composeWindowOf(el)
  return win === null ? null : mailSendIn(win)
}

export async function compose(to: string | undefined, body: string | undefined): Promise<BrowserResult> {
  hideHints()
  const open = composeWindows()
  let win = open.findLast((w) => emptyWindow(w)) ?? null
  if (win === null) {
    const button = [...document.querySelectorAll<HTMLElement>(MAIL.composeButton)].find((el) => !isOurs(el) && onScreenRect(el) !== null) ?? namedControl(MAIL_NAMES.compose)
    if (button) {
      activate(button)
      win = await waitFor(() => composeWindows().find((w) => !open.includes(w)) ?? null, MAIL_WINDOW_MS)
      if (win === null) return fail('failed', 'Compose was clicked, but no new message opened.')
    } else {
      // Gmail's compose page (background.ts opened it) draws its window a moment after the load.
      win = await waitFor(() => composeWindows().find((w) => emptyWindow(w)) ?? null, MAIL_WINDOW_MS)
      if (win === null) return fail('not_found', 'There is no Compose button on this page.')
    }
  }
  const toField = mailFieldIn(win, 'to')
  if (to !== undefined && to.trim() !== '') {
    if (!toField) return fail('not_found', 'The new message has no To field.')
    await typeInto(toField, to.trim())
    await confirmRecipient(toField)
  }
  const bodyField = mailFieldIn(win, 'body')
  if (body !== undefined && body.trim() !== '' && bodyField) await typeInto(bodyField, body.trim())
  // The body is next once someone is in To; else To.
  const filled = toField !== null && readText(toField).trim() !== ''
  const target = (filled || toField === null ? bodyField : toField) ?? toField ?? bodyField
  if (!target) return fail('not_found', 'The new message has no field to write in.')
  pick(target)
  return ok({ box: boxState(target, null) })
}

/** composeTo on the compose page background.ts opened: To is filled from the address; the body is armed. */
export async function composeOpened(): Promise<BrowserResult> {
  const win = await waitFor(() => composeWindows().at(-1) ?? null, MAIL_WINDOW_MS)
  if (win === null) return fail('not_found', 'The new message did not open.')
  const body = mailFieldIn(win, 'body')
  if (!body) return fail('not_found', 'The new message has no message body.')
  pick(body)
  return ok({ box: boxState(body, null) })
}

export async function mailField(field: MailField, text: string | undefined): Promise<BrowserResult> {
  const win = composeWindows().at(-1) ?? null
  if (win === null) return fail('not_found', 'There is no open message on this page.')
  hideHints()
  if (field === 'subject') {
    const subject = mailFieldIn(win, 'subject')
    if (!subject) return fail('not_found', 'The message has no Subject field.')
    if (text === undefined || text.trim() === '') {
      pick(subject)
      return ok({ box: boxState(subject, null) })
    }
    await typeInto(subject, text.trim())
    // The subject is written: the body is next.
    const body = mailFieldIn(win, 'body') ?? subject
    pick(body)
    return ok({ box: boxState(body, null) })
  }
  let cc = mailFieldIn(win, 'cc')
  if (!cc) {
    const button = namedControl(MAIL_NAMES.cc, win)
    if (!button) return fail('not_found', 'The message has no Cc.')
    activate(button)
    cc = await waitFor(() => mailFieldIn(win, 'cc'), MAIL_CC_MS)
    if (!cc) return fail('failed', 'Cc was clicked, but no Cc field opened.')
  }
  if (text !== undefined && text.trim() !== '') {
    await typeInto(cc, text.trim())
    await confirmRecipient(cc)
    // A name in Cc is done; he goes on in the body.
    const body = mailFieldIn(win, 'body') ?? cc
    pick(body)
    return ok({ box: boxState(body, null) })
  }
  pick(cc)
  return ok({ box: boxState(cc, null) })
}

/** The order "valmis" walks a compose window in: To, Cc, Subject, the body. */
const MAIL_ORDER: readonly MailPart[] = ['to', 'cc', 'subject', 'body']

/** Tab from a field of a compose window: the next field of the group, focused and armed; null outside one or after the body. */
export function mailNextField(from: Element): HTMLElement | null {
  if (!(from instanceof HTMLElement)) return null
  const win = composeWindowOf(from)
  const part = mailPartOf(from)
  if (win === null || part === null) return null
  for (const next of MAIL_ORDER.slice(MAIL_ORDER.indexOf(part) + 1)) {
    const field = mailFieldIn(win, next)
    if (field) {
      pick(field)
      return field
    }
  }
  return null
}

/** The page's e-mail addresses and phone numbers (29.3.3): its text and its mailto:/tel: links. */
export function readContacts(): PageContact[] {
  const found: Array<{ node: Node; source: ContactSource }> = []
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:" i], a[href^="tel:" i]')) {
    if (isOurs(a) || a.getClientRects().length === 0) continue
    found.push({ node: a, source: { href: a.getAttribute('href') ?? '', label: clean(a.innerText || a.textContent), visible: onScreenRect(a) !== null } })
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let seen = 0
  for (let node = walker.nextNode(); node !== null && seen < CONTACT_NODES; node = walker.nextNode()) {
    seen += 1
    const text = node.textContent ?? ''
    if (!/[@\d]/.test(text)) continue
    const parent = node.parentElement
    if (!parent || parent.closest('script, style, noscript, template, textarea, [contenteditable="true"], utle-strip, utle-hints') !== null) continue
    if (parent.getClientRects().length === 0 || !parent.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
    found.push({ node, source: { text, visible: onScreenRect(parent) !== null } })
  }
  // In the page's reading order (a link before the text inside it), then the visible ones first (collectContacts).
  found.sort((a, b) => (a.node === b.node ? 0 : a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  return collectContacts(found.map((f) => f.source))
}

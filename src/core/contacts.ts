import type { PageContact } from '../browser/protocol.ts'

/**
 * Round 8 (docs/ARCHITECTURE.md 29.3.3): e-mail addresses and phone numbers read off the page, so
 * "võta see meiliaadress siit lehelt ja kirjuta talle" has an address to write to, and the model
 * can only ever pick one of these (pageIntentFrom). Strict on purpose: a version, an ID code, a
 * price, a date or a street number is never a contact. Pure.
 */

/** At most this many contacts go to the model, the ones on screen first. */
export const MAX_CONTACTS = 20
/** A link's text as the contact's label, at most this long. The label never reaches the model. */
export const CONTACT_LABEL_CHARS = 40

const LOCAL = String.raw`[a-z0-9](?:[\w.%+-]{0,62}[a-z0-9])?`
const DOMAIN = String.raw`(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}`
const EMAIL_IN_TEXT = new RegExp(String.raw`(?<![\w.+%-])${LOCAL}@${DOMAIN}(?![\w-]|\.[a-z0-9])`, 'gi')
const EMAIL_WHOLE = new RegExp(String.raw`^${LOCAL}@${DOMAIN}$`, 'i')
/** +372 5123 4567, +358 40 123 4567: a plus, a country code and 6 to 11 more digits, single spaces or dashes between. */
const PHONE_INTERNATIONAL = /(?<![\w+])\+\d{1,3}(?:[ -]?\d){6,11}(?!\d)/g
/** 5123 4567, 612 3456, 51234567: an Estonian number of 7 or 8 digits, first digit 3 to 8, at most one space. */
const PHONE_ESTONIAN = /(?<![\w+.,/-])(?<!\d )[3-8]\d{2,3} ?\d{3,4}(?!\d|[ .,/-]\d)/g

const digits = (s: string): string => s.replace(/\D/g, '')

/** True for an e-mail address as a whole, and nothing else. */
export function isEmailAddress(value: string): boolean {
  return EMAIL_WHOLE.test(value) && !value.includes('..')
}

/** A compacted phone ("+37251234567", "51234567") when it has a phone's shape, else null. */
function phoneShape(raw: string): string | null {
  const compact = raw.replace(/[\s().-]/g, '')
  if (/^\+\d+$/.test(compact)) {
    const rest = compact.slice(1)
    if (rest.startsWith('372')) return rest.length - 3 >= 7 && rest.length - 3 <= 8 ? compact : null
    return rest.length >= 8 && rest.length <= 15 ? compact : null
  }
  return /^[3-8]\d{6,7}$/.test(compact) ? compact : null
}

/** The e-mail addresses in a text, lower-cased, in order, each once. */
export function emailsIn(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(EMAIL_IN_TEXT)) {
    const value = m[0].toLowerCase()
    if (!value.includes('..') && !found.includes(value)) found.push(value)
  }
  return found
}

/** The phone numbers in a text, compacted, in order, each once: +372 (or another country code) and 7 to 8 digits, or 7 to 8 Estonian digits. */
export function phonesIn(text: string): string[] {
  const found: string[] = []
  const add = (raw: string): void => {
    const value = phoneShape(raw)
    if (value !== null && !found.includes(value)) found.push(value)
  }
  // The international ones first, then blanked, so "+372 5123 4567" is not found again as "5123 4567".
  for (const m of text.matchAll(PHONE_INTERNATIONAL)) add(m[0])
  const rest = text.replace(PHONE_INTERNATIONAL, (m) => ' '.repeat(m.length))
  for (const m of rest.matchAll(PHONE_ESTONIAN)) {
    const n = digits(m[0]).length
    if (n === 7 || n === 8) add(m[0])
  }
  return found
}

/** One place the page may hold a contact: a piece of its text, or a link. */
export interface ContactSource {
  text?: string
  href?: string
  /** The link's text. */
  label?: string
  /** On screen now. */
  visible: boolean
}

function decoded(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function fromHref(href: string, label: string): PageContact[] {
  const lower = href.trim().toLowerCase()
  if (lower.startsWith('mailto:')) {
    const list = decoded(href.trim().slice('mailto:'.length).split('?')[0] ?? '')
    return list
      .split(',')
      .map((a) => a.trim())
      .filter((a) => isEmailAddress(a))
      .map((a) => ({ kind: 'email', value: a.toLowerCase(), label }))
  }
  if (lower.startsWith('tel:')) {
    const value = phoneShape(decoded(href.trim().slice('tel:'.length)))
    return value === null ? [] : [{ kind: 'tel', value, label }]
  }
  return []
}

/**
 * The page's contacts from its text and its mailto:/tel: links: the visible ones first, each value
 * once (the first source that has it gives the label), at most MAX_CONTACTS.
 */
export function collectContacts(sources: readonly ContactSource[]): PageContact[] {
  const ordered = [...sources.filter((s) => s.visible), ...sources.filter((s) => !s.visible)]
  const out: PageContact[] = []
  const seen = new Set<string>()
  const push = (c: PageContact): void => {
    const key = `${c.kind} ${c.value}`
    if (seen.has(key) || out.length >= MAX_CONTACTS) return
    seen.add(key)
    out.push(c)
  }
  for (const source of ordered) {
    if (source.href !== undefined) {
      const label = (source.label ?? '').trim().replace(/\s+/g, ' ').slice(0, CONTACT_LABEL_CHARS)
      for (const c of fromHref(source.href, label)) push(c)
    }
    if (source.text !== undefined) {
      for (const value of emailsIn(source.text)) push({ kind: 'email', value, label: '' })
      for (const value of phonesIn(source.text)) push({ kind: 'tel', value, label: '' })
    }
    if (out.length >= MAX_CONTACTS) break
  }
  return out
}

/** The contacts as the model reads them: values only, "e-mail a@b.ee, tel +37251234567", or none. */
export function contactsLine(contacts: readonly PageContact[] | undefined): string {
  if (contacts === undefined || contacts.length === 0) return 'none'
  return contacts.map((c) => `${c.kind === 'email' ? 'e-mail' : 'tel'} ${c.value}`).join(', ')
}

import type { BrowserCommand } from '../browser/protocol.ts'
import { asSentence, nameFromSpoken } from './message.ts'

/**
 * Round 8 (docs/ARCHITECTURE.md 29.3.2): mail by voice, by the rules. "kirjuta meil Marile",
 * "uus meil", "teema: Koosolek", "lisa koopia". Tried by inpage.ts before the conversation rules
 * and the spelled-value rules, so "kirjuta meil Marile" is a mail to Mari, never a chat with
 * "Meil Mari" nor the address "marile"; a spelled address ("kirjuta meil ralf ät gmail punkt com")
 * is not a name, so round 5 keeps it. Pure.
 */

/** Gmail's address; the setting mailHome replaces it (the browser suite points it at the stand-in). */
export const GMAIL_HOME = 'https://mail.google.com/mail/'

const MAIL_ET = String.raw`(?:meil|meili|e-?meil|e-?meili|email|e-mail|emaili|e-maili|kiri|kirja|e-?kiri|e-?kirja)`
/** One or two words, the last in the allative ("Marile", "Mari Maasikale"). */
const NAME_ET = String.raw`((?:\p{L}+\s+)?\p{L}{2,}le)`
const COMPOSE_ET = new RegExp(String.raw`^(?:kirjuta|koosta|saada|alusta)\s+(?:uus\s+|üks\s+)?${MAIL_ET}(?:\s+${NAME_ET})?(?:\s*,?\s+et\s+(.+))?$`, 'iu')
const NEW_ET = new RegExp(String.raw`^uus\s+${MAIL_ET}$`, 'iu')
const COMPOSE_EN = /^(?:write|compose|send|start|new)\s+(?:an?\s+new\s+|an?\s+|new\s+)?(?:e-?mail|mail|letter)(?:\s+to\s+(\p{L}+(?:\s+\p{L}+)?))?(?:\s*,?\s+(?:saying|that)\s+(.+))?$/iu
const SUBJECT = /^(?:teema|teemaks|subject)\s*[:,-]?\s+(.+)$/iu
const CC_ET = new RegExp(String.raw`^lisa\s+(?:koopia|koopiasaaja|cc)(?:\s+${NAME_ET})?$`, 'iu')
const CC_EN = /^add\s+(?:an?\s+)?cc(?:\s+(?:to\s+)?(\p{L}+(?:\s+\p{L}+)?))?$/iu

/** Allative pronouns: "kirjuta meil talle" names nobody (the model may know who from the page). */
const PRONOUNS = new Set(['mulle', 'sulle', 'talle', 'meile', 'teile', 'neile', 'endale'])

/** The utterance as the rules read it: trimmed, one space, the sentence's own end mark dropped. */
function tidy(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/[.!?…]+$/u, '').trim()
}

function capitalFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase('et') + text.slice(1)
}

function compose(name: string | undefined, body: string | undefined, lang: 'et' | 'en'): BrowserCommand | null {
  if (name !== undefined && PRONOUNS.has(name.toLowerCase())) return null
  const to = name === undefined ? undefined : nameFromSpoken(name, lang)
  const text = body === undefined ? '' : asSentence(body)
  return { kind: 'compose', ...(to !== undefined ? { to } : {}), ...(text !== '' ? { body: text } : {}) }
}

/** The mail command an utterance is, or null. */
export function mailCommand(utterance: string): BrowserCommand | null {
  const s = tidy(utterance)
  if (s === '') return null
  if (NEW_ET.test(s)) return { kind: 'compose' }
  const et = COMPOSE_ET.exec(s)
  if (et) return compose(et[1], et[2], 'et')
  const en = COMPOSE_EN.exec(s)
  if (en) return compose(en[1], en[2], 'en')
  const subject = SUBJECT.exec(s)?.[1]?.trim()
  if (subject) return { kind: 'mailField', field: 'subject', text: capitalFirst(subject) }
  const cc = CC_ET.exec(s) ?? CC_EN.exec(s)
  if (cc) {
    const name = cc[1]
    if (name !== undefined && PRONOUNS.has(name.toLowerCase())) return null
    const lang = CC_ET.test(s) ? 'et' : 'en'
    return { kind: 'mailField', field: 'cc', ...(name !== undefined ? { text: nameFromSpoken(name, lang) } : {}) }
  }
  return null
}

/**
 * Gmail's compose page (29.3.4): base?view=cm&fs=1&to=…&su=…&body=…, each value encoded; the body
 * only when he dictated it in the same utterance.
 */
export function composeUrl(base: string, mail: { to?: string; subject?: string; body?: string }): string {
  const parts = ['view=cm', 'fs=1']
  if (mail.to !== undefined && mail.to !== '') parts.push(`to=${encodeURIComponent(mail.to)}`)
  if (mail.subject !== undefined && mail.subject !== '') parts.push(`su=${encodeURIComponent(mail.subject)}`)
  if (mail.body !== undefined && mail.body !== '') parts.push(`body=${encodeURIComponent(mail.body)}`)
  return `${base}${base.includes('?') ? '&' : '?'}${parts.join('&')}`
}

import type { BrowserCommand, PageContext, PageItem } from '../browser/protocol.ts'
import type { RecentCommand } from './pageIntent.ts'
import { normalise } from './quickReply.ts'

/**
 * Round 10 (#5, ARCHITECTURE 34): what he meant, on the page he is on. A login in progress keeps
 * its tab (a site he opens goes beside it), the model hears his last commands and how they went,
 * and a tie between two items is one question with two numbers. Pure.
 */

// ---------- 34.3: open beside a login or form in progress ----------

/**
 * A host label that is a login service (accounts.google.com, login.microsoftonline.com,
 * auth.openai.com) or a whole path segment that is a login word (/login, /signin, /accounts/login/,
 * /wp-admin/login.php, #/signin). A word inside a slug (/riigikogu-kinnitas-eelarve) never counts.
 */
const LOGIN_HOST_LABELS = new Set(['login', 'signin', 'sign-in', 'signup', 'sign-up', 'auth', 'sso', 'accounts', 'account', 'verify'])
const LOGIN_SEGMENTS = new Set([
  'login', 'log-in', 'logon', 'signin', 'sign-in', 'signup', 'sign-up', 'register', 'verify', 'verification', 'confirm',
  'auth', 'sso', 'oauth', 'oauth2', 'authorize', '2fa', 'mfa', 'logi-sisse', 'sisene', 'sisselogimine', 'registreeru',
])
/** A page file's extension, so /login.php reads as /login. */
const PAGE_EXTENSION = /\.(?:php|html?|aspx?|jsp|do)$/u

/**
 * A title says login only when one of its parts (split at " | ", " - ", " – ", " — ", " · ", " • ",
 * ": ") STARTS with a login phrase as whole words: "Log in - Anthropic", "Facebook – log in or sign
 * up", "Logi sisse | eesti.ee", "Kinnita tellimus". A headline that has the word inside it ("Officials
 * confirm deal", "How to sign up for a gym", "Riigikogu kinnitas eelarve", "Blogin") does not.
 */
const TITLE_PARTS = /\s+[|\-–—·•]\s+|:\s+/u
const LOGIN_TITLE = /^(?:log[ -]?(?:in|on)|sign[ -]?(?:in|up)|(?:2-step |two-step )?verif(?:y|ication)|confirm|logi sisse|sisselogimine|sisene|kinnita|registreeru)(?![\p{L}\p{N}])/iu

function urlSaysLogin(address: string): boolean {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return false
  }
  if (url.hostname.toLowerCase().split('.').slice(0, -1).some((label) => LOGIN_HOST_LABELS.has(label))) return true
  const segments = `${url.pathname}/${url.hash.replace(/^#/u, '')}`.toLowerCase().split('/')
  return segments.some((segment) => LOGIN_SEGMENTS.has(segment.replace(PAGE_EXTENSION, '')))
}

function titleSaysLogin(title: string): boolean {
  return title.split(TITLE_PARTS).some((part) => LOGIN_TITLE.test(part.trim()))
}

/**
 * True when the page in front is a login or a form he is in the middle of: its address or title
 * says so (above), the box is a password or code field, or the box (not a search) holds words not sent.
 */
export function formInProgress(page: Pick<PageContext, 'url' | 'title' | 'box'>): boolean {
  if (urlSaysLogin(page.url) || titleSaysLogin(page.title)) return true
  const { box } = page
  if (!box.present) return false
  if (box.fieldKind === 'password' || box.fieldKind === 'code') return true
  return box.kind !== 'search' && box.text.trim() !== ''
}

/** The commands with every goTo opened in a new tab instead, when the page in front is in progress; else the same array. */
export function besideCommands(commands: BrowserCommand[], page: Pick<PageContext, 'url' | 'title' | 'box'>): BrowserCommand[] {
  if (!commands.some((c) => c.kind === 'goTo') || !formInProgress(page)) return commands
  return commands.map((c): BrowserCommand => (c.kind === 'goTo' ? { kind: 'newTab', url: c.url } : c))
}

// ---------- 34.2: the last commands and how they went ----------

/** IntentRequestSchema's limits for one recent command. */
export const RECENT_UTTERANCE_CHARS = 200
export const RECENT_RAN_CHARS = 200
export const RECENT_FROM_CHARS = 320
/** How many earlier commands the model hears. */
export const RECENT_COMMANDS = 3
/** A strip line quoted in what ran is clipped to this. */
const SAID_CHARS = 120

const clip = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text)

/** One command as the model reads it: its kind and its target. An item is named by its text when the page is known. */
function commandLine(c: BrowserCommand, items: readonly PageItem[]): string {
  switch (c.kind) {
    case 'setText':
      return 'typed into the box'
    case 'goTo':
      return `goTo ${c.url}`
    case 'newTab':
      return `newTab ${c.url ?? 'empty'}`
    case 'switchTab':
      return `switchTab ${typeof c.to === 'string' ? c.to : JSON.stringify(c.to)}`
    case 'history':
      return `history ${c.direction}`
    case 'siteSearch':
      return `siteSearch ${JSON.stringify(c.query)}`
    case 'clickItem':
    case 'focusItem':
    case 'hover':
    case 'contextMenu':
    case 'scrollTo': {
      const item = items.find((i) => i.id === c.id)
      return `${c.kind} ${c.id}${item ? ` ${JSON.stringify(item.text)}` : ''}`
    }
    case 'clickHint':
      return `clickHint ${c.number}`
    default:
      return c.kind
  }
}

/** What one step ran, e.g. `newTab https://mail.google.com/`; with nothing to run, what the strip said. */
export function ranOf(commands: readonly BrowserCommand[], line: string, items: readonly PageItem[] = []): string {
  if (commands.length === 0) return `nothing; said ${JSON.stringify(clip(line, SAID_CHARS))}`
  return commands.map((c) => commandLine(c, items)).join('; ')
}

/** One recent command for the request, clipped to its schema: the steps it ran joined, oldest first. */
export function recentFrom(utterance: string, ran: readonly string[], ok: boolean, from?: string): RecentCommand {
  const entry: RecentCommand = { utterance: clip(utterance, RECENT_UTTERANCE_CHARS), ran: clip(ran.join('; '), RECENT_RAN_CHARS), ok }
  return from === undefined ? entry : { ...entry, from: clip(from, RECENT_FROM_CHARS) }
}

// ---------- 34.4: the tie ----------

/** The answers to "Kumb: 1 …, 2 …?": 0 for the first, 1 for the second. */
const CHOICES: Readonly<Record<string, number>> = {
  'üks': 0, '1': 0, 'esimene': 0, 'esimest': 0, 'esimese': 0, 'esimesele': 0, 'number üks': 0, 'number 1': 0, 'one': 0, 'first': 0, 'the first': 0, 'number one': 0,
  'kaks': 1, '2': 1, 'teine': 1, 'teist': 1, 'teise': 1, 'teisele': 1, 'number kaks': 1, 'number 2': 1, 'two': 1, 'second': 1, 'the second': 1, 'number two': 1,
}

/** The candidate an answer picks (0 or 1), or null when the words are not an answer to the question. */
export function choicePick(utterance: string): number | null {
  return CHOICES[normalise(utterance)] ?? null
}

/** An item's text as the question says it: without readPage's markers ("[allpool] ", "[dialog] "). */
export function choiceName(text: string): string {
  return text.replace(/^(?:\[[^\]]+\] )+/u, '').trim()
}

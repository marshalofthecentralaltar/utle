import { soundsLike } from './phonetic.ts'
import { normalise } from './quickReply.ts'

/**
 * Round 8, Minu kohad (docs/ARCHITECTURE.md 29.4.2): plain nouns that open the places he set once
 * ("vaata uudiseid" opens his news site). Pure: no storage, no DOM. The model is told the nouns
 * only (placeNouns); the address is found here, on his machine.
 */

export interface Place {
  /** What he says: "uudised". Lower case. */
  noun: string
  /** The address it opens, http(s). */
  url: string
  /** What the settings page and the strip call it: "Postimees". */
  label: string
  /** Other nouns for the same place: "meil", "post" for "mail". */
  aliases?: string[]
}

/** The model's answer that names a place (29.4.2): one of the request's `page.places`, never an address. */
export type PlaceIntent = { kind: 'place'; noun: string }

/** The chrome.storage.local key of his own rows (merged over the defaults). */
export const PLACES_KEY = 'places'
/** At most this many places, and nouns told to the model. */
export const MAX_PLACES = 30
export const PLACE_NOUN_CHARS = 40
const URL_CHARS = 2000
const LABEL_CHARS = 60

/** The Estonian defaults. No bank: which bank is his to say. */
export const DEFAULT_PLACES: readonly Place[] = [
  { noun: 'uudised', url: 'https://www.postimees.ee/', label: 'Postimees', aliases: ['uudis'] },
  { noun: 'raadio', url: 'https://otse.err.ee/k/vikerraadio', label: 'Vikerraadio otse' },
  { noun: 'ilm', url: 'https://www.ilmateenistus.ee/', label: 'Ilmateenistus', aliases: ['ilmateade'] },
  { noun: 'mail', url: 'https://mail.google.com/', label: 'Gmail', aliases: ['meil', 'post', 'email', 'epost'] },
  { noun: 'kalender', url: 'https://calendar.google.com/', label: 'Google Kalender', aliases: ['kalendri'] },
  { noun: 'kaart', url: 'https://www.google.com/maps', label: 'Google Maps', aliases: ['kaardid'] },
  { noun: 'video', url: 'https://www.youtube.com/', label: 'YouTube', aliases: ['videod'] },
]

const webAddress = (url: string): boolean => /^https?:\/\/[^\s]+$/iu.test(url)

/** A noun as stored and compared: lower case, letters, digits and single spaces. */
export function placeNoun(text: string): string {
  return normalise(text).slice(0, PLACE_NOUN_CHARS)
}

/** An address as he typed it: "postimees.ee" gets https://, anything not http(s) is ''. */
export function placeUrl(text: string): string {
  const t = text.trim()
  if (t === '') return ''
  const full = /^[a-z][a-z0-9+.-]*:/iu.test(t) ? t : `https://${t}`
  return webAddress(full) && full.length <= URL_CHARS ? full : ''
}

/** His rows, read from storage: each { noun, url, label? }; an empty url removes a default. */
export interface PlaceRow {
  noun: string
  url: string
  label?: string
}

export function placeRowsFrom(stored: unknown): PlaceRow[] {
  if (!Array.isArray(stored)) return []
  const rows: PlaceRow[] = []
  for (const value of stored) {
    if (typeof value !== 'object' || value === null) continue
    const noun = 'noun' in value && typeof value.noun === 'string' ? placeNoun(value.noun) : ''
    const raw = 'url' in value && typeof value.url === 'string' ? value.url : ''
    const url = raw === '' ? '' : placeUrl(raw)
    if (noun === '' || (raw !== '' && url === '')) continue
    const label = 'label' in value && typeof value.label === 'string' ? value.label.trim().slice(0, LABEL_CHARS) : ''
    rows.push(label === '' ? { noun, url } : { noun, url, label })
  }
  return rows.slice(0, MAX_PLACES)
}

const namesOf = (place: Place): string[] => [place.noun, ...(place.aliases ?? [])]

/** The defaults with his rows over them: a row with a default's noun (or alias) replaces it; an empty url removes it. */
export function placesFrom(stored: unknown): Place[] {
  const rows = placeRowsFrom(stored)
  const out: Place[] = DEFAULT_PLACES.map((p) => ({ ...p }))
  for (const row of rows) {
    const at = out.findIndex((p) => namesOf(p).includes(row.noun))
    const place: Place = { noun: row.noun, url: row.url, label: row.label ?? (row.url === '' ? '' : hostOf(row.url)) }
    if (at >= 0) {
      if (row.url === '') out.splice(at, 1)
      else {
        const before = out[at]
        out[at] = before?.noun === row.noun && before.aliases ? { ...place, aliases: before.aliases } : place
      }
    } else if (row.url !== '') out.push(place)
  }
  return out.slice(0, MAX_PLACES)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./u, '')
  } catch {
    return url
  }
}

/** The nouns the model is told: never an address. */
export function placeNouns(places: readonly Place[]): string[] {
  return places.map((p) => p.noun).slice(0, MAX_PLACES)
}

/** Case endings taken off a heard noun, longest first (uudiseid, raadiot, ilma, videoid, maili). */
const ENDINGS = ['eid', 'sse', 'id', 'ed', 'le', 'st', 't', 'a', 'i', 'd']

function stems(word: string): string[] {
  const out = [word]
  for (const ending of ENDINGS) if (word.endsWith(ending) && word.length - ending.length >= 3) out.push(word.slice(0, -ending.length))
  return out
}

/** The place a heard noun names, or undefined: equal (after a case ending comes off either), else one place that sounds like it. */
export function placeByNoun(places: readonly Place[], heard: string): Place | undefined {
  const word = placeNoun(heard)
  if (word === '') return undefined
  const forms = stems(word)
  const exact = places.find((p) => namesOf(p).some((name) => stems(name).some((s) => forms.includes(s))))
  if (exact) return exact
  if (word.length < 4) return undefined
  const like = places.filter((p) => namesOf(p).some((name) => forms.some((f) => soundsLike(f, name))))
  return like.length === 1 ? like[0] : undefined
}

/** The shapes of 29.4.2. The noun is group 1. */
const SHAPES: readonly RegExp[] = [
  /^(?:ava|vaata|näita|mine|open|show)(?: mulle)?(?: (?:mu|minu|oma|my|the))? (\S+)$/u,
  /^pane (?:mu |minu |oma )?(\S+) (?:mängima|käima|tööle|mängida)$/u,
  /^mis (\S+) (?:on|täna on|on täna|praegu on)$/u,
]

/** "vaata uudiseid", "pane raadio käima", "mis ilm on": the place and its address, or null. */
export function placeCommand(utterance: string, places: readonly Place[]): { place: Place; url: string } | null {
  const s = normalise(utterance)
  for (const shape of SHAPES) {
    const m = shape.exec(s)
    if (!m?.[1]) continue
    const place = placeByNoun(places, m[1])
    if (place && webAddress(place.url)) return { place, url: place.url }
  }
  return null
}

/** The model's `place { noun }`, checked: the noun must be one the request listed. */
export function placeNamed(nouns: readonly string[], noun: string): boolean {
  const n = placeNoun(noun)
  return n !== '' && nouns.includes(n)
}

import { describe, expect, it } from 'vitest'
import type { PageContext } from '../browser/protocol.ts'
import { IntentAnswerSchema, IntentRequestSchema, pageIntentFrom } from './pageIntent.ts'
import type { IntentRequest } from './pageIntent.ts'

const PAGE: PageContext = {
  url: 'https://www.eesti.ee/et/taotlus',
  title: 'Taotlus',
  box: { present: true, text: '', armed: true, kind: 'field', fieldKind: 'email', single: true, label: 'E-post' },
  items: [{ id: 3, role: 'field', text: 'E-post' }],
  media: null,
  hints: false,
  saved: ['minu e-post', 'töö telefon'],
}
const request = (page: PageContext = PAGE): Pick<IntentRequest, 'page' | 'tabs'> => ({ page, tabs: [] })

describe('round 6: insertSaved is validated against the saved names in the request (26.3)', () => {
  it('a listed name is accepted, ignoring case and surrounding space', () => {
    expect(pageIntentFrom({ kind: 'insertSaved', name: 'minu e-post' }, request())).toEqual({ kind: 'insertSaved', name: 'minu e-post' })
    expect(pageIntentFrom({ kind: 'insertSaved', name: ' Töö Telefon ' }, request())).toEqual({ kind: 'insertSaved', name: ' Töö Telefon ' })
  })
  it('a name not in the request is rejected', () => {
    expect(pageIntentFrom({ kind: 'insertSaved', name: 'ema telefon' }, request())).toBeNull()
    expect(pageIntentFrom({ kind: 'insertSaved', name: 'ralf.tamm@gmail.com' }, request())).toBeNull()
  })
  it('nothing saved: every insertSaved is rejected', () => {
    const page: PageContext = { url: PAGE.url, title: PAGE.title, box: PAGE.box, items: PAGE.items, media: null, hints: false }
    expect(pageIntentFrom({ kind: 'insertSaved', name: 'minu e-post' }, request(page))).toBeNull()
  })
  it('an empty or missing name is rejected by the schema', () => {
    expect(pageIntentFrom({ kind: 'insertSaved', name: '' }, request())).toBeNull()
    expect(pageIntentFrom({ kind: 'insertSaved' }, request())).toBeNull()
  })
})

describe('round 6: the request carries saved names within limits (26.1)', () => {
  const base: IntentRequest = { lang: 'et', utterance: 'pane mu email sinna', page: PAGE, tabs: [], recent: [] }
  it('accepts up to 20 names of up to 60 characters', () => {
    expect(IntentRequestSchema.safeParse(base).success).toBe(true)
    expect(IntentRequestSchema.safeParse({ ...base, page: { ...PAGE, saved: Array.from({ length: 20 }, (_, i) => `n${i}`) } }).success).toBe(true)
  })
  it('refuses more names, or a longer one', () => {
    expect(IntentRequestSchema.safeParse({ ...base, page: { ...PAGE, saved: Array.from({ length: 21 }, (_, i) => `n${i}`) } }).success).toBe(false)
    expect(IntentRequestSchema.safeParse({ ...base, page: { ...PAGE, saved: ['x'.repeat(61)] } }).success).toBe(false)
  })
})

describe('round 8: media forward and back carry seconds from 1 to 3600 (29.1)', () => {
  const MEDIA_PAGE: PageContext = { ...PAGE, media: { playing: true, muted: false, volume: 1, fullscreen: false } }
  const seek = (command: Record<string, unknown>): unknown => pageIntentFrom({ kind: 'command', command: { kind: 'media', ...command } }, request(MEDIA_PAGE))
  it('accepts forward and back with 1, 60 and 3600 seconds, and without seconds', () => {
    expect(seek({ action: 'forward', seconds: 1 })).toEqual({ kind: 'command', command: { kind: 'media', action: 'forward', seconds: 1 } })
    expect(seek({ action: 'back', seconds: 60 })).toEqual({ kind: 'command', command: { kind: 'media', action: 'back', seconds: 60 } })
    expect(seek({ action: 'forward', seconds: 3600 })).toEqual({ kind: 'command', command: { kind: 'media', action: 'forward', seconds: 3600 } })
    expect(seek({ action: 'forward' })).toEqual({ kind: 'command', command: { kind: 'media', action: 'forward' } })
  })
  it('rejects 0, a negative, a fraction and above 3600', () => {
    for (const seconds of [0, -5, 1.5, 3601]) {
      expect(seek({ action: 'forward', seconds })).toBeNull()
      expect(seek({ action: 'back', seconds })).toBeNull()
    }
  })
  it('rejects seconds on any other media action', () => {
    for (const action of ['pause', 'play', 'mute', 'volumeUp']) expect(seek({ action, seconds: 10 })).toBeNull()
    expect(seek({ action: 'pause' })).toEqual({ kind: 'command', command: { kind: 'media', action: 'pause' } })
  })
})

// ---------- mail (29.3) ----------
describe('mail (29.3.3): composeTo is validated against the page\'s contacts', () => {
  const CV: PageContext = {
    url: 'https://www.cv.ee/mari-maasikas',
    title: 'Mari Maasikas – CV',
    box: { present: false, text: '', armed: false, kind: 'none' },
    items: [{ id: 1, role: 'link', text: 'Kirjuta mulle' }],
    media: null,
    hints: false,
    contacts: [
      { kind: 'email', value: 'mari.maasikas@example.ee', label: '' },
      { kind: 'email', value: 'mari.tookoht@firma.ee', label: 'Kirjuta mulle' },
      { kind: 'tel', value: '+37251234567', label: '+372 5123 4567' },
    ],
  }
  const composeTo = (address: string, extra: Record<string, string> = {}): unknown => ({ kind: 'command', command: { kind: 'composeTo', address, ...extra } })

  it('composeTo: an address of the page is accepted, ignoring case, with a subject and a body', () => {
    expect(pageIntentFrom(composeTo('mari.maasikas@example.ee'), request(CV))).toEqual({ kind: 'command', command: { kind: 'composeTo', address: 'mari.maasikas@example.ee' } })
    expect(pageIntentFrom(composeTo('Mari.Tookoht@Firma.ee', { subject: 'CV', body: 'Tulen homme.' }), request(CV))).toEqual({
      kind: 'command',
      command: { kind: 'composeTo', address: 'Mari.Tookoht@Firma.ee', subject: 'CV', body: 'Tulen homme.' },
    })
  })

  it('composeTo: an address that is not on the page is rejected: the model never invents a recipient', () => {
    expect(pageIntentFrom(composeTo('mari@gmail.com'), request(CV))).toBeNull()
    expect(pageIntentFrom(composeTo('mari.maasikas@example.ee'), request({ ...CV, contacts: undefined }))).toBeNull()
  })

  it('composeTo: a bad e-mail shape is rejected, so is a phone number', () => {
    expect(pageIntentFrom(composeTo('mari.maasikas@example'), request(CV))).toBeNull()
    expect(pageIntentFrom(composeTo('mari.maasikas@example.ee extra'), request(CV))).toBeNull()
    expect(pageIntentFrom(composeTo('+37251234567'), request(CV))).toBeNull()
    expect(pageIntentFrom(composeTo(''), request(CV))).toBeNull()
    expect(pageIntentFrom({ kind: 'command', command: { kind: 'composeTo' } }, request(CV))).toBeNull()
  })

  it('compose: a name is accepted anywhere; an address in to only when it is on the page', () => {
    expect(pageIntentFrom({ kind: 'command', command: { kind: 'compose', to: 'Mari' } }, request(CV))).toEqual({ kind: 'command', command: { kind: 'compose', to: 'Mari' } })
    expect(pageIntentFrom({ kind: 'command', command: { kind: 'compose', to: 'mari.maasikas@example.ee' } }, request(CV))).not.toBeNull()
    expect(pageIntentFrom({ kind: 'command', command: { kind: 'compose', to: 'keegi@muu.ee' } }, request(CV))).toBeNull()
  })

  it('mailField: subject and cc', () => {
    expect(pageIntentFrom({ kind: 'command', command: { kind: 'mailField', field: 'subject', text: 'Koosolek' } }, request(CV))).not.toBeNull()
    expect(pageIntentFrom({ kind: 'command', command: { kind: 'mailField', field: 'cc' } }, request(CV))).not.toBeNull()
    expect(pageIntentFrom({ kind: 'command', command: { kind: 'mailField', field: 'bcc' } }, request(CV))).toBeNull()
  })

  it('the request carries at most 20 contacts', () => {
    const base: IntentRequest = { lang: 'et', utterance: 'kirjuta talle meil', page: CV, tabs: [], recent: [] }
    expect(IntentRequestSchema.safeParse(base).success).toBe(true)
    const many = Array.from({ length: 21 }, (_, i) => ({ kind: 'email' as const, value: `a${i}@b.ee`, label: '' }))
    expect(IntentRequestSchema.safeParse({ ...base, page: { ...CV, contacts: many } }).success).toBe(false)
    expect(IntentRequestSchema.safeParse({ ...base, page: { ...CV, contacts: [{ kind: 'fax', value: '1', label: '' }] } }).success).toBe(false)
  })
})

// ---------- reading aloud (29.5) ----------
describe('reading aloud (29.5): the schema accepts read and rejects an unknown what', () => {
  const read = (command: Record<string, unknown>): unknown => pageIntentFrom({ kind: 'command', command: { kind: 'read', ...command } }, request())
  it('read: page, box, selection, continue and stop pass', () => {
    for (const what of ['page', 'box', 'selection', 'continue', 'stop']) expect(read({ what })).toEqual({ kind: 'command', command: { kind: 'read', what } })
  })
  it('read: an unknown or missing what is rejected', () => {
    expect(read({ what: 'everything' })).toBeNull()
    expect(read({ what: 'sentence' })).toBeNull()
    expect(read({})).toBeNull()
  })
})

describe('round 9 (30.5.3): the answer may carry usage', () => {
  const ANSWER = { intent: { kind: 'unclear', say: '' }, say: '' }
  const USAGE = { input: 12, output: 40, cacheRead: 6800, cacheWrite: 0, provider: 'anthropic', model: 'claude-sonnet-5-5' }
  it('usage: the schema accepts an answer with usage and keeps it', () => {
    const parsed = IntentAnswerSchema.safeParse({ ...ANSWER, usage: USAGE })
    expect(parsed.success && parsed.data.usage).toEqual(USAGE)
  })
  it('usage: the schema accepts an answer without usage, as before', () => {
    const parsed = IntentAnswerSchema.safeParse(ANSWER)
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'usage' in parsed.data).toBe(false)
  })
  it('usage: negative or fractional counts, or a missing field, are rejected', () => {
    expect(IntentAnswerSchema.safeParse({ ...ANSWER, usage: { ...USAGE, input: -1 } }).success).toBe(false)
    expect(IntentAnswerSchema.safeParse({ ...ANSWER, usage: { ...USAGE, output: 1.5 } }).success).toBe(false)
    const { provider: _provider, ...noProvider } = USAGE
    expect(IntentAnswerSchema.safeParse({ ...ANSWER, usage: noProvider }).success).toBe(false)
  })
})

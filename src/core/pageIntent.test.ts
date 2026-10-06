import { describe, expect, it } from 'vitest'
import type { PageContext } from '../browser/protocol.ts'
import { IntentRequestSchema, pageIntentFrom } from './pageIntent.ts'
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

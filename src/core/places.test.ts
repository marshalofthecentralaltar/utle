import { describe, expect, it } from 'vitest'
import { DEFAULT_PLACES, placeByNoun, placeCommand, placeHost, placeNamed, placeNounSaid, placeNouns, placeRowsFrom, placeRowsWith, placeUrl, placeVoice, placesFrom } from './places.ts'

const places = placesFrom(undefined)

describe('Minu kohad (29.4.2)', () => {
  it('has the Estonian defaults and no bank', () => {
    expect(placeNouns(places)).toEqual(['uudised', 'raadio', 'ilm', 'mail', 'kalender', 'kaart', 'video'])
    expect(places.find((p) => p.noun === 'pank')).toBeUndefined()
    expect(places).toEqual(DEFAULT_PLACES)
  })

  it('places: the phrases of the brief open the place by the rules', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['vaata uudiseid', 'https://www.postimees.ee/'],
      ['näita uudiseid', 'https://www.postimees.ee/'],
      ['ava uudised', 'https://www.postimees.ee/'],
      ['pane raadio mängima', 'https://otse.err.ee/k/vikerraadio'],
      ['pane raadio käima', 'https://otse.err.ee/k/vikerraadio'],
      ['ava raadio', 'https://otse.err.ee/k/vikerraadio'],
      ['mis ilm on', 'https://www.ilmateenistus.ee/'],
      ['näita ilma', 'https://www.ilmateenistus.ee/'],
      ['ava mu mail', 'https://mail.google.com/'],
      ['ava meil', 'https://mail.google.com/'],
      ['vaata videoid', 'https://www.youtube.com/'],
      ['Vaata uudiseid.', 'https://www.postimees.ee/'],
      ['ava raadiot', 'https://otse.err.ee/k/vikerraadio'],
      ['näita kaarti', 'https://www.google.com/maps'],
      ['ava kalender', 'https://calendar.google.com/'],
    ]
    for (const [said, url] of cases) expect([said, placeCommand(said, places)?.url]).toEqual([said, url])
  })

  it('places: everything else is not a place', () => {
    for (const said of ['vaata hiljem', 'ava youtube', 'mine whatsappi', 'näita numbreid', 'ava postimees', 'tere', 'uudised', 'ava pank', 'mis kell on', 'pane muusika mängima', 'ava uus vaheleht']) {
      expect([said, placeCommand(said, places)]).toEqual([said, null])
    }
  })

  it('matches a noun after a case ending comes off, and by sound', () => {
    expect(placeByNoun(places, 'uudiseid')?.noun).toBe('uudised')
    expect(placeByNoun(places, 'raadiot')?.noun).toBe('raadio')
    expect(placeByNoun(places, 'ilma')?.noun).toBe('ilm')
    expect(placeByNoun(places, 'maili')?.noun).toBe('mail')
    expect(placeByNoun(places, 'raadijo')?.noun).toBe('raadio')
    expect(placeByNoun(places, 'kass')).toBeUndefined()
  })

  it('his row wins over a default, adds a new place, and an empty address removes a default', () => {
    const mine = placesFrom([
      { noun: 'Uudised', url: 'https://www.err.ee/', label: 'ERR' },
      { noun: 'pank', url: 'lhv.ee' },
      { noun: 'kaart', url: '' },
      { noun: 'halb', url: 'javascript:alert(1)' },
      'not a row',
    ])
    expect(placeCommand('vaata uudiseid', mine)?.url).toBe('https://www.err.ee/')
    expect(mine.find((p) => p.noun === 'uudised')?.label).toBe('ERR')
    expect(placeCommand('ava pank', mine)?.url).toBe('https://lhv.ee')
    expect(mine.find((p) => p.noun === 'pank')?.label).toBe('lhv.ee')
    expect(placeCommand('näita kaarti', mine)).toBeNull()
    expect(mine.some((p) => p.noun === 'halb')).toBe(false)
  })

  it('reads addresses as he types them', () => {
    expect(placeUrl('postimees.ee')).toBe('https://postimees.ee')
    expect(placeUrl('https://www.err.ee/raadio')).toBe('https://www.err.ee/raadio')
    expect(placeUrl('ftp://x.ee')).toBe('')
    expect(placeUrl('')).toBe('')
    expect(placeRowsFrom([{ noun: ' ', url: 'x.ee' }])).toEqual([])
  })

  it('the model may name only a listed noun', () => {
    const nouns = placeNouns(places)
    expect(placeNamed(nouns, 'uudised')).toBe(true)
    expect(placeNamed(nouns, 'Raadio')).toBe(true)
    expect(placeNamed(nouns, 'pank')).toBe(false)
    expect(placeNamed(nouns, 'https://www.postimees.ee/')).toBe(false)
  })
})

// ---------- saving a place by voice (29.4.3) ----------
describe('saving a place by voice (29.4.3)', () => {
  it('voice place: the save and remove phrases, with the noun', () => {
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ['lisa koht uudised', { action: 'save', noun: 'uudised' }],
      ['salvesta see koht uudised', { action: 'save', noun: 'uudised' }],
      ['Salvesta see koht: pank.', { action: 'save', noun: 'pank' }],
      ['lisa koht nimega töö meil', { action: 'save', noun: 'töö meil' }],
      ['see on mu uudised', { action: 'save', noun: 'uudised' }],
      ['save this place as news', { action: 'save', noun: 'news' }],
      ['save this page as my bank', { action: 'save', noun: 'bank' }],
      ['eemalda koht uudised', { action: 'remove', noun: 'uudised' }],
      ['remove place news', { action: 'remove', noun: 'news' }],
    ]
    for (const [said, want] of cases) expect([said, placeVoice(said, false)]).toEqual([said, want])
  })

  it('voice place: "lisa koht" alone asks for the noun', () => {
    expect(placeVoice('lisa koht', false)).toEqual({ action: 'save', noun: null })
    expect(placeVoice('salvesta see koht', true)).toEqual({ action: 'save', noun: null })
    expect(placeVoice('save this place', false)).toEqual({ action: 'save', noun: null })
    expect(placeVoice('eemalda koht', false)).toEqual({ action: 'remove', noun: null })
  })

  it('voice place: a command word is never a noun, three words are too many, and "see on mu …" is a message in an armed box', () => {
    for (const said of ['lisa koht saada', 'lisa koht keri alla', 'see on mu vaata', 'lisa koht üks kaks kolm', 'tere', 'vaata uudiseid', 'lisa uus e-post']) {
      expect([said, placeVoice(said, false)]).toEqual([said, null])
    }
    expect(placeVoice('see on mu uudised', true)).toBeNull()
    expect(placeVoice('lisa koht uudised', true)).toEqual({ action: 'save', noun: 'uudised' })
    expect(placeNounSaid('Uudised!')).toBe('uudised')
    expect(placeNounSaid('ava')).toBe('')
  })

  it('voice place: a saved row replaces his row for the noun, and opens on "vaata uudiseid"', () => {
    let rows = placeRowsWith([], { noun: 'uudised', url: 'https://www.err.ee/' })
    rows = placeRowsWith(rows, { noun: 'uudised', url: 'https://news.ee/' })
    expect(rows).toEqual([{ noun: 'uudised', url: 'https://news.ee/' }])
    expect(placeCommand('vaata uudiseid', placesFrom(rows))?.url).toBe('https://news.ee/')
    rows = placeRowsWith(rows, { noun: 'uudised', url: '' })
    expect(placeCommand('vaata uudiseid', placesFrom(rows))).toBeNull()
    expect(placeHost('https://www.postimees.ee/x')).toBe('postimees.ee')
  })
})
// ---------- end of saving a place by voice ----------

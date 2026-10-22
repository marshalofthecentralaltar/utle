import { describe, expect, it } from 'vitest'
import { DEFAULT_PLACES, placeByNoun, placeCommand, placeNamed, placeNouns, placeRowsFrom, placeUrl, placesFrom } from './places.ts'

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

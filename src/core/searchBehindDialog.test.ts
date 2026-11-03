import { describe, expect, it } from 'vitest'
import { behindDialog, dialogButtons } from '../browser/protocol.ts'
import type { BrowserCommand } from '../browser/protocol.ts'
import { STRINGS } from './strings.ts'

// Lane EXIT, finding 5: on YouTube the plan "go to YouTube and search" ran the search while the cookie
// consent covered the page; the field was there but hidden, and the strip told him "Sellel lehel ei ole
// otsingut. Ütle „otsi googlest“." (wrong: the page has a search, the consent is in front of it).
const search: BrowserCommand = { kind: 'siteSearch', query: 'lastelaulud' }
const consent = behindDialog(['Keeldu kõigist', 'Nõustu kõigiga', 'Rohkem valikuid'])

describe('lane EXIT (finding 5): a search behind an open dialog', () => {
  it('says to answer the dialog first and names its buttons, not "no search here"', () => {
    const line = STRINGS.et.browserFailed(search, 'not_found', consent)
    expect(line).not.toContain('otsi googlest')
    expect(line).toContain('„nõustu kõigiga“')
    expect(line).toContain('„keeldu kõigist“')
    expect(line).toContain('Vasta enne aknale')
  })

  it('names at most two buttons, and still says to answer the dialog when none can be read', () => {
    expect(STRINGS.et.browserFailed(search, 'not_found', consent)).not.toContain('rohkem valikuid')
    const bare = STRINGS.et.browserFailed(search, 'not_found', behindDialog([]))
    expect(bare).not.toContain('otsi googlest')
    expect(bare).toContain('Vasta enne aknale')
  })

  it('in English too', () => {
    const line = STRINGS.en.browserFailed(search, 'not_found', consent)
    expect(line).not.toContain('search google')
    expect(line).toContain('“Nõustu kõigiga”')
  })

  it('a page with no search field keeps its line', () => {
    expect(STRINGS.et.browserFailed(search, 'not_found', 'This page has no search field.')).toBe('Sellel lehel ei ole otsingut. Ütle „otsi googlest“.')
  })

  it('the message carries the buttons both ways', () => {
    expect(dialogButtons(consent)).toEqual(['Keeldu kõigist', 'Nõustu kõigiga', 'Rohkem valikuid'])
    expect(dialogButtons(behindDialog([]))).toEqual([])
    expect(dialogButtons('This page has no search field.')).toBeNull()
  })
})

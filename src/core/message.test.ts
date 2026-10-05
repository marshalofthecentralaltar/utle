import { describe, expect, it } from 'vitest'
import { asSentence, messageCommand, nameFromSpoken } from './message.ts'
import type { MessageCommand } from './message.ts'

const ROWS: Array<[string, MessageCommand]> = [
  ['kirjuta sõnum Marile', { kind: 'start', to: 'Mari', text: null }],
  ['Uus sõnum Marile.', { kind: 'start', to: 'Mari', text: null }],
  ['sõnum Marile', { kind: 'start', to: 'Mari', text: null }],
  ['saada sõnum Jaanile', { kind: 'start', to: 'Jaani', text: null }],
  ['kirjuta Märdile', { kind: 'start', to: 'Märdi', text: null }],
  ['uus sõnum', { kind: 'start', to: null, text: null }],
  ['kirjuta sõnum', { kind: 'start', to: null, text: null }],
  ['message Mari', { kind: 'start', to: 'Mari', text: null }],
  ['write a message to Mari', { kind: 'start', to: 'Mari', text: null }],
  ['new message', { kind: 'start', to: null, text: null }],
  ['Kirjuta Marile, et ma jõuan homme kell kolm', { kind: 'start', to: 'Mari', text: 'Ma jõuan homme kell kolm.' }],
  ['kirjuta Marile sõnum, et olen hiljaks jäämas!', { kind: 'start', to: 'Mari', text: 'Olen hiljaks jäämas!' }],
  ['write to Mari that I will be late', { kind: 'start', to: 'Mari', text: 'I will be late.' }],
  ['tell Mari that I am on my way.', { kind: 'start', to: 'Mari', text: 'I am on my way.' }],
  ['saada', { kind: 'send' }],
  ['Saada ära.', { kind: 'send' }],
  ['saadake', { kind: 'send' }],
  ['Saadake.', { kind: 'send' }],
  ['saadake ära', { kind: 'send' }],
  ['saadame', { kind: 'send' }],
  ['saada sõnum', { kind: 'send' }],
  ['send', { kind: 'send' }],
  ['send the message', { kind: 'send' }],
  ['katkesta sõnum', { kind: 'drop' }],
  ['loobu sõnumist', { kind: 'drop' }],
  ['cancel the message', { kind: 'drop' }],
]

describe('messageCommand', () => {
  it.each(ROWS)('%s', (text, command) => {
    expect(messageCommand(text)).toEqual(command)
  })

  it.each([
    'kirjuta eelarve kohta, et see on hiljaks jäänud',
    'muuda eelarve tähtaeg reedeks',
    'sõnumid',
    'send it to finance by Friday',
    '',
    // Send is literal: what only sounds like it, or has it inside a sentence, is not it.
    'sada',
    'saadan',
    'saata',
    'saada mulle pilt',
    'saadake talle ka',
  ])(
    'leaves "%s" alone',
    (text) => {
      expect(messageCommand(text)).toBeNull()
    },
  )
})

describe('nameFromSpoken: the allative rule', () => {
  it.each([
    ['marile', 'Mari'],
    ['Jaanile', 'Jaani'],
    ['märdile', 'Märdi'],
    ['mari tammele', 'Mari Tamme'],
    ['Ole', 'Ole'],
  ])('%s becomes %s', (spoken, name) => {
    expect(nameFromSpoken(spoken, 'et')).toBe(name)
  })

  it('leaves English names as heard, capitalised', () => {
    expect(nameFromSpoken('mari', 'en')).toBe('Mari')
  })
})

describe('asSentence', () => {
  it('capitalises and ends with a full stop', () => {
    expect(asSentence('  ma jõuan kell kolm ')).toBe('Ma jõuan kell kolm.')
    expect(asSentence('kas sa tuled?')).toBe('Kas sa tuled?')
  })
})

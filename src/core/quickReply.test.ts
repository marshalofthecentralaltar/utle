import { describe, expect, it } from 'vitest'
import { quickReply } from './quickReply.ts'

describe('quickReply', () => {
  it.each(['Yes.', 'yes', 'YEAH', 'yep', 'OK', 'okay', 'correct', 'do it', 'jah', 'Jah!'])(
    '%s is yes',
    (text) => {
      expect(quickReply(text)).toEqual({ kind: 'yes' })
    },
  )

  it.each(['No', 'no.', 'nope', 'cancel', 'ei', 'Ei!'])('%s is no', (text) => {
    expect(quickReply(text)).toEqual({ kind: 'no' })
  })

  it.each(['undo', 'Undo that.', 'võta tagasi'])('%s is undo', (text) => {
    expect(quickReply(text)).toEqual({ kind: 'undo' })
  })

  it.each(['stop listening', 'Stop listening.', 'go to sleep'])('%s is sleep', (text) => {
    expect(quickReply(text)).toEqual({ kind: 'sleep' })
  })

  it.each(['wake up', 'Wake up!', 'ärka üles'])('%s is wake', (text) => {
    expect(quickReply(text)).toEqual({ kind: 'wake' })
  })

  it.each(['2', 'two', 'Two.', 'number two', 'option 2', 'second', 'the second', 'kaks'])(
    '%s is number 2',
    (text) => {
      expect(quickReply(text)).toEqual({ kind: 'number', n: 2 })
    },
  )

  it.each([
    ['one', 1],
    ['ten', 10],
    ['twenty', 20],
    ['20', 20],
    ['14', 14],
    ['tenth', 10],
    ['üks', 1],
    ['kümme', 10],
  ] as const)('%s is number %d', (text, n) => {
    expect(quickReply(text)).toEqual({ kind: 'number', n })
  })

  it.each([
    ['to', 2],
    ['too', 2],
    ['for', 4],
    ['won', 1],
    ['ate', 8],
  ] as const)('%s counts as %d only while a number is expected', (text, n) => {
    expect(quickReply(text, { expectNumber: true })).toEqual({ kind: 'number', n })
    expect(quickReply(text)).toBeNull()
  })

  it.each([
    'yes please change it to Friday',
    'Not Wednesday. Tuesday.',
    'two paragraphs',
    'no deadline is mentioned',
    '0',
    '',
    '   ',
    '?!',
  ])('"%s" is not a quick reply', (text) => {
    expect(quickReply(text)).toBeNull()
    expect(quickReply(text, { expectNumber: true })).toBeNull()
  })
})

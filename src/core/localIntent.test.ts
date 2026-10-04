import { describe, expect, it } from 'vitest'
import { SAMPLE_DOC } from './document.ts'
import type { Doc } from './document.ts'
import { localIntent, sectionText } from './localIntent.ts'

const ET_DOC: Doc = [
  { id: 'e1', type: 'h1', text: 'Koosoleku protokoll' },
  { id: 'e2', type: 'h2', text: 'Kokkuvõte' },
  { id: 'e3', type: 'p', text: 'Piloot läks käima.' },
  { id: 'e4', type: 'h2', text: 'Eelarve' },
  { id: 'e5', type: 'p', text: 'Kulud on plaanis.' },
  { id: 'e6', type: 'h2', text: 'Järgmised sammud' },
  { id: 'e7', type: 'li', text: 'Liis uuendab juhendit.' },
]

function nav(blockId: string, readAloud = false) {
  return { kind: 'navigate', blockId, readAloud }
}

describe('localIntent: moving by number', () => {
  it.each(['go to paragraph 6', 'Paragraph six.', 'go to 6', 'jump to paragraph six'])('%s', (text) => {
    expect(localIntent(text, SAMPLE_DOC, null)).toEqual(nav('b6'))
  })

  it.each(['mine lõigu 4 juurde', 'lõik 4', 'mine lõik neli'])('%s', (text) => {
    expect(localIntent(text, ET_DOC, null)).toEqual(nav('e4'))
  })

  it('says the range when the number names no paragraph', () => {
    const intent = localIntent('go to paragraph 40', SAMPLE_DOC, null)
    expect(intent?.kind).toBe('not_understood')
    expect(intent?.kind === 'not_understood' && intent.message).toContain('10')
  })
})

describe('localIntent: moving by heading', () => {
  it.each(['go to budget', 'Go to the budget.', 'show budget', 'open the budget section', 'jump to Budget'])(
    '%s',
    (text) => {
      expect(localIntent(text, SAMPLE_DOC, null)).toEqual(nav('b5'))
    },
  )

  it('matches a heading of several words', () => {
    expect(localIntent('go to next steps', SAMPLE_DOC, null)).toEqual(nav('b7'))
  })

  it.each(['mine eelarve juurde', 'näita eelarvet', 'mine kokkuvõtte juurde', 'ava kokkuvõte'])('%s', (text) => {
    const expected = text.includes('eelarve') ? 'e4' : 'e2'
    expect(localIntent(text, ET_DOC, null)).toEqual(nav(expected))
  })

  it('leaves it to the model when no heading or more than one matches', () => {
    expect(localIntent('go to the appendix', SAMPLE_DOC, null)).toBeNull()
    const twins: Doc = [
      { id: 'a', type: 'h2', text: 'Budget 2026' },
      { id: 'b', type: 'h2', text: 'Budget 2027' },
    ]
    expect(localIntent('go to budget', twins, null)).toBeNull()
  })

  it('does not match a heading in another language', () => {
    expect(localIntent('mine kokkuvõtte juurde', SAMPLE_DOC, null)).toBeNull()
  })
})

describe('localIntent: relative moves', () => {
  it('moves down and up from the focus', () => {
    expect(localIntent('next', SAMPLE_DOC, 'b3')).toEqual(nav('b4'))
    expect(localIntent('next paragraph', SAMPLE_DOC, 'b3')).toEqual(nav('b4'))
    expect(localIntent('previous', SAMPLE_DOC, 'b3')).toEqual(nav('b2'))
    expect(localIntent('back', SAMPLE_DOC, 'b3')).toEqual(nav('b2'))
    expect(localIntent('järgmine', ET_DOC, 'e2')).toEqual(nav('e3'))
    expect(localIntent('eelmine', ET_DOC, 'e2')).toEqual(nav('e1'))
  })

  it('starts from the top when nothing is focused and stays inside the document', () => {
    expect(localIntent('next', SAMPLE_DOC, null)).toEqual(nav('b1'))
    expect(localIntent('previous', SAMPLE_DOC, null)).toEqual(nav('b1'))
    expect(localIntent('next', SAMPLE_DOC, 'b10')).toEqual(nav('b10'))
    expect(localIntent('previous', SAMPLE_DOC, 'b1')).toEqual(nav('b1'))
  })

  it('jumps to the top and the bottom', () => {
    for (const text of ['top', 'go to the top', 'beginning', 'algusesse']) {
      expect(localIntent(text, SAMPLE_DOC, 'b5')).toEqual(nav('b1'))
    }
    for (const text of ['bottom', 'go to the end', 'end', 'lõppu']) {
      expect(localIntent(text, SAMPLE_DOC, 'b5')).toEqual(nav('b10'))
    }
  })
})

describe('localIntent: reading', () => {
  it.each(['read it', 'read this', 'Read aloud.', 'read that out', 'loe ette', 'loe see ette'])('%s reads the focus', (text) => {
    expect(localIntent(text, SAMPLE_DOC, 'b4')).toEqual(nav('b4', true))
  })

  it('asks where when nothing is focused', () => {
    expect(localIntent('read it', SAMPLE_DOC, null)?.kind).toBe('not_understood')
  })

  it.each(['read paragraph 4', 'read 4', 'read paragraph four aloud'])('%s', (text) => {
    expect(localIntent(text, SAMPLE_DOC, null)).toEqual(nav('b4', true))
  })

  it('reads a heading by name in both languages', () => {
    expect(localIntent('read the summary', SAMPLE_DOC, null)).toEqual(nav('b3', true))
    expect(localIntent('loe kokkuvõte', ET_DOC, null)).toEqual(nav('e2', true))
    expect(localIntent('loe lõik 3', ET_DOC, null)).toEqual(nav('e3', true))
  })

  it('combines going and reading', () => {
    expect(localIntent('go to budget and read it', SAMPLE_DOC, null)).toEqual(nav('b5', true))
    expect(localIntent('mine eelarve juurde ja loe ette', ET_DOC, null)).toEqual(nav('e4', true))
    expect(localIntent('mine kokkuvõtte juurde ja loe see ette', ET_DOC, null)).toEqual(nav('e2', true))
  })
})

describe('localIntent: deleting', () => {
  it.each(['delete paragraph 2', 'remove paragraph two', 'kustuta lõik 2'])('%s proposes a delete', (text) => {
    const intent = localIntent(text, SAMPLE_DOC, null)
    expect(intent).toMatchObject({ kind: 'propose_edit', ops: [{ op: 'delete_block', blockId: 'b2' }] })
  })

  it('deletes the focused block on delete this', () => {
    for (const text of ['delete this', 'delete it', 'kustuta see']) {
      expect(localIntent(text, SAMPLE_DOC, 'b8')).toMatchObject({
        kind: 'propose_edit',
        ops: [{ op: 'delete_block', blockId: 'b8' }],
      })
    }
    expect(localIntent('delete this', SAMPLE_DOC, null)?.kind).toBe('not_understood')
  })
})

describe('localIntent: what stays with the model', () => {
  it.each([
    'Change the budget deadline to Friday.',
    'go to the budget and change the deadline to Friday',
    'delete the sentence about the supplier',
    'read the minutes and tell me what is missing',
    'next steps should come before risks',
    'Add a next step: Marten sends the contract.',
    'the next paragraph is too long',
    '',
  ])('"%s" is not local', (text) => {
    expect(localIntent(text, SAMPLE_DOC, 'b4')).toBeNull()
  })
})

describe('sectionText', () => {
  it('gives a paragraph its own text', () => {
    expect(sectionText(SAMPLE_DOC, 'b6')).toBe(SAMPLE_DOC[5]?.text)
  })

  it('gives a heading the text of its whole section', () => {
    expect(sectionText(SAMPLE_DOC, 'b7')).toBe('Next steps. Liis updates the upload instructions.')
    expect(sectionText(SAMPLE_DOC, 'b3')).toContain('The pilot with the first supplier')
    expect(sectionText(SAMPLE_DOC, 'b3')).not.toContain('Budget')
  })

  it('is empty for an unknown block', () => {
    expect(sectionText(SAMPLE_DOC, 'zz')).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import { SAMPLE_DOC } from '../src/core/document.ts'
import { initialSession, step } from '../src/core/session.ts'
import type { Session } from '../src/core/session.ts'
import { rehearse } from './rehearsal.ts'

const LINES = [
  'Change the budget deadline to Friday.',
  'Yes.',
  'Move risks above next steps.',
  'Yes.',
  'Shorten the sentence about the supplier.',
  'Two.',
  'Yes.',
  'Add a next step: Martin sends the contract by Wednesday.',
  'Not Wednesday. Tuesday.',
  'Yes.',
  'Mine kokkuvõtte juurde ja loe see ette.',
  'Stop listening.',
]

function play(lines: string[]): Session {
  let session = initialSession(SAMPLE_DOC)
  for (const text of lines) {
    const said = step(session, { type: 'utterance', text, source: 'voice' })
    session = said.state
    const effect = said.effects[0]
    if (effect) {
      session = step(session, { type: 'intent', seq: effect.seq, intent: rehearse(effect.request) }).state
    }
  }
  return session
}

describe('rehearsal mode', () => {
  it('plays the demo script to the same end as the mock-up', () => {
    const s = play(LINES)
    const text = (id: string): string => s.doc.find((b) => b.id === id)?.text ?? ''
    expect(s.mode).toBe('asleep')
    expect(s.history).toHaveLength(4)
    expect(text('b6')).toContain('by Friday.')
    expect(s.doc.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b9', 'b10', 'b7', 'b8', 'b11'])
    expect(text('b4')).toContain('Two invoice errors in the first week were fixed the same day.')
    expect(text('b11')).toBe('Marten sends the contract by Tuesday.')
  })

  it('asks which sentence with four candidates', () => {
    const intent = rehearse({ doc: SAMPLE_DOC, utterance: 'Shorten the sentence about the supplier.', pending: null, choice: null })
    expect(intent.kind === 'ask_which' && intent.candidates).toHaveLength(4)
  })

  it('navigates to the summary in Estonian and English', () => {
    for (const utterance of ['Mine kokkuvõtte juurde ja loe see ette.', 'Go to the summary.']) {
      const intent = rehearse({ doc: SAMPLE_DOC, utterance, pending: null, choice: null })
      expect(intent).toMatchObject({ kind: 'navigate', blockId: 'b3' })
    }
  })

  it('says so when a line is not in the script', () => {
    const intent = rehearse({ doc: SAMPLE_DOC, utterance: 'Delete everything.', pending: null, choice: null })
    expect(intent.kind).toBe('not_understood')
  })

  it('never returns an intent that does not fit the document', () => {
    const afterEdit = play(LINES.slice(0, 2)).doc
    const again = rehearse({ doc: afterEdit, utterance: 'Change the budget deadline to Friday.', pending: null, choice: null })
    expect(again.kind).toBe('not_understood')
  })
})

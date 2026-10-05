import { describe, expect, it } from 'vitest'
import type { BrowserCommand, BrowserResult } from '../browser/protocol.ts'
import { BRIDGE_TIMED_OUT } from './browserIntent.ts'
import { SAMPLE_DOC, sampleDoc } from './document.ts'
import type { Doc } from './document.ts'
import type { Intent, InterpretRequest } from './intent.ts'
import { sectionText } from './localIntent.ts'
import { initialSession, step } from './session.ts'
import type { Effect, Event, Session } from './session.ts'
import { clone, deepFreeze } from './testUtil.ts'

const S2 = 'The supplier reported two invoice errors in the first week, which were corrected the same day.'
const S2_SHORT = 'Two invoice errors in the first week were fixed the same day.'

const FRIDAY: Intent = {
  kind: 'propose_edit',
  summary: 'Budget: Thursday becomes Friday.',
  ops: [{ op: 'replace_text', blockId: 'b6', find: 'Thursday', replace: 'Friday' }],
}
const WHICH: Intent = {
  kind: 'ask_which',
  question: 'Four sentences mention the supplier.',
  candidates: [
    { blockId: 'b4', quote: 'The pilot with the first supplier went live on 28 September.' },
    { blockId: 'b4', quote: S2 },
    { blockId: 'b4', quote: 'The team agreed that the supplier portal needs clearer upload instructions' },
    { blockId: 'b10', quote: 'The second supplier has not confirmed a start date.' },
  ],
}

/** Applies events in order to a frozen session, so any mutation inside step throws. */
function run(start: Session, ...events: Event[]): { state: Session; effects: Effect[] } {
  let state = deepFreeze(clone(start))
  let effects: Effect[] = []
  for (const event of events) {
    const result = step(state, deepFreeze(clone(event)))
    state = deepFreeze(clone(result.state))
    effects = result.effects
  }
  return { state, effects }
}

function say(text: string, source: 'voice' | 'typed' = 'voice'): Event {
  return { type: 'utterance', text, source }
}

/** Says a line and, when the reducer asks the interpreter, answers with the given intent. */
function converse(start: Session, text: string, intent?: Intent): Session {
  const first = run(start, say(text))
  const request = first.effects.find((effect) => effect.type === 'interpret')
  if (!request) {
    if (intent) throw new Error(`"${text}" made no request but an intent was scripted`)
    return first.state
  }
  if (!intent) throw new Error(`"${text}" made a request but no intent was scripted`)
  return run(first.state, { type: 'intent', seq: request.seq, intent }).state
}

/** The request of the interpret effect, when the reducer asked the interpreter. */
function requestOf(effects: Effect[]): InterpretRequest | undefined {
  for (const effect of effects) if (effect.type === 'interpret') return effect.request
  return undefined
}

function textOf(doc: Doc, id: string): string {
  return doc.find((b) => b.id === id)?.text ?? ''
}

function confirming(): Session {
  return converse(initialSession(SAMPLE_DOC), 'Change the budget deadline to Friday.', FRIDAY)
}

function choosing(): Session {
  return converse(initialSession(SAMPLE_DOC), 'Shorten the sentence about the supplier.', WHICH)
}

describe('listening', () => {
  it('starts listening with the document untouched', () => {
    const s = initialSession(SAMPLE_DOC)
    expect(s.mode).toBe('listening')
    expect(s.doc).toEqual(SAMPLE_DOC)
    expect(s.history).toEqual([])
  })

  it('ignores an empty utterance', () => {
    const start = initialSession(SAMPLE_DOC)
    const { state, effects } = run(start, say('   '))
    expect(state).toEqual(start)
    expect(effects).toEqual([])
  })

  it('sends any other utterance to the interpreter with no context', () => {
    const { state, effects } = run(initialSession(SAMPLE_DOC), say('Change the budget deadline to Friday.'))
    expect(state.mode).toBe('thinking')
    expect(state.heard).toBe('Change the budget deadline to Friday.')
    expect(effects).toEqual([
      {
        type: 'interpret',
        seq: state.seq,
        request: {
          doc: SAMPLE_DOC,
          utterance: 'Change the budget deadline to Friday.',
          pending: null,
          choice: null,
          lang: 'en',
          message: null,
        },
      },
    ])
  })

  it('moves focus when a paragraph number is said, without a request', () => {
    const { state, effects } = run(initialSession(SAMPLE_DOC), say('six'))
    expect(state.focusId).toBe('b6')
    expect(state.mode).toBe('listening')
    expect(effects).toEqual([])
  })

  it('says so when the number names no paragraph', () => {
    const { state } = run(initialSession(SAMPLE_DOC), say('19'))
    expect(state.focusId).toBeNull()
    expect(state.understood).not.toBe('')
  })

  it('has nothing to confirm or undo at the start', () => {
    for (const word of ['yes', 'no', 'undo']) {
      const { state, effects } = run(initialSession(SAMPLE_DOC), say(word))
      expect(state.mode).toBe('listening')
      expect(state.doc).toEqual(SAMPLE_DOC)
      expect(effects).toEqual([])
    }
  })
})

describe('confirming', () => {
  it('holds the proposal and leaves the document untouched', () => {
    const s = confirming()
    expect(s.mode).toBe('confirming')
    expect(s.pending?.ops).toEqual(FRIDAY.kind === 'propose_edit' ? FRIDAY.ops : [])
    expect(s.understood).toBe('Budget: Thursday becomes Friday.')
    expect(s.doc).toEqual(SAMPLE_DOC)
  })

  it('applies the proposal on yes and records it', () => {
    const { state, effects } = run(confirming(), say('Yes.'))
    expect(textOf(state.doc, 'b6')).toContain('by Friday.')
    expect(state.mode).toBe('listening')
    expect(state.pending).toBeNull()
    expect(state.history).toEqual([SAMPLE_DOC])
    expect(state.log).toEqual(['Budget: Thursday becomes Friday.'])
    expect(effects).toEqual([])
  })

  it('discards the proposal on no', () => {
    const { state } = run(confirming(), say('no'))
    expect(state.doc).toEqual(SAMPLE_DOC)
    expect(state.mode).toBe('listening')
    expect(state.pending).toBeNull()
    expect(state.history).toEqual([])
  })

  it('treats undo as no', () => {
    const { state } = run(confirming(), say('undo'))
    expect(state.mode).toBe('listening')
    expect(state.pending).toBeNull()
    expect(state.doc).toEqual(SAMPLE_DOC)
  })

  it('accepts and rejects by key, counting a hand action', () => {
    const yes = run(confirming(), { type: 'key', key: 'confirm' }).state
    expect(textOf(yes.doc, 'b6')).toContain('by Friday.')
    expect(yes.hands).toBe(1)
    const no = run(confirming(), { type: 'key', key: 'reject' }).state
    expect(no.doc).toEqual(SAMPLE_DOC)
    expect(no.mode).toBe('listening')
    expect(no.hands).toBe(1)
  })

  it('sends a repair to the interpreter with the pending proposal', () => {
    const before = confirming()
    const { state, effects } = run(before, say('Not Friday. Monday.'))
    expect(state.mode).toBe('thinking')
    expect(requestOf(effects)?.pending).toEqual(before.pending)
    expect(requestOf(effects)?.utterance).toBe('Not Friday. Monday.')
    expect(requestOf(effects)?.choice).toBeNull()
  })

  it('replaces the proposal when the repair comes back', () => {
    const monday: Intent = {
      kind: 'propose_edit',
      summary: 'Budget: Thursday becomes Monday.',
      ops: [{ op: 'replace_text', blockId: 'b6', find: 'Thursday', replace: 'Monday' }],
    }
    const s = converse(confirming(), 'Not Friday. Monday.', monday)
    expect(s.mode).toBe('confirming')
    expect(s.pending?.summary).toBe('Budget: Thursday becomes Monday.')
    expect(s.doc).toEqual(SAMPLE_DOC)
  })
})

describe('choosing', () => {
  it('holds the question and the candidates', () => {
    const s = choosing()
    expect(s.mode).toBe('choosing')
    expect(s.choice?.candidates).toHaveLength(4)
    expect(s.choice?.utterance).toBe('Shorten the sentence about the supplier.')
    expect(s.understood).toBe('Four sentences mention the supplier.')
  })

  it('sends the original instruction with the picked candidate when a number is said', () => {
    const before = choosing()
    const { state, effects } = run(before, say('Two.'))
    expect(state.mode).toBe('thinking')
    expect(requestOf(effects)).toEqual({
      doc: SAMPLE_DOC,
      utterance: 'Shorten the sentence about the supplier.',
      pending: null,
      choice: {
        utterance: 'Shorten the sentence about the supplier.',
        candidates: before.choice?.candidates,
        picked: 1,
      },
      lang: 'en',
      message: null,
    })
  })

  it('accepts recogniser homophones for numbers', () => {
    const { effects } = run(choosing(), say('to'))
    expect(requestOf(effects)?.choice?.picked).toBe(1)
    const four = run(choosing(), say('for'))
    expect(requestOf(four.effects)?.choice?.picked).toBe(3)
  })

  it('asks again when the number is out of range', () => {
    const { state, effects } = run(choosing(), say('nine'))
    expect(state.mode).toBe('choosing')
    expect(effects).toEqual([])
  })

  it('drops the question on no and on the reject key', () => {
    expect(run(choosing(), say('no')).state.mode).toBe('listening')
    expect(run(choosing(), say('no')).state.choice).toBeNull()
    const byKey = run(choosing(), { type: 'key', key: 'reject' }).state
    expect(byKey.mode).toBe('listening')
    expect(byKey.hands).toBe(1)
  })

  it('sends any other answer to the interpreter with the question as context', () => {
    const before = choosing()
    const { effects } = run(before, say('the one about invoices'))
    expect(requestOf(effects)?.utterance).toBe('the one about invoices')
    expect(requestOf(effects)?.choice).toEqual({
      utterance: 'Shorten the sentence about the supplier.',
      candidates: before.choice?.candidates,
      picked: null,
    })
  })

  it('treats a question with fewer than two usable candidates as not understood', () => {
    const one: Intent = { kind: 'ask_which', question: 'Which?', candidates: [{ blockId: 'b4', quote: S2 }] }
    const s = converse(initialSession(SAMPLE_DOC), 'Shorten it.', one)
    expect(s.mode).toBe('listening')
    expect(s.choice).toBeNull()
    const ghosts: Intent = {
      kind: 'ask_which',
      question: 'Which?',
      candidates: [
        { blockId: 'b4', quote: S2 },
        { blockId: 'zz', quote: 'x' },
      ],
    }
    expect(converse(initialSession(SAMPLE_DOC), 'Shorten it.', ghosts).mode).toBe('listening')
  })
})

describe('thinking', () => {
  it('ignores utterances and keys while a request is in flight', () => {
    const thinking = run(initialSession(SAMPLE_DOC), say('Change the deadline.')).state
    const { state, effects } = run(thinking, say('yes'), { type: 'key', key: 'confirm' })
    expect(state.mode).toBe('thinking')
    expect(state.seq).toBe(thinking.seq)
    expect(state.heard).toBe('Change the deadline.')
    expect(state.words).toBe(thinking.words)
    expect(effects).toEqual([])
  })

  it('ignores an intent with a stale seq', () => {
    const thinking = run(initialSession(SAMPLE_DOC), say('Change the deadline.')).state
    const { state } = run(thinking, { type: 'intent', seq: thinking.seq - 1, intent: FRIDAY })
    expect(state).toEqual(thinking)
  })

  it('ignores an intent that arrives when nothing is in flight', () => {
    const start = initialSession(SAMPLE_DOC)
    expect(run(start, { type: 'intent', seq: start.seq, intent: FRIDAY }).state).toEqual(start)
  })

  it('changes nothing when the proposed ops do not apply', () => {
    const bad: Intent = {
      kind: 'propose_edit',
      summary: 'x',
      ops: [{ op: 'replace_text', blockId: 'b6', find: 'Monday', replace: 'Friday' }],
    }
    const s = converse(initialSession(SAMPLE_DOC), 'Change the deadline.', bad)
    expect(s.mode).toBe('listening')
    expect(s.pending).toBeNull()
    expect(s.doc).toEqual(SAMPLE_DOC)
  })

  it('focuses the block on navigate without asking for confirmation', () => {
    const s = converse(initialSession(SAMPLE_DOC), 'Take me to the part about the pilot.', {
      kind: 'navigate',
      blockId: 'b3',
      readAloud: false,
    })
    expect(s.mode).toBe('listening')
    expect(s.focusId).toBe('b3')
  })

  it('keeps a pending proposal across navigation', () => {
    const s = converse(confirming(), 'Take me to the part about the pilot.', { kind: 'navigate', blockId: 'b3', readAloud: false })
    expect(s.mode).toBe('confirming')
    expect(s.pending).not.toBeNull()
    expect(s.focusId).toBe('b3')
  })

  it('shows the message and returns to listening when not understood', () => {
    const s = converse(initialSession(SAMPLE_DOC), 'Hmm.', { kind: 'not_understood', message: 'Say that again.' })
    expect(s.mode).toBe('listening')
    expect(s.understood).toBe('Say that again.')
  })

  it('restores the mode and keeps the proposal when the request fails, and yes still works', () => {
    const before = confirming()
    const asked = run(before, say('Not Friday. Monday.'))
    const failed = run(asked.state, {
      type: 'interpretFailed',
      seq: asked.state.seq,
      message: 'The assistant is unreachable.',
    }).state
    expect(failed.mode).toBe('confirming')
    expect(failed.pending).toEqual(before.pending)
    expect(failed.understood).toContain('unreachable')
    const applied = run(failed, say('yes')).state
    expect(textOf(applied.doc, 'b6')).toContain('by Friday.')
  })

  it('ignores a failure report with a stale seq', () => {
    const thinking = run(initialSession(SAMPLE_DOC), say('Change the deadline.')).state
    const { state } = run(thinking, { type: 'interpretFailed', seq: thinking.seq + 5, message: 'x' })
    expect(state).toEqual(thinking)
  })
})

describe('undo', () => {
  it('restores the previous document and drops the log line, twice in a row', () => {
    let s = converse(confirming(), 'Yes.')
    s = converse(s, 'Remove the attendees.', {
      kind: 'propose_edit',
      summary: 'Attendees removed.',
      ops: [{ op: 'delete_block', blockId: 'b2' }],
    })
    s = converse(s, 'yes')
    expect(s.history).toHaveLength(2)

    s = converse(s, 'undo')
    expect(s.doc.map((b) => b.id)).toContain('b2')
    expect(textOf(s.doc, 'b6')).toContain('by Friday.')
    expect(s.log).toEqual(['Budget: Thursday becomes Friday.'])

    s = converse(s, 'undo')
    expect(s.doc).toEqual(SAMPLE_DOC)
    expect(s.history).toEqual([])
    expect(s.log).toEqual([])
  })
})

describe('asleep', () => {
  it('goes to sleep, ignores everything, and wakes on the wake phrase', () => {
    const asleep = converse(initialSession(SAMPLE_DOC), 'Stop listening.')
    expect(asleep.mode).toBe('asleep')
    const ignored = run(asleep, say('Change the budget deadline to Friday.'), { type: 'key', key: 'confirm' })
    expect(ignored.state).toEqual(asleep)
    expect(ignored.effects).toEqual([])
    expect(converse(asleep, 'wake up').mode).toBe('listening')
  })

  it('drops a pending proposal when told to sleep', () => {
    const s = converse(confirming(), 'stop listening')
    expect(s.mode).toBe('asleep')
    expect(s.pending).toBeNull()
    expect(s.doc).toEqual(SAMPLE_DOC)
  })
})

describe('counting', () => {
  it('counts the words of every handled utterance', () => {
    const s = converse(confirming(), 'Yes.')
    expect(s.words).toBe(6 + 1)
  })

  it('counts typed utterances and acted-on keys as hand actions, and voice as none', () => {
    const typed = run(initialSession(SAMPLE_DOC), say('six', 'typed')).state
    expect(typed.hands).toBe(1)
    const voice = run(initialSession(SAMPLE_DOC), say('six', 'voice')).state
    expect(voice.hands).toBe(0)
    const idleKey = run(initialSession(SAMPLE_DOC), { type: 'key', key: 'confirm' }).state
    expect(idleKey.hands).toBe(0)
  })
})

describe('local commands', () => {
  it('handles a local command at once, without a request', () => {
    const start = initialSession(SAMPLE_DOC)
    const { state, effects } = run(start, say('go to budget'))
    expect(state.mode).toBe('listening')
    expect(state.focusId).toBe('b5')
    expect(state.seq).toBe(start.seq)
    expect(effects).toEqual([])
  })

  it('deletes a paragraph by number with no request at any point, and still asks for yes', () => {
    const proposed = run(initialSession(SAMPLE_DOC), say('delete paragraph 2'))
    expect(proposed.state.mode).toBe('confirming')
    expect(proposed.state.doc).toEqual(SAMPLE_DOC)
    expect(proposed.effects).toEqual([])
    const applied = run(proposed.state, say('yes'))
    expect(applied.state.doc.map((b) => b.id)).not.toContain('b2')
    expect(applied.effects).toEqual([])
  })

  it('moves locally while a proposal is pending and keeps the proposal', () => {
    const before = confirming()
    const { state, effects } = run(before, say('go to budget'))
    expect(state.mode).toBe('confirming')
    expect(state.pending).toEqual(before.pending)
    expect(state.focusId).toBe('b5')
    expect(effects).toEqual([])
  })

  it('sends anything but a move to the interpreter while a proposal is pending', () => {
    const before = confirming()
    const { state, effects } = run(before, say('delete paragraph 2'))
    expect(state.mode).toBe('thinking')
    expect(requestOf(effects)?.pending).toEqual(before.pending)
  })

  it('moves locally while a question is open and keeps the question', () => {
    const before = choosing()
    const { state } = run(before, say('go to budget'))
    expect(state.mode).toBe('choosing')
    expect(state.choice).toEqual(before.choice)
    expect(state.focusId).toBe('b5')
  })
})

describe('reading aloud', () => {
  function reading(): Session {
    return run(initialSession(SAMPLE_DOC), say('read paragraph 6')).state
  }

  it('speaks the paragraph and marks the session as reading', () => {
    const { state, effects } = run(initialSession(SAMPLE_DOC), say('read paragraph 6'))
    expect(state.reading).toBe(true)
    expect(state.focusId).toBe('b6')
    expect(state.mode).toBe('listening')
    expect(effects).toEqual([{ type: 'speak', text: textOf(SAMPLE_DOC, 'b6') }])
  })

  it('speaks the whole section when the block is a heading', () => {
    const { effects } = run(initialSession(SAMPLE_DOC), say('read the summary'))
    expect(effects).toEqual([{ type: 'speak', text: sectionText(SAMPLE_DOC, 'b3') }])
  })

  it('speaks when the interpreter asks for it', () => {
    const asked = run(initialSession(SAMPLE_DOC), say('Mine kokkuvõtte juurde ja loe see ette.'))
    const { state, effects } = run(asked.state, {
      type: 'intent',
      seq: asked.state.seq,
      intent: { kind: 'navigate', blockId: 'b3', readAloud: true },
    })
    expect(state.reading).toBe(true)
    expect(effects).toEqual([{ type: 'speak', text: sectionText(SAMPLE_DOC, 'b3') }])
  })

  it('stops on stop', () => {
    const { state, effects } = run(reading(), say('stop'))
    expect(state.reading).toBe(false)
    expect(effects).toEqual([{ type: 'hush' }])
    expect(state.mode).toBe('listening')
  })

  it('stops first and then handles any other utterance', () => {
    const moved = run(reading(), say('next'))
    expect(moved.state.reading).toBe(false)
    expect(moved.state.focusId).toBe('b7')
    expect(moved.effects).toEqual([{ type: 'hush' }])

    const asked = run(reading(), say('Change the budget deadline to Friday.'))
    expect(asked.state.reading).toBe(false)
    expect(asked.effects.map((effect) => effect.type)).toEqual(['hush', 'interpret'])
  })

  it('can start a new reading while one is running', () => {
    const { state, effects } = run(reading(), say('read paragraph 2'))
    expect(state.reading).toBe(true)
    expect(effects).toEqual([{ type: 'hush' }, { type: 'speak', text: textOf(SAMPLE_DOC, 'b2') }])
  })

  it('says so when stop is said and nothing is being read', () => {
    const start = initialSession(SAMPLE_DOC)
    const { state, effects } = run(start, say('stop'))
    expect(state.reading).toBe(false)
    expect(state.understood).not.toBe(start.understood)
    expect(effects).toEqual([])
  })

  it('ends when the speech ends', () => {
    const { state, effects } = run(reading(), { type: 'speechEnded' })
    expect(state.reading).toBe(false)
    expect(effects).toEqual([])
  })

  it('goes quiet when told to sleep', () => {
    const { state, effects } = run(reading(), say('stop listening'))
    expect(state.mode).toBe('asleep')
    expect(state.reading).toBe(false)
    expect(effects).toEqual([{ type: 'hush' }])
  })

  it('never turns something heard while reading into an edit without yes', () => {
    const { state } = run(reading(), say('delete paragraph 2'))
    expect(state.mode).toBe('confirming')
    expect(state.doc).toEqual(SAMPLE_DOC)
  })
})

describe('help', () => {
  it('opens on help and closes on the next utterance', () => {
    const open = run(initialSession(SAMPLE_DOC), say('help'))
    expect(open.state.help).toBe(true)
    expect(open.effects).toEqual([])
    expect(run(open.state, say('six')).state.help).toBe(false)
  })
})

describe('scenario: the mock-up script', () => {
  it('finishes four edits by voice without a hand', () => {
    const lines: Array<[string, Intent?]> = [
      ['Change the budget deadline to Friday.', FRIDAY],
      ['Yes.'],
      [
        'Move risks above next steps.',
        {
          kind: 'propose_edit',
          summary: 'Risks moves above Next steps.',
          ops: [{ op: 'move_blocks', blockIds: ['b9', 'b10'], beforeBlockId: 'b7' }],
        },
      ],
      ['Yes.'],
      ['Shorten the sentence about the supplier.', WHICH],
      [
        'Two.',
        {
          kind: 'propose_edit',
          summary: 'Summary, second sentence shortened.',
          ops: [{ op: 'replace_text', blockId: 'b4', find: S2, replace: S2_SHORT }],
        },
      ],
      ['Yes.'],
      [
        'Add a next step: Martin sends the contract by Wednesday.',
        {
          kind: 'propose_edit',
          summary: 'New item under Next steps. Heard Martin, used Marten.',
          ops: [
            { op: 'insert_block', afterBlockId: 'b8', blockType: 'li', text: 'Marten sends the contract by Wednesday.' },
          ],
        },
      ],
      [
        'Not Wednesday. Tuesday.',
        {
          kind: 'propose_edit',
          summary: 'New item under Next steps, by Tuesday.',
          ops: [
            { op: 'insert_block', afterBlockId: 'b8', blockType: 'li', text: 'Marten sends the contract by Tuesday.' },
          ],
        },
      ],
      ['Yes.'],
      ['Mine kokkuvõtte juurde ja loe see ette.', { kind: 'navigate', blockId: 'b3', readAloud: true }],
      ['Stop listening.'],
    ]

    let s = initialSession(SAMPLE_DOC)
    for (const [text, intent] of lines) s = converse(s, text, intent)

    expect(s.mode).toBe('asleep')
    expect(textOf(s.doc, 'b6')).toBe('Spending is within plan. The revised budget must be sent to finance by Friday.')
    expect(s.doc.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b9', 'b10', 'b7', 'b8', 'b11'])
    expect(textOf(s.doc, 'b4')).toContain(S2_SHORT)
    expect(textOf(s.doc, 'b4')).not.toContain(S2)
    expect(s.doc.at(-1)).toEqual({ id: 'b11', type: 'li', text: 'Marten sends the contract by Tuesday.' })
    expect(s.history).toHaveLength(4)
    expect(s.log).toHaveLength(4)
    expect(s.hands).toBe(0)
    expect(s.focusId).toBeNull()
    const spoken = lines.reduce((sum, [text]) => sum + text.trim().split(/\s+/).length, 0)
    expect(s.words).toBe(spoken)
  })
})

// ---------------------------------------------------------------------------------------------
// M4: Estonian first, browser commands, hint numbers, the message draft (ARCHITECTURE 20.3).

const ET = (): Session => initialSession(sampleDoc('et'), 'et')

function browserOf(effects: Effect[]): BrowserCommand[] {
  return effects.flatMap((effect) => (effect.type === 'browser' ? [effect.command] : []))
}

function seqOf(effects: Effect[]): number {
  for (const effect of effects) if (effect.type === 'browser') return effect.seq
  throw new Error('no browser effect')
}

/** Answers the browser effect of a step with the given result. */
function answer(previous: { state: Session; effects: Effect[] }, result: BrowserResult) {
  const command = browserOf(previous.effects)[0]
  if (!command) throw new Error('no browser effect to answer')
  return run(previous.state, { type: 'browserResult', seq: seqOf(previous.effects), command, result })
}

const OK: BrowserResult = { ok: true }

describe('Estonian first', () => {
  it('speaks Estonian from the first line', () => {
    const s = ET()
    expect(s.lang).toBe('et')
    expect(s.understood).toBe('Kuulan.')
    expect(s.prompt).toBe('Ütle, mida muuta, või lõigu number.')
  })

  it('sends the language with every interpreter request', () => {
    const { effects } = run(ET(), say('Muuda eelarve tähtaeg reedeks.'))
    expect(requestOf(effects)?.lang).toBe('et')
    expect(requestOf(effects)?.message).toBeNull()
  })

  it('answers local lines in Estonian', () => {
    expect(run(ET(), say('võta tagasi')).state.understood).toBe('Pole midagi tagasi võtta.')
    expect(run(ET(), say('neli')).state.understood).toBe('Lõik 4.')
    expect(run(ET(), say('kustuta lõik neli')).state.understood).toBe('Kustutan lõigu 4.')
  })

  it('shows an interpreter failure in Estonian', () => {
    const asked = run(ET(), say('Muuda eelarve tähtaeg reedeks.'))
    const seq = asked.effects[0]?.type === 'interpret' ? asked.effects[0].seq : -1
    const { state } = run(asked.state, { type: 'interpretFailed', seq, message: 'Abiline ei vasta.' })
    expect(state.understood).toBe('Abiline ei vasta.')
    expect(state.prompt).toBe('Ütle, mida muuta, või lõigu number.')
  })

  it('swaps the sample document when the language changes before anything was done', () => {
    const { state } = run(ET(), { type: 'language', lang: 'en' })
    expect(state.lang).toBe('en')
    expect(state.doc).toEqual(SAMPLE_DOC)
    expect(state.understood).toBe('Waiting for you to speak.')
    expect(state.prompt).toBe('Say what to change, or a paragraph number.')
  })

  it('keeps an edited document when the language changes', () => {
    const edited = converse(initialSession(SAMPLE_DOC), 'Change the budget deadline to Friday.', FRIDAY)
    const { state } = run(edited, say('yes'), { type: 'language', lang: 'et' })
    expect(textOf(state.doc, 'b6')).toContain('Friday')
    expect(state.prompt).toBe('Ütle, mida muuta, või lõigu number.')
  })
})

describe('browser commands: local, no model, no yes', () => {
  const rows: Array<[string, BrowserCommand]> = [
    ['ava uus vaheleht', { kind: 'newTab' }],
    ['ava messenger', { kind: 'goTo', url: 'https://www.messenger.com/' }],
    ['järgmine vaheleht', { kind: 'switchTab', to: 'next' }],
    ['kolmas vaheleht', { kind: 'switchTab', to: { index: 3 } }],
    ['mine tagasi', { kind: 'history', direction: 'back' }],
    ['laadi uuesti', { kind: 'reload' }],
    ['keri alla', { kind: 'scroll', direction: 'down' }],
    ['otsi bussiaeg', { kind: 'goTo', url: 'https://www.google.com/search?q=bussiaeg' }],
  ]
  it.each(rows)('%s emits the browser effect and no interpret effect', (text, command) => {
    const { state, effects } = run(ET(), say(text))
    expect(browserOf(effects)).toEqual([command])
    expect(requestOf(effects)).toBeUndefined()
    expect(state.mode).toBe('listening')
    expect(state.pending).toBeNull()
  })

  it('shows the result in the session language', () => {
    const { state } = answer(run(ET(), say('ava messenger')), { ok: true, tab: { title: 'Messenger', url: 'https://www.messenger.com/' } })
    expect(state.understood).toBe('Avatud: Messenger.')
    const english = answer(run(initialSession(SAMPLE_DOC), say('open messenger')), { ok: true, tab: { title: 'Messenger', url: 'x' } })
    expect(english.state.understood).toBe('Opened: Messenger.')
  })

  it('says how to fix a missing extension', () => {
    const { state } = answer(run(ET(), say('uus vaheleht')), { ok: false, code: 'no_extension', message: 'timeout' })
    expect(state.understood).toBe('Brauseri laiendus ei vasta. Paigalda Ütle laiendus ja laadi see leht uuesti.')
  })

  it('never shows the extension’s own failure text', () => {
    const { state } = answer(run(ET(), say('sulge vaheleht')), { ok: false, code: 'failed', message: 'Tab could not be closed' })
    expect(state.understood).toBe('See ei õnnestunud.')
  })

  it('ignores a stale result', () => {
    const first = run(ET(), say('keri alla'))
    const second = run(first.state, say('keri üles'))
    const stale = run(second.state, {
      type: 'browserResult',
      seq: seqOf(first.effects),
      command: { kind: 'scroll', direction: 'down' },
      result: OK,
    })
    expect(stale.state.understood).toBe(second.state.understood)
  })

  it('keeps a pending proposal while moving in the browser', () => {
    const s = converse(initialSession(SAMPLE_DOC), 'Change the budget deadline to Friday.', FRIDAY)
    const { state, effects } = run(s, say('next tab'))
    expect(browserOf(effects)).toEqual([{ kind: 'switchTab', to: 'next' }])
    expect(state.mode).toBe('confirming')
    expect(state.pending).toEqual(s.pending)
  })
})

describe('the ambiguity rule: the document wins', () => {
  it('"järgmine" is the next paragraph, "järgmine vaheleht" the next tab', () => {
    const doc = run(ET(), say('järgmine'))
    expect(browserOf(doc.effects)).toEqual([])
    expect(doc.state.focusId).toBe('b1')
    expect(browserOf(run(ET(), say('järgmine vaheleht')).effects)).toEqual([{ kind: 'switchTab', to: 'next' }])
  })

  it('"ava eelarve" opens the heading, "ava messenger" the site', () => {
    const doc = run(ET(), say('ava eelarve'))
    expect(browserOf(doc.effects)).toEqual([])
    expect(doc.state.focusId).toBe('b5')
    expect(browserOf(run(ET(), say('ava messenger')).effects)).toHaveLength(1)
  })

  it('English "go back" stays the previous paragraph; "page back" is the browser', () => {
    const s = run(initialSession(SAMPLE_DOC), say('paragraph 4')).state
    const doc = run(s, say('go back'))
    expect(browserOf(doc.effects)).toEqual([])
    expect(doc.state.focusId).toBe('b3')
    expect(browserOf(run(s, say('page back')).effects)).toEqual([{ kind: 'history', direction: 'back' }])
  })

  it('"mine tagasi" is the browser, "võta tagasi" is undo', () => {
    expect(browserOf(run(ET(), say('mine tagasi')).effects)).toEqual([{ kind: 'history', direction: 'back' }])
    const undo = run(ET(), say('võta tagasi'))
    expect(browserOf(undo.effects)).toEqual([])
    expect(undo.state.understood).toBe('Pole midagi tagasi võtta.')
  })
})

describe('hint numbers', () => {
  function showing(): Session {
    return answer(run(ET(), say('näita numbreid')), { ok: true, hints: 23 }).state
  }

  it('shows how many and expects a number', () => {
    const s = showing()
    expect(s.hints).toBe(true)
    expect(s.understood).toBe('Numbrid on näha (23). Ütle number.')
  })

  it('a bare number clicks while labels show, and focuses a paragraph otherwise', () => {
    const click = run(showing(), say('viis'))
    expect(browserOf(click.effects)).toEqual([{ kind: 'clickHint', number: 5 }])
    expect(click.state.hints).toBe(false)
    expect(click.state.focusId).toBeNull()
    const focus = run(ET(), say('viis'))
    expect(browserOf(focus.effects)).toEqual([])
    expect(focus.state.focusId).toBe('b5')
  })

  it('"vajuta viis" always clicks; "peida numbrid" hides', () => {
    expect(browserOf(run(ET(), say('vajuta viis')).effects)).toEqual([{ kind: 'clickHint', number: 5 }])
    const hidden = run(showing(), say('peida numbrid'))
    expect(browserOf(hidden.effects)).toEqual([{ kind: 'hideHints' }])
    expect(hidden.state.hints).toBe(false)
  })

  it('a failed showHints leaves no labels', () => {
    const s = answer(run(ET(), say('näita numbreid')), { ok: false, code: 'not_allowed', message: 'chrome page' }).state
    expect(s.hints).toBe(false)
    expect(s.understood).toBe('Seda lehte ei saa Ütle juhtida.')
  })
})

describe('the message draft', () => {
  const TEXT = 'Ma jõuan homme kell kolm.'
  const REPAIRED = 'Ma jõuan homme kell neli.'

  function draft(): Session {
    return run(ET(), say('kirjuta sõnum Marile')).state
  }

  /** A draft to Mari that holds TEXT, accepted. */
  function written(): Session {
    return run(draft(), say('ma jõuan homme kell kolm'), say('jah')).state
  }

  it('starts: the document is saved, an empty draft to Mari is shown', () => {
    const s = draft()
    expect(s.draft?.to).toBe('Mari')
    expect(s.doc).toEqual([])
    expect(s.draft?.saved.doc).toEqual(sampleDoc('et'))
    expect(s.mode).toBe('listening')
    expect(s.understood).toBe('Uus sõnum. Saaja: Mari.')
    expect(s.prompt).toBe('Ütle, mida kirjutada. Kui valmis, ütle „saada“.')
  })

  it.each(['uus sõnum Marile', 'sõnum Marile', 'message Mari', 'write a message to Mari'])('"%s" starts a draft to Mari', (text) => {
    expect(run(ET(), say(text)).state.draft?.to).toBe('Mari')
  })

  it('one breath: starts the draft with the text proposed', () => {
    const { state, effects } = run(ET(), say('Kirjuta Marile, et ma jõuan homme kell kolm'))
    expect(requestOf(effects)).toBeUndefined()
    expect(state.draft?.to).toBe('Mari')
    expect(state.mode).toBe('confirming')
    expect(state.understood).toBe('Uus sõnum. Saaja: Mari.')
    expect(state.pending?.ops).toEqual([{ op: 'insert_block', afterBlockId: null, blockType: 'p', text: TEXT }])
  })

  it('dictating into an empty draft proposes the words without the model', () => {
    const { state, effects } = run(draft(), say('ma jõuan homme kell kolm'))
    expect(requestOf(effects)).toBeUndefined()
    expect(state.mode).toBe('confirming')
    const accepted = run(state, say('jah')).state
    expect(accepted.doc.map((b) => b.text)).toEqual([TEXT])
    expect(accepted.mode).toBe('listening')
    expect(accepted.prompt).toBe('Ütle, mida kirjutada. Kui valmis, ütle „saada“.')
  })

  it('a repair goes to the interpreter against the draft, in Estonian, with the recipient', () => {
    const proposed = run(ET(), say('Kirjuta Marile, et ma jõuan homme kell kolm')).state
    const request = requestOf(run(proposed, say('mitte kolm, vaid neli')).effects)
    expect(request?.doc).toEqual([])
    expect(request?.pending?.ops).toEqual(proposed.pending?.ops)
    expect(request?.message).toEqual({ to: 'Mari' })
    expect(request?.lang).toBe('et')
    const repaired = converse(proposed, 'mitte kolm, vaid neli', {
      kind: 'propose_edit',
      summary: 'Kolme asemel neli.',
      ops: [{ op: 'insert_block', afterBlockId: null, blockType: 'p', text: REPAIRED }],
    })
    expect(run(repaired, say('jah')).state.doc.map((b) => b.text)).toEqual([REPAIRED])
  })

  it('more words into a draft with text go to the interpreter', () => {
    const request = requestOf(run(written(), say('lisa, et ma toon kooki')).effects)
    expect(request?.doc.map((b) => b.text)).toEqual([TEXT])
    expect(request?.message).toEqual({ to: 'Mari' })
  })

  it('send asks first, showing who and what', () => {
    const { state, effects } = run(written(), say('saada'))
    expect(effects).toEqual([])
    expect(state.mode).toBe('confirmingSend')
    expect(state.understood).toBe(`Saaja: Mari. „${TEXT}“ Kas saadan?`)
    expect(state.prompt).toBe('Ütle jah või ei.')
  })

  it('yes sends: openConversation, then insertText with submit, then the document comes back', () => {
    const yes = run(written(), say('saada'), say('jah'))
    expect(yes.state.mode).toBe('sending')
    expect(browserOf(yes.effects)).toEqual([{ kind: 'openConversation', name: 'Mari' }])
    const opened = answer(yes, OK)
    expect(browserOf(opened.effects)).toEqual([{ kind: 'insertText', text: TEXT, submit: true }])
    const sent = answer(opened, OK)
    expect(sent.state.draft).toBeNull()
    expect(sent.state.doc).toEqual(sampleDoc('et'))
    expect(sent.state.mode).toBe('listening')
    expect(sent.state.understood).toBe('Saadetud. Saaja: Mari. Dokument on tagasi.')
  })

  it('the key confirms a send too', () => {
    const { effects } = run(written(), say('saada'), { type: 'key', key: 'confirm' })
    expect(browserOf(effects)).toEqual([{ kind: 'openConversation', name: 'Mari' }])
  })

  it('no returns to the draft', () => {
    const { state, effects } = run(written(), say('saada'), say('ei'))
    expect(effects).toEqual([])
    expect(state.mode).toBe('listening')
    expect(state.doc.map((b) => b.text)).toEqual([TEXT])
    expect(state.understood).toBe('Ei saatnud. Sõnum on alles.')
  })

  it('a failed send keeps the draft and says why, in Estonian', () => {
    const yes = run(written(), say('saada'), say('jah'))
    const failed = answer(yes, { ok: false, code: 'not_found', message: 'No conversation matches Mari' })
    expect(failed.state.mode).toBe('listening')
    expect(failed.state.draft?.to).toBe('Mari')
    expect(failed.state.doc.map((b) => b.text)).toEqual([TEXT])
    expect(failed.state.understood).toBe('Ei saatnud. Vestlust „Mari“ ei leitud. Sõnum on alles.')
    const later = answer(answer(yes, OK), { ok: false, code: 'no_extension', message: '' })
    expect(later.state.draft).not.toBeNull()
    expect(later.state.understood).toBe(
      'Ei saatnud. Brauseri laiendus ei vasta. Paigalda Ütle laiendus ja laadi see leht uuesti. Sõnum on alles.',
    )
  })

  it('a send the browser did not answer in time keeps the draft and says to look before sending again', () => {
    const yes = run(written(), say('saada'), say('jah'))
    const late = answer(answer(yes, OK), { ok: false, code: 'failed', message: BRIDGE_TIMED_OUT })
    expect(late.state.mode).toBe('listening')
    expect(late.state.draft?.to).toBe('Mari')
    expect(late.state.understood).toBe(
      'Brauser ei vastanud õigel ajal. Sõnum võis minna või mitte: vaata vestlus üle, enne kui uuesti saadad.',
    )
    // Opening the conversation timed out: nothing was typed, so nothing can have gone.
    const open = answer(yes, { ok: false, code: 'failed', message: BRIDGE_TIMED_OUT })
    expect(open.state.understood).toBe('Ei saatnud. Brauser ei vastanud õigel ajal. Sõnum on alles.')
  })

  it('a browser command that timed out says so instead of "did not work"', () => {
    const { state } = answer(run(ET(), say('ava messenger')), { ok: false, code: 'failed', message: BRIDGE_TIMED_OUT })
    expect(state.understood).toBe('Brauser ei vastanud õigel ajal.')
  })

  it('while sending, the line says what is happening until the answer comes', () => {
    const yes = run(written(), say('saada'), say('jah'))
    expect(yes.state.understood).toBe('Avan vestluse: Mari.')
    expect(answer(yes, OK).state.understood).toBe('Kirjutan sõnumi.')
  })

  it('an utterance while sending waits', () => {
    const yes = run(written(), say('saada'), say('jah'))
    const { state, effects } = run(yes.state, say('ava messenger'))
    expect(effects).toEqual([])
    expect(state.mode).toBe('sending')
    expect(state.understood).toBe('Hetk, eelmine on veel pooleli.')
  })

  it('drop restores the document and its history', () => {
    const edited = converse(ET(), 'Muuda eelarve tähtaeg reedeks.', {
      kind: 'propose_edit',
      summary: 'Eelarve: neljapäeva asemel reede.',
      ops: [{ op: 'replace_text', blockId: 'b6', find: 'neljapäevaks', replace: 'reedeks' }],
    })
    const accepted = run(edited, say('jah')).state
    const dropped = run(accepted, say('kirjuta sõnum Marile'), say('ma tulen'), say('jah'), say('katkesta sõnum')).state
    expect(dropped.draft).toBeNull()
    expect(dropped.doc).toEqual(accepted.doc)
    expect(dropped.history).toEqual(accepted.history)
    expect(dropped.log).toEqual(accepted.log)
    expect(dropped.understood).toBe('Sõnum on katkestatud. Dokument on tagasi.')
  })

  it('no recipient: sends into the focused message box with insertText only', () => {
    const s = run(ET(), say('uus sõnum'), say('olen kohe tagasi'), say('jah'), say('saada')).state
    expect(s.understood).toBe('Avatud sõnumikasti: „Olen kohe tagasi.“ Kas saadan?')
    const yes = run(s, say('jah'))
    expect(browserOf(yes.effects)).toEqual([{ kind: 'insertText', text: 'Olen kohe tagasi.', submit: true }])
    expect(answer(yes, OK).state.draft).toBeNull()
  })

  it('send while a proposal waits asks for yes or no first', () => {
    const proposed = run(draft(), say('ma tulen')).state
    const { state, effects } = run(proposed, say('saada'))
    expect(effects).toEqual([])
    expect(state.mode).toBe('confirming')
    expect(state.understood).toBe('Ütle enne jah või ei.')
  })

  it('an empty draft is not sent', () => {
    expect(run(draft(), say('saada')).state.understood).toBe('Sõnum on veel tühi.')
  })

  it('a second start while a draft is open says so', () => {
    const s = run(draft(), say('uus sõnum Jaanile')).state
    expect(s.draft?.to).toBe('Mari')
    expect(s.understood).toBe('Üks sõnum on juba pooleli. Ütle „saada“ või „katkesta sõnum“.')
  })

  it('send with no draft says there is none, without the model', () => {
    const { state, effects } = run(ET(), say('saada'))
    expect(requestOf(effects)).toBeUndefined()
    expect(state.understood).toBe('Pooleli sõnumit ei ole.')
  })

  it('sends a draft of several paragraphs as one line', () => {
    const two = converse(written(), 'lisa, et ma toon kooki', {
      kind: 'propose_edit',
      summary: 'Lisan lause.',
      ops: [{ op: 'insert_block', afterBlockId: 'b1', blockType: 'p', text: 'Ma toon kooki.' }],
    })
    const yes = run(two, say('jah'), say('saada'), say('jah'))
    const opened = answer(yes, OK)
    expect(browserOf(opened.effects)).toEqual([{ kind: 'insertText', text: `${TEXT} Ma toon kooki.`, submit: true }])
  })
})

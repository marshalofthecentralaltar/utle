import { describe, expect, it } from 'vitest'
import { IntentSchema, InterpretRequestSchema, OpSchema } from './intent.ts'
import type { Intent, InterpretRequest } from './intent.ts'
import { SAMPLE_DOC } from './document.ts'

describe('IntentSchema', () => {
  const valid: Intent[] = [
    {
      kind: 'propose_edit',
      summary: 'Thursday becomes Friday.',
      ops: [{ op: 'replace_text', blockId: 'b6', find: 'Thursday', replace: 'Friday' }],
    },
    {
      kind: 'ask_which',
      question: 'Which sentence?',
      candidates: [
        { blockId: 'b4', quote: 'one' },
        { blockId: 'b4', quote: 'two' },
      ],
    },
    { kind: 'navigate', blockId: 'b3', readAloud: true },
    { kind: 'not_understood', message: 'Say that again.' },
  ]

  it.each(valid)('accepts $kind', (intent) => {
    expect(IntentSchema.parse(intent)).toEqual(intent)
  })

  it('rejects an unknown kind', () => {
    expect(IntentSchema.safeParse({ kind: 'rewrite_everything' }).success).toBe(false)
  })

  it('rejects an op with a missing field', () => {
    expect(OpSchema.safeParse({ op: 'replace_text', blockId: 'b6', find: 'x' }).success).toBe(false)
  })

  it('rejects an unknown op and an unknown block type', () => {
    expect(OpSchema.safeParse({ op: 'format_bold', blockId: 'b6' }).success).toBe(false)
    expect(
      OpSchema.safeParse({ op: 'insert_block', afterBlockId: null, blockType: 'table', text: 'x' }).success,
    ).toBe(false)
  })

  it('accepts null targets for insert and move', () => {
    expect(OpSchema.safeParse({ op: 'insert_block', afterBlockId: null, blockType: 'p', text: 'x' }).success).toBe(true)
    expect(OpSchema.safeParse({ op: 'move_blocks', blockIds: ['b9'], beforeBlockId: null }).success).toBe(true)
  })

  it('strips fields it does not know', () => {
    const parsed = IntentSchema.parse({ kind: 'not_understood', message: 'x', extra: 1 })
    expect(parsed).toEqual({ kind: 'not_understood', message: 'x' })
  })
})

describe('InterpretRequestSchema', () => {
  it('accepts a request with no context', () => {
    const request: InterpretRequest = { doc: SAMPLE_DOC, utterance: 'hello', pending: null, choice: null }
    expect(InterpretRequestSchema.parse(request)).toEqual(request)
  })

  it('accepts a request with a pending proposal and a picked candidate', () => {
    const request: InterpretRequest = {
      doc: SAMPLE_DOC,
      utterance: 'two',
      pending: { summary: 's', ops: [{ op: 'delete_block', blockId: 'b2' }] },
      choice: { utterance: 'shorten it', candidates: [{ blockId: 'b4', quote: 'q' }], picked: 0 },
    }
    expect(InterpretRequestSchema.parse(request)).toEqual(request)
  })

  it('rejects a request without an utterance or with a malformed document', () => {
    expect(InterpretRequestSchema.safeParse({ doc: SAMPLE_DOC, pending: null, choice: null }).success).toBe(false)
    expect(
      InterpretRequestSchema.safeParse({ doc: [{ id: 1 }], utterance: 'x', pending: null, choice: null }).success,
    ).toBe(false)
  })
})

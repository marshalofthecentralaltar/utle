import { describe, expect, it } from 'vitest'
import { SAMPLE_DOC, newBlockId, numberOf } from './document.ts'
import type { Doc } from './document.ts'
import { applyOps } from './ops.ts'
import type { Op, OpErrorCode } from './ops.ts'
import { clone, deepFreeze } from './testUtil.ts'

const SUMMARY = 'b4'
const BUDGET = 'b6'
const NEXT_HEAD = 'b7'
const NEXT_ITEM = 'b8'
const RISK_HEAD = 'b9'
const RISK_TEXT = 'b10'

function apply(ops: Op[], doc: Doc = SAMPLE_DOC): Doc {
  const result = applyOps(doc, ops)
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.doc
}

function failure(ops: Op[], doc: Doc = SAMPLE_DOC): { code: OpErrorCode; opIndex: number } {
  const result = applyOps(doc, ops)
  if (result.ok) throw new Error('expected a failure, got ok')
  return { code: result.error.code, opIndex: result.error.opIndex }
}

function textOf(doc: Doc, id: string): string {
  const block = doc.find((b) => b.id === id)
  if (!block) throw new Error(`no block ${id}`)
  return block.text
}

function ids(doc: Doc): string[] {
  return doc.map((b) => b.id)
}

describe('document helpers', () => {
  it('numberOf is the 1-based position and 0 when absent', () => {
    expect(numberOf(SAMPLE_DOC, 'b1')).toBe(1)
    expect(numberOf(SAMPLE_DOC, BUDGET)).toBe(6)
    expect(numberOf(SAMPLE_DOC, 'nope')).toBe(0)
  })

  it('newBlockId is not already used', () => {
    const id = newBlockId(SAMPLE_DOC)
    expect(ids(SAMPLE_DOC)).not.toContain(id)
    expect(id).toBe('b11')
  })

  it('the sample document has unique ids', () => {
    expect(new Set(ids(SAMPLE_DOC)).size).toBe(SAMPLE_DOC.length)
  })
})

describe('replace_text', () => {
  it('swaps a unique substring', () => {
    const doc = apply([{ op: 'replace_text', blockId: BUDGET, find: 'Thursday', replace: 'Friday' }])
    expect(textOf(doc, BUDGET)).toBe(
      'Spending is within plan. The revised budget must be sent to finance by Friday.',
    )
  })

  it('rejects a find that is not in the block', () => {
    expect(failure([{ op: 'replace_text', blockId: BUDGET, find: 'Monday', replace: 'Friday' }])).toEqual({
      code: 'find_not_found',
      opIndex: 0,
    })
  })

  it('rejects a find that occurs more than once', () => {
    expect(
      failure([{ op: 'replace_text', blockId: SUMMARY, find: 'supplier', replace: 'vendor' }]).code,
    ).toBe('find_ambiguous')
  })

  it('rejects an empty find', () => {
    expect(failure([{ op: 'replace_text', blockId: BUDGET, find: '', replace: 'x' }]).code).toBe(
      'find_not_found',
    )
  })

  it('rejects find equal to replace', () => {
    expect(
      failure([{ op: 'replace_text', blockId: BUDGET, find: 'Thursday', replace: 'Thursday' }]).code,
    ).toBe('no_change')
  })
})

describe('set_text', () => {
  it('replaces the block text', () => {
    const doc = apply([{ op: 'set_text', blockId: RISK_TEXT, text: 'No open risks.' }])
    expect(textOf(doc, RISK_TEXT)).toBe('No open risks.')
  })

  it('rejects blank text', () => {
    expect(failure([{ op: 'set_text', blockId: RISK_TEXT, text: '   ' }]).code).toBe('empty_text')
  })

  it('rejects identical text', () => {
    expect(
      failure([{ op: 'set_text', blockId: RISK_TEXT, text: textOf(SAMPLE_DOC, RISK_TEXT) }]).code,
    ).toBe('no_change')
  })
})

describe('insert_block', () => {
  it('inserts directly after the named block with a fresh id', () => {
    const doc = apply([
      { op: 'insert_block', afterBlockId: NEXT_ITEM, blockType: 'li', text: 'Marten sends the contract.' },
    ])
    const at = ids(doc).indexOf(NEXT_ITEM)
    expect(doc[at + 1]).toEqual({ id: 'b11', type: 'li', text: 'Marten sends the contract.' })
    expect(doc).toHaveLength(SAMPLE_DOC.length + 1)
  })

  it('inserts at the start when afterBlockId is null', () => {
    const doc = apply([{ op: 'insert_block', afterBlockId: null, blockType: 'p', text: 'Draft.' }])
    expect(doc[0]?.text).toBe('Draft.')
  })

  it('rejects blank text', () => {
    expect(
      failure([{ op: 'insert_block', afterBlockId: NEXT_ITEM, blockType: 'li', text: '' }]).code,
    ).toBe('empty_text')
  })

  it('gives two inserted blocks different ids', () => {
    const doc = apply([
      { op: 'insert_block', afterBlockId: NEXT_ITEM, blockType: 'li', text: 'One.' },
      { op: 'insert_block', afterBlockId: NEXT_ITEM, blockType: 'li', text: 'Two.' },
    ])
    expect(new Set(ids(doc)).size).toBe(doc.length)
  })
})

describe('delete_block', () => {
  it('removes the block', () => {
    const doc = apply([{ op: 'delete_block', blockId: RISK_TEXT }])
    expect(ids(doc)).not.toContain(RISK_TEXT)
    expect(doc).toHaveLength(SAMPLE_DOC.length - 1)
  })
})

describe('move_blocks', () => {
  it('moves a section before another block', () => {
    const doc = apply([{ op: 'move_blocks', blockIds: [RISK_HEAD, RISK_TEXT], beforeBlockId: NEXT_HEAD }])
    expect(ids(doc)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b9', 'b10', 'b7', 'b8'])
  })

  it('moves to the end when beforeBlockId is null, in the given order', () => {
    const doc = apply([{ op: 'move_blocks', blockIds: ['b5', 'b6'], beforeBlockId: null }])
    expect(ids(doc).slice(-2)).toEqual(['b5', 'b6'])
    expect(doc).toHaveLength(SAMPLE_DOC.length)
  })

  it('rejects a target inside the moved set', () => {
    expect(
      failure([{ op: 'move_blocks', blockIds: [RISK_HEAD, RISK_TEXT], beforeBlockId: RISK_TEXT }]).code,
    ).toBe('bad_move')
  })

  it('rejects an empty list', () => {
    expect(failure([{ op: 'move_blocks', blockIds: [], beforeBlockId: NEXT_HEAD }]).code).toBe('bad_move')
  })

  it('rejects a repeated id', () => {
    expect(
      failure([{ op: 'move_blocks', blockIds: [RISK_HEAD, RISK_HEAD], beforeBlockId: NEXT_HEAD }]).code,
    ).toBe('bad_move')
  })
})

describe('unknown ids', () => {
  const cases: Array<[string, Op]> = [
    ['replace_text', { op: 'replace_text', blockId: 'zz', find: 'a', replace: 'b' }],
    ['set_text', { op: 'set_text', blockId: 'zz', text: 'x' }],
    ['insert_block', { op: 'insert_block', afterBlockId: 'zz', blockType: 'p', text: 'x' }],
    ['delete_block', { op: 'delete_block', blockId: 'zz' }],
    ['move_blocks ids', { op: 'move_blocks', blockIds: ['zz'], beforeBlockId: null }],
    ['move_blocks target', { op: 'move_blocks', blockIds: ['b9'], beforeBlockId: 'zz' }],
  ]
  it.each(cases)('%s rejects an unknown block', (_name, op) => {
    expect(failure([op])).toEqual({ code: 'unknown_block', opIndex: 0 })
  })
})

describe('op lists', () => {
  it('rejects an empty list', () => {
    expect(failure([])).toEqual({ code: 'no_ops', opIndex: 0 })
  })

  it('applies ops in sequence, each seeing the previous result', () => {
    const doc = apply([
      { op: 'replace_text', blockId: BUDGET, find: 'Thursday', replace: 'Friday' },
      { op: 'replace_text', blockId: BUDGET, find: 'Friday', replace: 'Monday' },
    ])
    expect(textOf(doc, BUDGET)).toContain('by Monday.')
  })

  it('aborts on the first failing op and reports its index', () => {
    expect(
      failure([
        { op: 'replace_text', blockId: BUDGET, find: 'Thursday', replace: 'Friday' },
        { op: 'delete_block', blockId: 'zz' },
      ]),
    ).toEqual({ code: 'unknown_block', opIndex: 1 })
  })

  it('never mutates the document or the ops it is given', () => {
    const doc = deepFreeze(clone(SAMPLE_DOC))
    const before = clone(doc)
    const everyKind: Op[] = deepFreeze([
      { op: 'replace_text', blockId: BUDGET, find: 'Thursday', replace: 'Friday' },
      { op: 'set_text', blockId: RISK_TEXT, text: 'No open risks.' },
      { op: 'insert_block', afterBlockId: NEXT_ITEM, blockType: 'li', text: 'New item.' },
      { op: 'move_blocks', blockIds: [RISK_HEAD, RISK_TEXT], beforeBlockId: NEXT_HEAD },
      { op: 'delete_block', blockId: 'b2' },
    ])
    const result = applyOps(doc, everyKind)
    expect(result.ok).toBe(true)
    expect(doc).toEqual(before)
  })
})

import { describe, expect, it } from 'vitest'
import { SAMPLE_DOC } from './document.ts'
import type { Op } from './ops.ts'
import { buildPreview, diffSegments } from './preview.ts'
import type { PreviewRow, Segment } from './preview.ts'
import { clone, deepFreeze } from './testUtil.ts'

function join(segments: Segment[], kinds: Array<Segment['kind']>): string {
  return segments
    .filter((s) => kinds.includes(s.kind))
    .map((s) => s.text)
    .join('')
}

function shape(rows: PreviewRow[]): string[] {
  return rows.map((row) => `${row.status}:${row.block.id}`)
}

describe('diffSegments', () => {
  it('isolates a single changed word and keeps punctuation around it', () => {
    expect(diffSegments('sent to finance by Thursday.', 'sent to finance by Friday.')).toEqual([
      { kind: 'same', text: 'sent to finance by ' },
      { kind: 'del', text: 'Thursday' },
      { kind: 'ins', text: 'Friday' },
      { kind: 'same', text: '.' },
    ])
  })

  it('rebuilds both texts from its segments', () => {
    const before = 'The supplier reported two invoice errors in the first week, which were corrected the same day.'
    const after = 'Two invoice errors in the first week were fixed the same day.'
    const segments = diffSegments(before, after)
    expect(join(segments, ['same', 'del'])).toBe(before)
    expect(join(segments, ['same', 'ins'])).toBe(after)
  })

  it('gives one del and one ins at most, so the change reads as one span', () => {
    const segments = diffSegments('alpha beta gamma delta', 'alpha BETA gamma DELTA')
    expect(segments.filter((s) => s.kind === 'del')).toHaveLength(1)
    expect(segments.filter((s) => s.kind === 'ins')).toHaveLength(1)
  })

  it('handles pure insertion and pure deletion', () => {
    expect(diffSegments('one two', 'one two three')).toEqual([
      { kind: 'same', text: 'one two' },
      { kind: 'ins', text: ' three' },
    ])
    expect(diffSegments('one two three', 'one three')).toEqual([
      { kind: 'same', text: 'one ' },
      { kind: 'del', text: 'two ' },
      { kind: 'same', text: 'three' },
    ])
  })

  it('never emits an empty segment', () => {
    for (const s of diffSegments('same text', 'same text')) expect(s.text).not.toBe('')
    for (const s of diffSegments('a', 'b')) expect(s.text).not.toBe('')
  })
})

describe('buildPreview', () => {
  it('shows a text change as one changed row and leaves the others the same', () => {
    const rows = buildPreview(SAMPLE_DOC, [
      { op: 'replace_text', blockId: 'b6', find: 'Thursday', replace: 'Friday' },
    ])
    expect(rows).toHaveLength(SAMPLE_DOC.length)
    const changed = rows.filter((r) => r.status === 'changed')
    expect(changed).toHaveLength(1)
    const row = changed[0]
    if (row?.status !== 'changed') throw new Error('expected a changed row')
    expect(row.block.id).toBe('b6')
    expect(join(row.segments, ['del'])).toBe('Thursday')
    expect(join(row.segments, ['ins'])).toBe('Friday')
    expect(rows.filter((r) => r.status === 'same')).toHaveLength(SAMPLE_DOC.length - 1)
  })

  it('puts an inserted block after its anchor', () => {
    const rows = buildPreview(SAMPLE_DOC, [
      { op: 'insert_block', afterBlockId: 'b8', blockType: 'li', text: 'New item.' },
    ])
    const at = shape(rows).indexOf('same:b8')
    expect(shape(rows)[at + 1]).toBe('added:b11')
  })

  it('puts a block inserted at the start first', () => {
    const rows = buildPreview(SAMPLE_DOC, [
      { op: 'insert_block', afterBlockId: null, blockType: 'p', text: 'Draft.' },
    ])
    expect(shape(rows)[0]).toBe('added:b11')
  })

  it('shows a deleted block as removed, in place', () => {
    const rows = buildPreview(SAMPLE_DOC, [{ op: 'delete_block', blockId: 'b2' }])
    expect(shape(rows)[1]).toBe('removed:b2')
    expect(rows).toHaveLength(SAMPLE_DOC.length)
  })

  it('shows a move as removed at the old place and added at the new place', () => {
    const rows = buildPreview(SAMPLE_DOC, [
      { op: 'move_blocks', blockIds: ['b9', 'b10'], beforeBlockId: 'b7' },
    ])
    expect(shape(rows)).toEqual([
      'same:b1',
      'same:b2',
      'same:b3',
      'same:b4',
      'same:b5',
      'same:b6',
      'added:b9',
      'added:b10',
      'same:b7',
      'same:b8',
      'removed:b9',
      'removed:b10',
    ])
  })

  it('numbers rows by the current document', () => {
    const rows = buildPreview(SAMPLE_DOC, [
      { op: 'move_blocks', blockIds: ['b9', 'b10'], beforeBlockId: 'b7' },
    ])
    for (const row of rows) {
      if (row.status === 'added') continue
      expect(row.number).toBe(SAMPLE_DOC.findIndex((b) => b.id === row.block.id) + 1)
    }
  })

  it('gives all-same rows when the ops do not apply', () => {
    const rows = buildPreview(SAMPLE_DOC, [{ op: 'delete_block', blockId: 'zz' }])
    expect(rows.every((r) => r.status === 'same')).toBe(true)
    expect(rows).toHaveLength(SAMPLE_DOC.length)
  })

  it('gives all-same rows for an empty op list', () => {
    expect(buildPreview(SAMPLE_DOC, []).every((r) => r.status === 'same')).toBe(true)
  })

  it('never mutates the document', () => {
    const doc = deepFreeze(clone(SAMPLE_DOC))
    const before = clone(doc)
    const ops: Op[] = deepFreeze([
      { op: 'replace_text', blockId: 'b6', find: 'Thursday', replace: 'Friday' },
      { op: 'move_blocks', blockIds: ['b9', 'b10'], beforeBlockId: 'b7' },
      { op: 'insert_block', afterBlockId: 'b8', blockType: 'li', text: 'New item.' },
    ])
    buildPreview(doc, ops)
    expect(doc).toEqual(before)
  })
})

import { newBlockId } from './document.ts'
import type { BlockType, Doc } from './document.ts'

export type Op =
  | { op: 'replace_text'; blockId: string; find: string; replace: string }
  | { op: 'set_text'; blockId: string; text: string }
  /** afterBlockId null inserts at the start of the document. */
  | { op: 'insert_block'; afterBlockId: string | null; blockType: BlockType; text: string }
  | { op: 'delete_block'; blockId: string }
  /** beforeBlockId null moves the blocks to the end of the document. */
  | { op: 'move_blocks'; blockIds: string[]; beforeBlockId: string | null }

export type OpErrorCode =
  | 'no_ops'
  | 'unknown_block'
  | 'find_not_found'
  | 'find_ambiguous'
  | 'empty_text'
  | 'no_change'
  | 'bad_move'

export interface OpError {
  code: OpErrorCode
  opIndex: number
  message: string
}

export type ApplyResult = { ok: true; doc: Doc } | { ok: false; error: OpError }

type OneResult = { ok: true; doc: Doc } | { ok: false; code: OpErrorCode; message: string }

function fail(code: OpErrorCode, message: string): OneResult {
  return { ok: false, code, message }
}

function countOccurrences(text: string, find: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const at = text.indexOf(find, from)
    if (at === -1) return count
    count += 1
    from = at + find.length
  }
}

function applyOne(doc: Doc, op: Op): OneResult {
  const indexOf = (id: string): number => doc.findIndex((block) => block.id === id)

  switch (op.op) {
    case 'replace_text': {
      const at = indexOf(op.blockId)
      const block = doc[at]
      if (!block) return fail('unknown_block', `No block has id ${op.blockId}.`)
      if (op.find === '') return fail('find_not_found', 'find is empty.')
      const occurrences = countOccurrences(block.text, op.find)
      if (occurrences === 0) {
        return fail('find_not_found', `"${op.find}" does not occur in block ${op.blockId}.`)
      }
      if (occurrences > 1) {
        return fail(
          'find_ambiguous',
          `"${op.find}" occurs ${occurrences} times in block ${op.blockId}. Use a longer, unique quote.`,
        )
      }
      if (op.find === op.replace) return fail('no_change', 'find and replace are identical.')
      const text = block.text.replace(op.find, () => op.replace)
      if (text.trim() === '') return fail('empty_text', 'The block would become empty. Use delete_block.')
      return { ok: true, doc: doc.map((b, i) => (i === at ? { ...b, text } : b)) }
    }

    case 'set_text': {
      const at = indexOf(op.blockId)
      const block = doc[at]
      if (!block) return fail('unknown_block', `No block has id ${op.blockId}.`)
      if (op.text.trim() === '') return fail('empty_text', 'text is empty. Use delete_block.')
      if (op.text === block.text) return fail('no_change', 'text is identical to the current text.')
      return { ok: true, doc: doc.map((b, i) => (i === at ? { ...b, text: op.text } : b)) }
    }

    case 'insert_block': {
      if (op.text.trim() === '') return fail('empty_text', 'text is empty.')
      let at = 0
      if (op.afterBlockId !== null) {
        const after = indexOf(op.afterBlockId)
        if (after === -1) return fail('unknown_block', `No block has id ${op.afterBlockId}.`)
        at = after + 1
      }
      const block = { id: newBlockId(doc), type: op.blockType, text: op.text }
      return { ok: true, doc: [...doc.slice(0, at), block, ...doc.slice(at)] }
    }

    case 'delete_block': {
      if (indexOf(op.blockId) === -1) return fail('unknown_block', `No block has id ${op.blockId}.`)
      return { ok: true, doc: doc.filter((b) => b.id !== op.blockId) }
    }

    case 'move_blocks': {
      if (op.blockIds.length === 0) return fail('bad_move', 'blockIds is empty.')
      if (new Set(op.blockIds).size !== op.blockIds.length) {
        return fail('bad_move', 'blockIds repeats an id.')
      }
      for (const id of op.blockIds) {
        if (indexOf(id) === -1) return fail('unknown_block', `No block has id ${id}.`)
      }
      if (op.beforeBlockId !== null) {
        if (indexOf(op.beforeBlockId) === -1) {
          return fail('unknown_block', `No block has id ${op.beforeBlockId}.`)
        }
        if (op.blockIds.includes(op.beforeBlockId)) {
          return fail('bad_move', 'beforeBlockId is one of the blocks being moved.')
        }
      }
      const moving = op.blockIds.flatMap((id) => doc.filter((b) => b.id === id))
      const rest = doc.filter((b) => !op.blockIds.includes(b.id))
      const at = op.beforeBlockId === null ? rest.length : rest.findIndex((b) => b.id === op.beforeBlockId)
      const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
      if (next.every((b, i) => b.id === doc[i]?.id)) {
        return fail('no_change', 'The blocks are already in that position.')
      }
      return { ok: true, doc: next }
    }
  }
}

/**
 * Applies ops in order, each against the result of the previous one.
 * Pure: never throws, never mutates its arguments. The first failure aborts the whole list.
 */
export function applyOps(doc: Doc, ops: readonly Op[]): ApplyResult {
  if (ops.length === 0) {
    return { ok: false, error: { code: 'no_ops', opIndex: 0, message: 'The op list is empty.' } }
  }
  let current = doc
  for (const [opIndex, op] of ops.entries()) {
    const result = applyOne(current, op)
    if (!result.ok) {
      return { ok: false, error: { code: result.code, opIndex, message: result.message } }
    }
    current = result.doc
  }
  return { ok: true, doc: current }
}

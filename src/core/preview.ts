import type { Block, Doc } from './document.ts'
import { applyOps } from './ops.ts'
import type { Op } from './ops.ts'

export type Segment = { kind: 'same' | 'del' | 'ins'; text: string }

export type PreviewRow =
  | { status: 'same'; block: Block; number: number }
  | { status: 'changed'; block: Block; number: number; segments: Segment[] }
  /** Deleted, or the old place of a moved block. */
  | { status: 'removed'; block: Block; number: number }
  /** Inserted, or the new place of a moved block. Has no number until the edit is accepted. */
  | { status: 'added'; block: Block }

/** Words and single non-word characters, so punctuation next to a changed word stays put. */
function tokens(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}]/gu) ?? []
}

/**
 * One contiguous change: the shared start, what goes, what comes, the shared end.
 * A single span reads better as a spoken-edit confirmation than an interleaved word diff.
 */
export function diffSegments(before: string, after: string): Segment[] {
  const a = tokens(before)
  const b = tokens(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let end = 0
  const maxEnd = Math.min(a.length, b.length) - start
  while (end < maxEnd && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1

  const segments: Segment[] = [
    { kind: 'same', text: a.slice(0, start).join('') },
    { kind: 'del', text: a.slice(start, a.length - end).join('') },
    { kind: 'ins', text: b.slice(start, b.length - end).join('') },
    { kind: 'same', text: a.slice(a.length - end).join('') },
  ]
  return segments.filter((segment) => segment.text !== '')
}

/**
 * Rows for rendering a proposal over the current document. The document is not changed.
 * Ops that do not apply give rows that are all 'same'.
 */
export function buildPreview(doc: Doc, ops: readonly Op[]): PreviewRow[] {
  const same = (): PreviewRow[] =>
    doc.map((block, index) => ({ status: 'same', block, number: index + 1 }))

  const result = applyOps(doc, ops)
  if (!result.ok) return same()
  const after = result.doc

  const beforeIds = new Set(doc.map((b) => b.id))
  const afterById = new Map(after.map((b) => [b.id, b]))
  const moved = new Set(
    ops.flatMap((op) => (op.op === 'move_blocks' ? op.blockIds : [])).filter((id) => afterById.has(id)),
  )
  const isStable = (id: string): boolean => beforeIds.has(id) && afterById.has(id) && !moved.has(id)

  // Added rows hang off the nearest preceding block that stays where it is.
  const leading: PreviewRow[] = []
  const addedAfter = new Map<string, PreviewRow[]>()
  let anchor: string | null = null
  for (const block of after) {
    if (isStable(block.id)) {
      anchor = block.id
      continue
    }
    const row: PreviewRow = { status: 'added', block }
    if (anchor === null) {
      leading.push(row)
    } else {
      addedAfter.set(anchor, [...(addedAfter.get(anchor) ?? []), row])
    }
  }

  const rows: PreviewRow[] = [...leading]
  doc.forEach((block, index) => {
    const number = index + 1
    const next = afterById.get(block.id)
    if (!next || moved.has(block.id)) {
      rows.push({ status: 'removed', block, number })
      return
    }
    if (next.text === block.text) {
      rows.push({ status: 'same', block, number })
    } else {
      rows.push({ status: 'changed', block: next, number, segments: diffSegments(block.text, next.text) })
    }
    rows.push(...(addedAfter.get(block.id) ?? []))
  })
  return rows
}

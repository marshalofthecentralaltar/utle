import type { Doc } from '../src/core/document.ts'
import type { Intent, InterpretRequest } from '../src/core/intent.ts'
import { problemWith } from './interpret.ts'

/**
 * Rehearsal mode: scripted answers for the demo lines, no model and no network.
 * It exists so the interface can be exercised and the pitch rehearsed without an API key,
 * and as a fallback if the venue network fails. It only knows the demo script on the sample
 * document, and the interface says so while it is on. Run with `npm run rehearse`.
 */

const LONG = 'The supplier reported two invoice errors in the first week, which were corrected the same day.'
const SHORT = 'Two invoice errors in the first week were fixed the same day.'
const UNKNOWN: Intent = { kind: 'not_understood', message: 'Rehearsal mode only knows the demo script.' }
const UNKNOWN_ET: Intent = { kind: 'not_understood', message: 'Proovirežiim tunneb ainult demo stsenaariumi.' }

/** The Estonian demo: the deadline edit, and the one repair of the message to Mari. */
function answerEstonian(request: InterpretRequest): Intent | null {
  const said = request.utterance.toLowerCase()
  const pendingInsert = request.pending?.ops[0]
  if (pendingInsert?.op === 'insert_block' && said.includes('neli') && pendingInsert.text.includes('kolm')) {
    return {
      kind: 'propose_edit',
      summary: 'Kolme asemel neli.',
      ops: [{ ...pendingInsert, text: pendingInsert.text.replace('kolm', 'neli') }],
    }
  }
  if (said.includes('reede')) {
    const block = request.doc.find((b) => b.text.includes('neljapäevaks'))
    if (!block) return null
    return {
      kind: 'propose_edit',
      summary: 'Eelarve: neljapäeva asemel reede.',
      ops: [{ op: 'replace_text', blockId: block.id, find: 'neljapäevaks', replace: 'reedeks' }],
    }
  }
  return null
}

function heading(doc: Doc, text: string): number {
  return doc.findIndex((b) => (b.type === 'h1' || b.type === 'h2') && b.text.toLowerCase() === text)
}

/** Ids of a heading and the blocks under it, up to the next heading. */
function section(doc: Doc, start: number): string[] {
  const ids: string[] = []
  for (let i = start; i < doc.length; i += 1) {
    const block = doc[i]
    if (!block || (i > start && (block.type === 'h1' || block.type === 'h2'))) break
    ids.push(block.id)
  }
  return ids
}

function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [text]
}

function answer(request: InterpretRequest): Intent {
  if (request.lang === 'et') return answerEstonian(request) ?? UNKNOWN_ET
  const { doc } = request
  const said = request.utterance.toLowerCase()

  if (request.choice?.picked != null) {
    const picked = request.choice.candidates[request.choice.picked]
    if (picked?.quote === LONG) {
      return {
        kind: 'propose_edit',
        summary: 'Summary, second sentence: 16 words become 12.',
        ops: [{ op: 'replace_text', blockId: picked.blockId, find: LONG, replace: SHORT }],
      }
    }
    return { kind: 'not_understood', message: 'Rehearsal mode only shortens the second sentence.' }
  }

  const next = heading(doc, 'next steps')
  if (said.includes('move') && said.includes('risk')) {
    const risks = heading(doc, 'risks')
    const target = doc[next]
    if (risks < 0 || !target) return UNKNOWN
    return {
      kind: 'propose_edit',
      summary: 'Risks moves above Next steps.',
      ops: [{ op: 'move_blocks', blockIds: section(doc, risks), beforeBlockId: target.id }],
    }
  }

  if (said.includes('tuesday') && (request.pending || said.includes('add')) && next >= 0) {
    const after = section(doc, next).at(-1) ?? null
    return {
      kind: 'propose_edit',
      summary: 'New item under Next steps, by Tuesday.',
      ops: [{ op: 'insert_block', afterBlockId: after, blockType: 'li', text: 'Marten sends the contract by Tuesday.' }],
    }
  }
  if (said.includes('add') && said.includes('next step') && next >= 0) {
    const after = section(doc, next).at(-1) ?? null
    return {
      kind: 'propose_edit',
      summary: 'New item under Next steps. Heard Martin, used Marten from the attendee list.',
      ops: [{ op: 'insert_block', afterBlockId: after, blockType: 'li', text: 'Marten sends the contract by Wednesday.' }],
    }
  }

  if (said.includes('friday')) {
    const block = doc.find((b) => b.text.includes('by Thursday'))
    if (!block) return UNKNOWN
    return {
      kind: 'propose_edit',
      summary: 'Budget: Thursday becomes Friday.',
      ops: [{ op: 'replace_text', blockId: block.id, find: 'Thursday', replace: 'Friday' }],
    }
  }

  if (said.includes('shorten') && said.includes('supplier')) {
    const candidates = doc
      .filter((b) => b.type === 'p')
      .flatMap((b) => sentences(b.text).filter((s) => s.toLowerCase().includes('supplier')).map((quote) => ({ blockId: b.id, quote })))
    return { kind: 'ask_which', question: `${candidates.length} sentences mention the supplier.`, candidates }
  }

  if (said.includes('kokkuvõt') || said.includes('summary')) {
    const block = doc[heading(doc, 'summary')]
    if (!block) return UNKNOWN
    return { kind: 'navigate', blockId: block.id, readAloud: said.includes('loe') || said.includes('read') }
  }

  return UNKNOWN
}

/** A scripted intent that is checked against the document exactly like a model's answer. */
export function rehearse(request: InterpretRequest): Intent {
  const intent = answer(request)
  return problemWith(request.doc, intent) === null ? intent : request.lang === 'et' ? UNKNOWN_ET : UNKNOWN
}

import * as z from 'zod'
import type { Candidate } from './candidates.ts'
import type { Doc } from './document.ts'
import type { Op } from './ops.ts'

export type { Candidate } from './candidates.ts'

/** What the interpreter decided an utterance means. Exactly one per utterance. */
export type Intent =
  | { kind: 'propose_edit'; summary: string; ops: Op[] }
  | { kind: 'ask_which'; question: string; candidates: Candidate[] }
  | { kind: 'navigate'; blockId: string; readAloud: boolean }
  | { kind: 'not_understood'; message: string }

/** A proposal waiting for yes or no. */
export interface Pending {
  summary: string
  ops: Op[]
}

/** The "which one" question an utterance is answering. picked is 0-based, null when the answer was not a number. */
export interface ChoiceContext {
  utterance: string
  candidates: Candidate[]
  picked: number | null
}

export interface InterpretRequest {
  doc: Doc
  utterance: string
  /** Set when the utterance repairs a proposal. */
  pending: Pending | null
  /** Set when the utterance answers a "which one" question. */
  choice: ChoiceContext | null
}

const BlockTypeSchema = z.enum(['h1', 'h2', 'p', 'li'])

const BlockSchema = z.object({ id: z.string(), type: BlockTypeSchema, text: z.string() })

export const OpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('replace_text'), blockId: z.string(), find: z.string(), replace: z.string() }),
  z.object({ op: z.literal('set_text'), blockId: z.string(), text: z.string() }),
  z.object({
    op: z.literal('insert_block'),
    afterBlockId: z.string().nullable(),
    blockType: BlockTypeSchema,
    text: z.string(),
  }),
  z.object({ op: z.literal('delete_block'), blockId: z.string() }),
  z.object({ op: z.literal('move_blocks'), blockIds: z.array(z.string()), beforeBlockId: z.string().nullable() }),
]) satisfies z.ZodType<Op>

const CandidateSchema = z.object({ blockId: z.string(), quote: z.string() })

export const IntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('propose_edit'), summary: z.string(), ops: z.array(OpSchema) }),
  z.object({ kind: z.literal('ask_which'), question: z.string(), candidates: z.array(CandidateSchema) }),
  z.object({ kind: z.literal('navigate'), blockId: z.string(), readAloud: z.boolean() }),
  z.object({ kind: z.literal('not_understood'), message: z.string() }),
]) satisfies z.ZodType<Intent>

export const InterpretRequestSchema = z.object({
  doc: z.array(BlockSchema),
  utterance: z.string(),
  pending: z.object({ summary: z.string(), ops: z.array(OpSchema) }).nullable(),
  choice: z
    .object({
      utterance: z.string(),
      candidates: z.array(CandidateSchema),
      picked: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
}) satisfies z.ZodType<InterpretRequest>

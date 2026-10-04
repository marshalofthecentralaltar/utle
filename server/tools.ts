import type Anthropic from '@anthropic-ai/sdk'
import { IntentSchema } from '../src/core/intent.ts'
import type { Intent } from '../src/core/intent.ts'

const STRING = { type: 'string' } as const
const NULLABLE_ID = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const

function object(properties: Record<string, unknown>): Anthropic.Tool.InputSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

function op(name: string, properties: Record<string, unknown>): unknown {
  return object({ op: { type: 'string', enum: [name] }, ...properties })
}

/**
 * The four things the model may answer with. Strict schemas plus a forced tool choice mean the
 * reply is exactly one well-formed call; whether it fits the document is checked in interpret.ts.
 */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'propose_edit',
    description:
      'Propose a change to the document as a list of operations. The editor previews it and applies it only after the user says yes.',
    strict: true,
    input_schema: object({
      summary: { type: 'string', description: 'One short sentence, in the language the user spoke, saying what will change.' },
      ops: {
        type: 'array',
        description: 'Operations applied in order, each against the result of the previous one.',
        items: {
          anyOf: [
            op('replace_text', {
              block_id: STRING,
              find: { type: 'string', description: 'Exact text copied from the block. Must occur exactly once in it.' },
              replace: STRING,
            }),
            op('set_text', { block_id: STRING, text: { type: 'string', description: 'The whole new text of the block.' } }),
            op('insert_block', {
              after_block_id: { ...NULLABLE_ID, description: 'The block the new one follows. null inserts at the very start.' },
              block_type: { type: 'string', enum: ['h1', 'h2', 'p', 'li'] },
              text: STRING,
            }),
            op('delete_block', { block_id: STRING }),
            op('move_blocks', {
              block_ids: { type: 'array', items: STRING, description: 'The blocks to move, in the order they should appear.' },
              before_block_id: { ...NULLABLE_ID, description: 'The block they end up in front of. null moves them to the end.' },
            }),
          ],
        },
      },
    }),
  },
  {
    name: 'ask_which',
    description:
      'Ask the user which place they mean when two or more fit the request equally well. The editor numbers the candidates and the user answers with a number.',
    strict: true,
    input_schema: object({
      question: { type: 'string', description: 'One short sentence, e.g. "Four sentences mention the supplier."' },
      candidates: {
        type: 'array',
        description: 'Two or more places, ordered by position in the document.',
        items: object({
          block_id: STRING,
          quote: { type: 'string', description: 'Exact text copied from that block: the sentence, phrase or heading meant.' },
        }),
      },
    }),
  },
  {
    name: 'navigate',
    description: 'Move to a block without changing any text. Needs no confirmation.',
    strict: true,
    input_schema: object({
      block_id: STRING,
      read_aloud: { type: 'boolean', description: 'True when the user asked to hear the text.' },
    }),
  },
  {
    name: 'not_understood',
    description:
      'The utterance is not an instruction about this document, or asks for something the other tools cannot do. Nothing changes.',
    strict: true,
    input_schema: object({
      message: { type: 'string', description: 'One short sentence, in the language the user spoke, saying what you need.' },
    }),
  },
]

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function opFromInput(value: unknown): unknown {
  const o = record(value)
  if (!o) return value
  switch (o.op) {
    case 'replace_text':
      return { op: o.op, blockId: o.block_id, find: o.find, replace: o.replace }
    case 'set_text':
      return { op: o.op, blockId: o.block_id, text: o.text }
    case 'insert_block':
      return { op: o.op, afterBlockId: o.after_block_id, blockType: o.block_type, text: o.text }
    case 'delete_block':
      return { op: o.op, blockId: o.block_id }
    case 'move_blocks':
      return { op: o.op, blockIds: o.block_ids, beforeBlockId: o.before_block_id }
    default:
      return value
  }
}

/** Maps a tool call to an Intent. Returns null when the name is unknown or the input does not match the contract. */
export function intentFromToolCall(name: string, input: unknown): Intent | null {
  const i = record(input)
  if (!i) return null
  let candidate: unknown
  switch (name) {
    case 'propose_edit':
      candidate = { kind: name, summary: i.summary, ops: Array.isArray(i.ops) ? i.ops.map(opFromInput) : i.ops }
      break
    case 'ask_which':
      candidate = {
        kind: name,
        question: i.question,
        candidates: Array.isArray(i.candidates)
          ? i.candidates.map((c) => {
              const r = record(c)
              return r ? { blockId: r.block_id, quote: r.quote } : c
            })
          : i.candidates,
      }
      break
    case 'navigate':
      candidate = { kind: name, blockId: i.block_id, readAloud: i.read_aloud }
      break
    case 'not_understood':
      candidate = { kind: name, message: i.message }
      break
    default:
      return null
  }
  const parsed = IntentSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

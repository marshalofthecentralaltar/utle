import Anthropic from '@anthropic-ai/sdk'
import type { Doc } from '../src/core/document.ts'
import { numberOf } from '../src/core/document.ts'
import { InterpretRequestSchema } from '../src/core/intent.ts'
import type { Intent } from '../src/core/intent.ts'
import { applyOps } from '../src/core/ops.ts'
import { SYSTEM_PROMPT, userMessage } from './prompt.ts'
import { TOOLS, intentFromToolCall } from './tools.ts'

/** The part of a model reply this module reads. The SDK's Message satisfies it. */
export interface ModelReply {
  stop_reason: string | null
  content: ReadonlyArray<{ type: string; id?: string; name?: string; input?: unknown }>
}

/** The part of the SDK client this module uses, so tests can pass a fake. */
export interface MessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming, options?: { timeout?: number }): Promise<ModelReply>
  }
}

export type InterpretErrorCode = 'bad_request' | 'upstream_unavailable' | 'upstream_rejected' | 'timeout'

export class InterpretError extends Error {
  readonly code: InterpretErrorCode

  constructor(code: InterpretErrorCode, message: string) {
    super(message)
    this.name = 'InterpretError'
    this.code = code
  }
}

const REQUEST_TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 2
const MAX_TOKENS = 4000

function notUnderstood(message: string): Intent {
  return { kind: 'not_understood', message }
}

/** Why an intent cannot be used on this document, or null when it can. The text goes back to the model. */
function problemWith(doc: Doc, intent: Intent): string | null {
  switch (intent.kind) {
    case 'propose_edit': {
      const result = applyOps(doc, intent.ops)
      if (result.ok) return null
      return `Operation ${result.error.opIndex} failed (${result.error.code}): ${result.error.message}`
    }
    case 'ask_which': {
      if (intent.candidates.length < 2) return 'ask_which needs at least two candidates. With one place, propose the edit.'
      for (const [i, candidate] of intent.candidates.entries()) {
        const block = doc.find((b) => b.id === candidate.blockId)
        if (!block) return `Candidate ${i + 1}: no block has id ${candidate.blockId}.`
        if (candidate.quote === '' || !block.text.includes(candidate.quote)) {
          return `Candidate ${i + 1}: the quote is not an exact substring of block ${candidate.blockId}.`
        }
      }
      return null
    }
    case 'navigate':
      return numberOf(doc, intent.blockId) > 0 ? null : `No block has id ${intent.blockId}.`
    case 'not_understood':
      return null
  }
}

function toInterpretError(error: unknown): InterpretError {
  if (error instanceof InterpretError) return error
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new InterpretError('timeout', 'The assistant took too long.')
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new InterpretError('upstream_unavailable', 'The assistant is unreachable.')
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0
    if (status === 429 || status >= 500) {
      return new InterpretError('upstream_unavailable', 'The assistant is busy or unavailable.')
    }
    return new InterpretError('upstream_rejected', `The assistant rejected the request (${status}).`)
  }
  return new InterpretError('upstream_unavailable', 'The assistant is unreachable.')
}

/**
 * Turns one utterance into one Intent that is known to fit the document.
 * The model's output is untrusted: it is checked against the contract and the document,
 * the error goes back once, and a second failure becomes not_understood.
 * Logs the outcome only, never document text or the utterance (principle P9).
 */
export async function interpret(input: unknown, deps: { client: MessagesClient; model: string }): Promise<Intent> {
  const parsed = InterpretRequestSchema.safeParse(input)
  if (!parsed.success || parsed.data.utterance.trim() === '') {
    throw new InterpretError('bad_request', 'The request is malformed.')
  }
  const request = parsed.data
  const started = Date.now()
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage(request) }]

  const finish = (intent: Intent, attempts: number): Intent => {
    console.info(`[interpret] kind=${intent.kind} attempts=${attempts} ms=${Date.now() - started}`)
    return intent
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let reply: ModelReply
    try {
      reply = await deps.client.messages.create(
        {
          model: deps.model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          tool_choice: { type: 'any', disable_parallel_tool_use: true },
          messages,
        },
        { timeout: REQUEST_TIMEOUT_MS },
      )
    } catch (error) {
      const mapped = toInterpretError(error)
      console.info(`[interpret] error=${mapped.code} attempts=${attempt} ms=${Date.now() - started}`)
      throw mapped
    }

    if (reply.stop_reason === 'refusal' || reply.stop_reason === 'max_tokens') {
      return finish(notUnderstood('I could not work that out. Nothing changed.'), attempt)
    }
    const call = reply.content.find((block) => block.type === 'tool_use')
    if (!call?.id || !call.name) {
      return finish(notUnderstood('I could not work that out. Nothing changed.'), attempt)
    }

    const intent = intentFromToolCall(call.name, call.input)
    const problem = intent
      ? problemWith(request.doc, intent)
      : `The call to ${call.name} does not match any tool's input schema.`
    if (intent && problem === null) return finish(intent, attempt)

    messages.push(
      { role: 'assistant', content: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }] },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: call.id,
            is_error: true,
            content: `${problem} Nothing was changed. Call one tool again with a corrected input.`,
          },
        ],
      },
    )
  }

  return finish(notUnderstood('I could not turn that into a safe edit. Nothing changed.'), MAX_ATTEMPTS)
}

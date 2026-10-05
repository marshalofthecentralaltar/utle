import Anthropic from '@anthropic-ai/sdk'
import { IntentRequestSchema, pageIntentFrom } from '../src/core/pageIntent.ts'
import type { IntentAnswer, IntentRequest } from '../src/core/pageIntent.ts'
import { STRINGS } from '../src/core/strings.ts'
import { InterpretError } from './interpret.ts'
import type { MessagesClient, ModelReply } from './interpret.ts'
import { ANSWER_TOOL, INTENT_SYSTEM_PROMPT, intentUserMessage } from './intentPrompt.ts'

/**
 * M7 (docs/plans/2026-10-05-m7-understanding.md): POST /api/intent. One utterance the rules did
 * not recognise, with what is on the page, in; one IntentAnswer out. One model call, no retry: a
 * voice command must answer at once, and whatever the model gets wrong becomes `unclear`.
 * Logs the kind and the time only, never the utterance or the page (CLAUDE.md).
 */

export const INTENT_TIMEOUT_MS = 7000
const MAX_TOKENS = 400

function unclear(request: IntentRequest): IntentAnswer {
  return { intent: { kind: 'unclear', say: STRINGS[request.lang].inpage.notUnderstood }, say: '' }
}

/** The strict schema says null where the core says undefined (newTab.url). Drop every null property. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) {
      if (inner !== null) out[key] = withoutNulls(inner)
    }
    return out
  }
  return value
}

function toIntentError(error: unknown): InterpretError {
  if (error instanceof InterpretError) return error
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new InterpretError('timeout', 'The assistant took too long.')
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new InterpretError('upstream_unavailable', 'The assistant is unreachable.')
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0
    if (status === 401 || status === 403) return new InterpretError('upstream_rejected', 'no_key')
    if (status === 429 || status >= 500) {
      return new InterpretError('upstream_unavailable', 'The assistant is busy or unavailable.')
    }
    return new InterpretError('upstream_rejected', `The assistant rejected the request (${status}).`)
  }
  return new InterpretError('upstream_unavailable', 'The assistant is unreachable.')
}

/** The answer tool's input, as the model sent it. */
function answerFrom(reply: ModelReply): { intent: unknown; say: string } | null {
  if (reply.stop_reason === 'refusal' || reply.stop_reason === 'max_tokens') return null
  const call = reply.content.find((block) => block.type === 'tool_use' && block.name === ANSWER_TOOL.name)
  if (!call || typeof call.input !== 'object' || call.input === null) return null
  const input = withoutNulls(call.input) as Record<string, unknown>
  return { intent: input.intent, say: typeof input.say === 'string' ? input.say.slice(0, 120) : '' }
}

export async function pageIntent(input: unknown, deps: { client: MessagesClient; model: string }): Promise<IntentAnswer> {
  const parsed = IntentRequestSchema.safeParse(input)
  if (!parsed.success || parsed.data.utterance.trim() === '') {
    throw new InterpretError('bad_request', 'The request is malformed.')
  }
  const request = parsed.data
  const started = Date.now()

  let reply: ModelReply
  try {
    reply = await deps.client.messages.create(
      {
        model: deps.model,
        max_tokens: MAX_TOKENS,
        output_config: { effort: 'low' },
        system: INTENT_SYSTEM_PROMPT,
        tools: [ANSWER_TOOL],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: intentUserMessage(request) }],
      },
      { timeout: INTENT_TIMEOUT_MS },
    )
  } catch (error) {
    const mapped = toIntentError(error)
    console.info(`[intent] error=${mapped.code} ms=${Date.now() - started}`)
    throw mapped
  }

  const raw = answerFrom(reply)
  const intent = raw ? pageIntentFrom(raw.intent, request) : null
  const answer: IntentAnswer = intent && raw ? { intent, say: raw.say } : unclear(request)
  console.info(`[intent] kind=${answer.intent.kind} ms=${Date.now() - started}`)
  return answer
}

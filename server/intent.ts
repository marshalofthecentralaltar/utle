import Anthropic from '@anthropic-ai/sdk'
import { IntentRequestSchema, pageIntentFrom } from '../src/core/pageIntent.ts'
import type { IntentAnswer, IntentRequest } from '../src/core/pageIntent.ts'
import { STRINGS } from '../src/core/strings.ts'
import { InterpretError } from './interpret.ts'
import type { MessagesClient, ModelReply } from './interpret.ts'
import { ANSWER_TOOL, CAREFUL_PROMPT, INTENT_SYSTEM_PROMPT, intentUserMessage } from './intentPrompt.ts'

/**
 * M7 (docs/plans/2026-10-05-m7-understanding.md): POST /api/intent. One utterance the rules did
 * not recognise, with what is on the page, in; one IntentAnswer out. One model call, no retry: a
 * voice command must answer at once, and whatever the model gets wrong becomes `unclear`. M7.2: the
 * answer carries `done`; false means the engine runs the step, reads the page again and asks again
 * with `steps`. The server keeps no state between the asks.
 * Logs the kind and the time only, never the utterance or the page (CLAUDE.md).
 */

export const INTENT_TIMEOUT_MS = 7000
const MAX_TOKENS = 400
/**
 * Round 5: a careful ask (request.care, set by the engine for a long utterance or a chain) gets
 * higher effort, a longer answer budget and a longer wait; the engine waits 14 s for it, 9 s for a
 * quick one. Expected latency (not measured here; round 3 measured Sonnet at low effort, p50 about
 * 1 s): quick 1 to 3 s, careful a few seconds more with the thinking it buys.
 */
export const INTENT_TIMEOUT_CAREFUL_MS = 12_000
/**
 * Review of round 5: the model's thinking counts against max_tokens, and at effort high it may
 * spend more than a few hundred tokens before the tool call; a cut-off answer (stop_reason
 * max_tokens) is an `unclear`, so the budget is generous. The timeout still bounds the wait.
 */
const MAX_TOKENS_CAREFUL = 2000

type Care = NonNullable<IntentRequest['care']>

/** What one ask costs the model, by its care. */
export function careSettings(care: Care): { effort: 'low' | 'high'; maxTokens: number; timeoutMs: number } {
  return care === 'careful' ? { effort: 'high', maxTokens: MAX_TOKENS_CAREFUL, timeoutMs: INTENT_TIMEOUT_CAREFUL_MS } : { effort: 'low', maxTokens: MAX_TOKENS, timeoutMs: INTENT_TIMEOUT_MS }
}

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

/** Round 4: the model may plan this many goals after the one it acts on, each this long (IntentAnswerSchema). */
export const MAX_PLAN_GOALS = 12
const GOAL_CHARS = 200

/** The plan as a clean list: strings only, trimmed, no empties, at most MAX_PLAN_GOALS. */
function planFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((goal): goal is string => typeof goal === 'string')
    .map((goal) => goal.trim().slice(0, GOAL_CHARS))
    .filter((goal) => goal !== '')
    .slice(0, MAX_PLAN_GOALS)
}

/** The answer tool's input, as the model sent it. */
function answerFrom(reply: ModelReply): { intent: unknown; say: string; done: boolean; plan: string[] } | null {
  if (reply.stop_reason === 'refusal' || reply.stop_reason === 'max_tokens') return null
  const call = reply.content.find((block) => block.type === 'tool_use' && block.name === ANSWER_TOOL.name)
  if (!call || typeof call.input !== 'object' || call.input === null) return null
  const input = withoutNulls(call.input) as Record<string, unknown>
  return {
    intent: input.intent,
    say: typeof input.say === 'string' ? input.say.slice(0, 120) : '',
    // M7.2: absent means the one action completes the utterance.
    done: input.done !== false,
    // Round 4: the goals after this one, in his words.
    plan: planFrom(input.plan),
  }
}

export async function pageIntent(input: unknown, deps: { client: MessagesClient; model: string }): Promise<IntentAnswer> {
  const parsed = IntentRequestSchema.safeParse(input)
  if (!parsed.success || parsed.data.utterance.trim() === '') {
    throw new InterpretError('bad_request', 'The request is malformed.')
  }
  const request = parsed.data
  const started = Date.now()
  const care: Care = request.care ?? 'quick'
  const settings = careSettings(care)

  let reply: ModelReply
  try {
    reply = await deps.client.messages.create(
      {
        model: deps.model,
        max_tokens: settings.maxTokens,
        output_config: { effort: settings.effort },
        // The fixed prompt is marked for caching: every call shares the same prefix (tools, then system).
        // Round 5: a careful ask adds a second block after it, so the cached first block stays identical.
        system: [
          { type: 'text', text: INTENT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          ...(care === 'careful' ? [{ type: 'text' as const, text: CAREFUL_PROMPT }] : []),
        ],
        tools: [ANSWER_TOOL],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: intentUserMessage(request) }],
      },
      { timeout: settings.timeoutMs },
    )
  } catch (error) {
    const mapped = toIntentError(error)
    console.info(`[intent] error=${mapped.code} care=${care} ms=${Date.now() - started}`)
    throw mapped
  }

  const raw = answerFrom(reply)
  const intent = raw ? pageIntentFrom(raw.intent, request) : null
  const answer: IntentAnswer = intent && raw ? { intent, say: raw.say, done: raw.done, ...(raw.plan.length > 0 ? { plan: raw.plan } : {}) } : unclear(request)
  console.info(`[intent] kind=${answer.intent.kind} done=${answer.done !== false} plan=${answer.plan?.length ?? 0} care=${care} ms=${Date.now() - started}`)
  return answer
}

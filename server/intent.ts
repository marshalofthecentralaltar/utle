import { IntentRequestSchema, pageIntentFrom } from '../src/core/pageIntent.ts'
import type { IntentAnswer, IntentRequest } from '../src/core/pageIntent.ts'
import { STRINGS } from '../src/core/strings.ts'
import { InterpretError } from './interpret.ts'
import { ANSWER_TOOL, CAREFUL_PROMPT, INTENT_SYSTEM_PROMPT, intentUserMessage } from './intentPrompt.ts'
import { ModelError, modelTool } from './model/types.ts'
import type { Model, ModelAsk, ModelReplyNeutral } from './model/types.ts'

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

/** The door's failure as the route's error; a rejected key keeps the message no_key, which the extension reads. */
function toIntentError(error: unknown): InterpretError {
  if (error instanceof InterpretError) return error
  if (!(error instanceof ModelError)) return new InterpretError('upstream_unavailable', 'The assistant is unreachable.')
  switch (error.kind) {
    case 'timeout':
      return new InterpretError('timeout', error.message)
    case 'no_key':
      return new InterpretError('upstream_rejected', 'no_key')
    case 'rejected':
      return new InterpretError('upstream_rejected', error.message)
    case 'busy':
    case 'unreachable':
      return new InterpretError('upstream_unavailable', error.message)
  }
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
function answerFrom(reply: ModelReplyNeutral): { intent: unknown; say: string; done: boolean; plan: string[] } | null {
  if (reply.stop !== 'tool') return null
  const call = reply.call
  if (!call || call.name !== ANSWER_TOOL.name || typeof call.input !== 'object' || call.input === null) return null
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

const ANSWER = modelTool(ANSWER_TOOL)

/**
 * The ask for one request, provider-neutral (ARCHITECTURE 30.5.1). The fixed prompt is the
 * cacheable prefix; round 5: a careful ask adds its paragraph after it, so that prefix stays the same.
 */
export function intentAsk(request: IntentRequest): ModelAsk {
  const care: Care = request.care ?? 'quick'
  const settings = careSettings(care)
  return {
    system: INTENT_SYSTEM_PROMPT,
    ...(care === 'careful' ? { systemExtra: CAREFUL_PROMPT } : {}),
    user: intentUserMessage(request),
    tools: [ANSWER],
    effort: settings.effort,
    maxTokens: settings.maxTokens,
    timeoutMs: settings.timeoutMs,
  }
}

export async function pageIntent(input: unknown, deps: { model: Model }): Promise<IntentAnswer> {
  const parsed = IntentRequestSchema.safeParse(input)
  if (!parsed.success || parsed.data.utterance.trim() === '') {
    throw new InterpretError('bad_request', 'The request is malformed.')
  }
  const request = parsed.data
  const started = Date.now()
  const care: Care = request.care ?? 'quick'

  let reply: ModelReplyNeutral
  try {
    reply = await deps.model.ask(intentAsk(request))
  } catch (error) {
    const mapped = toIntentError(error)
    const provider = error instanceof ModelError ? ` provider=${error.provider}` : ''
    console.info(`[intent] error=${mapped.code} care=${care} ms=${Date.now() - started}${provider}`)
    throw mapped
  }

  const raw = answerFrom(reply)
  const intent = raw ? pageIntentFrom(raw.intent, request) : null
  const answer: IntentAnswer = intent && raw ? { intent, say: raw.say, done: raw.done, ...(raw.plan.length > 0 ? { plan: raw.plan } : {}) } : unclear(request)
  // Round 9 (30.5.3): what the ask cost, for the engine's tally. Counts and names only.
  const { usage } = reply
  answer.usage = { ...usage, provider: reply.provider, model: reply.model }
  const tokens = `in=${usage.input + usage.cacheWrite} out=${usage.output} cached=${usage.cacheRead} provider=${reply.provider}`
  console.info(`[intent] kind=${answer.intent.kind} done=${answer.done !== false} plan=${answer.plan?.length ?? 0} care=${care} ms=${Date.now() - started} ${tokens}`)
  return answer
}

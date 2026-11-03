import { AddresseeRequestSchema, verdictFrom } from '../src/core/addressee.ts'
import type { AddresseeAnswer, AddresseeRequest, AddresseeVerdict } from '../src/core/addressee.ts'
import { InterpretError } from './interpret.ts'
import { ModelError } from './model/types.ts'
import type { Model, ModelAsk, ModelReplyNeutral, ModelTool } from './model/types.ts'

/**
 * Round 10 (#6; ARCHITECTURE 32.3): POST /api/addressee. One final of always-on mode that no rule
 * recognised, the three finals before it and the page in short, in; one verdict out: command,
 * dictation, or ignore (not said to Ütle). One quick model call through server/model/, no retry.
 * LIMITED: text only, no audio. Logs the verdict and the time, never the words (CLAUDE.md).
 */

export const ADDRESSEE_TIMEOUT_MS = 5000
/**
 * Round 10 (#7, 33.1): 400, as a quick intent ask. Haiku 5.5 thinks before the call even at effort
 * low; 60 cut its answer off (stop max_tokens, verdict bad) on the dictation cases. The timeout still
 * bounds the wait.
 */
export const ADDRESSEE_MAX_TOKENS = 400
const MAX_TOKENS = ADDRESSEE_MAX_TOKENS

export const ADDRESSEE_SYSTEM_PROMPT = `You are the addressee check of Ütle, a voice assistant for a person who cannot use his hands. The microphone is always on and hears the whole room: him, other people, a television. You see one sentence the speech recogniser just heard (its words may be misrecognised), the three sentences heard before it, and the web page in front of him.

Decide whether the sentence was said to Ütle:
- "command": an instruction for the browser or the page (open, go to, search, scroll, click, play, read, close, write to someone, send, go back, delete), in any word order, polite or curt, with or without the name Ütle.
- "dictation": words he wants typed into the text box that is armed (box armed true): a message, a reply, a search text. Only when the box is armed, and only when the sentence reads as text for that box rather than talk to someone in the room.
- "ignore": anything else: talk to people in the room ("kas sa tuled ka?", "pane see lauale", "aitäh, väga maitsev"), answers to someone else's question, comments, thinking aloud, half sentences, television or radio speech, a sentence that continues a conversation in the earlier sentences that was not addressed to Ütle.

Read the sentence as it sounds: the recogniser often mishears one word of a short command ("mina emaili" for "mine emaili", "näite numbreid" for "näita numbreid"); a sentence that is a command once one word is read as it sounds is a command.

Right after a read-back (readBack true): Ütle has just typed into the armed field and read its value back to him, and he is checking it. While the field is armed, the next sentence is addressed to Ütle: a correction of what was typed ("vale", "kustuta", "ei, ...", "sa kirjutasid valesti", a name spelled "nõrga t-ga", "kahe v-ga") is a "command"; more of the value is "dictation"; it is never "ignore", even when it starts with "ei", "kuule" or "okei", talks about Ütle ("sa kirjutasid") or follows sentences judged not for Ütle.

When in doubt between "dictation" and "ignore" and the box is not armed, answer "ignore". When in doubt between "command" and "ignore", answer "command" only if the sentence names something on this page or a site. Answer only with the tool.`

const VERDICT_TOOL: ModelTool = {
  name: 'verdict',
  description: 'Whether the sentence was said to Ütle: command, dictation or ignore.',
  schema: {
    type: 'object',
    properties: { verdict: { type: 'string', enum: ['command', 'dictation', 'ignore'] } },
    required: ['verdict'],
    additionalProperties: false,
  },
  strict: true,
}

/** The user turn: the page, the earlier finals, the sentence. JSON so quotes in his words cannot break it. */
export function addresseeUserMessage(request: AddresseeRequest): string {
  // Round 11 (F6): readBack only when set, so the turn of an older extension is as before.
  return JSON.stringify({ page: request.page, earlier: request.finals, sentence: request.utterance, language: request.lang, ...(request.readBack === true ? { readBack: true } : {}) })
}

export function addresseeAsk(request: AddresseeRequest): ModelAsk {
  return { system: ADDRESSEE_SYSTEM_PROMPT, user: addresseeUserMessage(request), tools: [VERDICT_TOOL], effort: 'low', maxTokens: MAX_TOKENS, timeoutMs: ADDRESSEE_TIMEOUT_MS }
}

function verdictOf(reply: ModelReplyNeutral): AddresseeVerdict | null {
  const call = reply.call
  if (reply.stop !== 'tool' || !call || call.name !== VERDICT_TOOL.name || typeof call.input !== 'object' || call.input === null) return null
  return verdictFrom((call.input as Record<string, unknown>).verdict)
}

function toError(error: unknown): InterpretError {
  if (!(error instanceof ModelError)) return new InterpretError('upstream_unavailable', 'The assistant is unreachable.')
  if (error.kind === 'timeout') return new InterpretError('timeout', error.message)
  if (error.kind === 'no_key') return new InterpretError('upstream_rejected', 'no_key')
  if (error.kind === 'rejected') return new InterpretError('upstream_rejected', error.message)
  return new InterpretError('upstream_unavailable', error.message)
}

/**
 * The verdict for one request. A reply of the wrong shape is an error (the engine then goes on as
 * before: the rules and the intent ask still judge the sentence), never a guess.
 */
export async function addresseeAnswer(input: unknown, deps: { model: Model }): Promise<AddresseeAnswer> {
  const parsed = AddresseeRequestSchema.safeParse(input)
  if (!parsed.success || parsed.data.utterance.trim() === '') throw new InterpretError('bad_request', 'The request is malformed.')
  const started = Date.now()
  let reply: ModelReplyNeutral
  try {
    reply = await deps.model.ask(addresseeAsk(parsed.data))
  } catch (error) {
    const mapped = toError(error)
    console.info(`[addressee] error=${mapped.code} at=${started} ms=${Date.now() - started}`)
    throw mapped
  }
  const verdict = verdictOf(reply)
  const { usage } = reply
  console.info(`[addressee] verdict=${verdict ?? 'bad'} at=${started} ms=${Date.now() - started} in=${usage.input + usage.cacheWrite} out=${usage.output} provider=${reply.provider}`)
  if (verdict === null) throw new InterpretError('upstream_unavailable', 'The assistant gave no verdict.')
  return { verdict, usage: { ...usage, provider: reply.provider, model: reply.model } }
}

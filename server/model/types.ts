/**
 * Round 9 (ARCHITECTURE 30.5.1): the provider-neutral request and reply. Every model call of the
 * server is one ModelAsk through one Model; nothing outside server/model/ speaks a provider's wire
 * format.
 */

export interface ModelTool {
  name: string
  description: string
  /** The tool's input as JSON Schema. */
  schema: Record<string, unknown>
  /** Ask the provider to hold the call to the schema exactly (Anthropic strict tools). */
  strict?: boolean
}

export interface ModelToolCall {
  id: string
  name: string
  input: unknown
}

export interface ModelAsk {
  /** The fixed, cacheable prefix. */
  system: string
  /** CAREFUL_PROMPT: after the cached block, so the cached block stays the same. */
  systemExtra?: string
  /** The one user turn. */
  user: string
  /** One for /api/intent, four for /api/interpret. */
  tools: readonly ModelTool[]
  /** /api/interpret's retry: a call the model made, and the error that goes back about it. */
  corrections?: ReadonlyArray<{ call: ModelToolCall; error: string }>
  /** Absent: the provider's default. */
  effort?: 'low' | 'high'
  maxTokens: number
  timeoutMs: number
}

/** Tokens of one ask. The four never overlap: cost is the sum of each times its price. */
export interface ModelUsage {
  /** Input billed at the full price: neither read from nor written to the cache. */
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type ModelStop = 'tool' | 'text' | 'cut' | 'refusal'

export interface ModelReplyNeutral {
  /** The first tool call, or null. */
  call: ModelToolCall | null
  stop: ModelStop
  usage: ModelUsage
  /** Which provider answered (`anthropic`, `deepseek`, …) and with which model id. */
  provider: string
  model: string
  ms: number
}

export interface Model {
  ask(ask: ModelAsk): Promise<ModelReplyNeutral>
}

/**
 * Why an ask has no reply. timeout: the wait ran out. unreachable: connection refused or lost.
 * busy: 429 or 5xx. no_key: 401 or 403. rejected: any other status (kept in `status`).
 */
export type ModelErrorKind = 'timeout' | 'unreachable' | 'busy' | 'no_key' | 'rejected'

export class ModelError extends Error {
  readonly kind: ModelErrorKind
  readonly provider: string
  readonly status: number | undefined

  constructor(kind: ModelErrorKind, provider: string, message: string, status?: number) {
    super(message)
    this.name = 'ModelError'
    this.kind = kind
    this.provider = provider
    this.status = status
  }
}

export const NO_USAGE: ModelUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** A tool written in the Anthropic shape (server/intentPrompt.ts, server/tools.ts) as a ModelTool. */
export function modelTool(tool: { name: string; description?: string | undefined; input_schema: object; strict?: boolean | undefined }): ModelTool {
  return { name: tool.name, description: tool.description ?? '', schema: tool.input_schema as Record<string, unknown>, ...(tool.strict === true ? { strict: true } : {}) }
}

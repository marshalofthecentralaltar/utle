import * as z from 'zod'
import { IntentSchema } from '../core/intent.ts'
import type { Intent, InterpretRequest } from '../core/intent.ts'

const TIMEOUT_MS = 25_000
const STILL_WORKS = 'Yes, no and undo still work.'

const ErrorSchema = z.object({ error: z.object({ message: z.string() }) })
const StatusSchema = z.object({ mode: z.enum(['live', 'rehearsal']), model: z.string().nullable() })

export type ServerStatus = z.infer<typeof StatusSchema>

/**
 * Asks the server what an utterance means. Resolves with a checked Intent.
 * Rejects with an Error whose message can be shown to the user as it is.
 */
export async function requestIntent(request: InterpretRequest): Promise<Intent> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch('/api/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const known = ErrorSchema.safeParse(body)
      const reason = known.success ? known.data.error.message : 'The assistant failed.'
      throw new Error(`${reason} ${STILL_WORKS}`)
    }
    const intent = IntentSchema.safeParse(body)
    if (!intent.success) throw new Error(`The assistant sent an answer I could not read. ${STILL_WORKS}`)
    return intent.data
  } catch (error) {
    if (error instanceof Error && error.message.endsWith(STILL_WORKS)) throw error
    const slow = error instanceof DOMException && error.name === 'AbortError'
    throw new Error(`${slow ? 'The assistant took too long.' : 'The assistant is unreachable.'} ${STILL_WORKS}`, { cause: error })
  } finally {
    clearTimeout(timer)
  }
}

/** Which interpreter the server is using, or null when the server cannot be reached. */
export async function fetchStatus(): Promise<ServerStatus | null> {
  try {
    const response = await fetch('/api/status')
    const parsed = StatusSchema.safeParse(await response.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// The server the extension talks to (docs/ARCHITECTURE.md 27.3): its address and token as stored
// on the settings page, the http addresses derived from the socket's, and GET /api/status. Used by
// the offscreen page and by the settings page's "Proovi ühendust", so both take the same path.

export const DEFAULT_ASR_URL = 'ws://localhost:5173/api/asr'

/** GET /api/status may take this long before the engine goes on without it. */
export const STATUS_TIMEOUT_MS = 3000

/** The two server settings in chrome.storage.local. */
export const CONNECTION_KEYS = ['asrUrl', 'serverToken'] as const

export interface Connection {
  /** The recogniser's websocket address (ws:// or wss://). */
  asrUrl: string
  /** The server token, or '' for an open server. */
  token: string
}

/** Reads the server settings out of a chrome.storage.local answer: an empty or malformed address is the local default. */
export function connectionFrom(stored: Record<string, unknown>): Connection {
  const address = typeof stored.asrUrl === 'string' ? stored.asrUrl.trim() : ''
  const token = typeof stored.serverToken === 'string' ? stored.serverToken.trim() : ''
  return { asrUrl: isSocketAddress(address) ? address : DEFAULT_ASR_URL, token }
}

/** True for a ws:// or wss:// address. */
export function isSocketAddress(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'ws:' || url.protocol === 'wss:'
  } catch {
    return false
  }
}

/** The server's http address for path, from the recogniser's (ws(s)://host/api/asr → http(s)://host/path). The query (engine, token) is dropped. */
export function serverUrl(asrAddress: string, path: string): string {
  const url = new URL(asrAddress)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = path
  url.search = ''
  return url.toString()
}

/** The socket's address with the token: a browser cannot set headers on a WebSocket. */
export function socketAddress(address: string, token: string): string {
  if (token === '') return address
  const url = new URL(address)
  url.searchParams.set('token', token)
  return url.toString()
}

/** The bearer header for every fetch to the server. */
export function authHeaders(token: string): Record<string, string> {
  return token === '' ? {} : { Authorization: `Bearer ${token}` }
}

export type ServerState = 'live' | 'no_key' | 'bad_token' | 'unreachable'

export interface ServerCheck {
  state: ServerState
  /** Which speech engines the server can run, when it answered. */
  speech?: { local: boolean; soniox: boolean }
  /** Round 7 (27.6): which voice profile the token is, when the server says. */
  profile?: { name: string; enrolled: boolean }
}

const field = (body: unknown, key: string): unknown => (typeof body === 'object' && body !== null && key in body ? (body as Record<string, unknown>)[key] : undefined)

/** GET /api/status with the token: what the server has, a 401 as bad_token. Never rejects. */
export async function serverCheck(statusUrl: string, token: string): Promise<ServerCheck> {
  try {
    // Checked once in the engine's queue before the first utterance: a server that hangs must not hold it.
    const response = await fetch(statusUrl, { headers: authHeaders(token), signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) })
    if (response.status === 401) return { state: 'bad_token' }
    if (!response.ok) return { state: 'unreachable' }
    const body: unknown = await response.json()
    const speech = field(body, 'speech')
    const profile = field(body, 'profile')
    const name = field(profile, 'name')
    return {
      state: field(body, 'intent') === 'no_key' ? 'no_key' : 'live',
      speech: { local: field(speech, 'local') === true, soniox: field(speech, 'soniox') === true },
      ...(typeof name === 'string' ? { profile: { name, enrolled: field(profile, 'enrolled') === true } } : {}),
    }
  } catch {
    return { state: 'unreachable' }
  }
}

/** GET /api/status (M7): whether the server has a model, and (27.3) whether it took the token. */
export async function serverStatus(statusUrl: string, token: string): Promise<ServerState> {
  return (await serverCheck(statusUrl, token)).state
}

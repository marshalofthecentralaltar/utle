/**
 * The server token (ARCHITECTURE 27.2). UTLE_TOKEN set: every /api request carries
 * `Authorization: Bearer <token>`, and the websocket upgrade carries `?token=<token>` (a browser
 * cannot set headers on a WebSocket). Unset: open, as the dev server always was. The token is
 * never logged and is compared in constant time.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

/** What the checks read of a request: its headers and its address. */
export interface RequestLike {
  url?: string
  headers: Record<string, string | string[] | undefined>
}

/** The token the server expects, or undefined when the API is open. */
export function expectedToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.UTLE_TOKEN?.trim()
  return value ? value : undefined
}

/** `"auth"` in /api/status. */
export function authState(token: string | undefined): 'on' | 'off' {
  return token === undefined ? 'off' : 'on'
}

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()

/** True when given is the token. Hashing first keeps the comparison constant-time whatever the lengths. */
export function sameToken(given: string, token: string): boolean {
  return given !== '' && timingSafeEqual(digest(given), digest(token))
}

function bearer(req: RequestLike): string | null {
  const header = req.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  const match = value === undefined ? null : /^Bearer\s+(\S+)\s*$/i.exec(value)
  return match?.[1] ?? null
}

function queryToken(req: RequestLike): string | null {
  const query = (req.url ?? '').split('?')[1]
  if (query === undefined) return null
  return new URLSearchParams(query).get('token')
}

/** An http request under /api: the bearer header only. */
export function httpAuthorized(req: RequestLike, token: string | undefined): boolean {
  if (token === undefined) return true
  const given = bearer(req)
  return given !== null && sameToken(given, token)
}

/** The websocket upgrade at /api/asr: ?token= in its address, or the header for a client that can send one. */
export function upgradeAuthorized(req: RequestLike, token: string | undefined): boolean {
  if (token === undefined) return true
  const given = queryToken(req) ?? bearer(req)
  return given !== null && sameToken(given, token)
}

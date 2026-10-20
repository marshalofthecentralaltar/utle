/**
 * The server token (ARCHITECTURE 27.2). UTLE_TOKEN set: every /api request carries
 * `Authorization: Bearer <token>`, and the websocket upgrade carries `?token=<token>` (a browser
 * cannot set headers on a WebSocket). Unset: open, as the dev server always was. The token is
 * never logged and is compared in constant time.
 *
 * Round 7 (27.6): UTLE_TOKEN may hold several tokens separated by commas, each optionally
 * `name:token`. Each token is a user; the user's voice profile is keyed by profileId(token).
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

/** One token's user (27.6). id keys the voice profile; it is derived from the token and never reveals it. */
export interface TokenUser {
  name: string
  token: string
  /** profileId(token), or '' for the local user. */
  id: string
}

/** The one user of a server without UTLE_TOKEN (local dev): its profile is today's models/speaker/owner.json. */
export const LOCAL_USER: TokenUser = { name: 'omanik', token: '', id: '' }

/** The first 16 hex digits of the token's SHA-256: the profile's file name. */
export function profileId(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16)
}

/** The users in UTLE_TOKEN: `name:token` or a bare token (named by its id's first six digits), comma separated. Empty: open. */
export function tokenUsers(env: NodeJS.ProcessEnv = process.env): TokenUser[] {
  const users: TokenUser[] = []
  for (const entry of (env.UTLE_TOKEN ?? '').split(',')) {
    const colon = entry.indexOf(':')
    const token = (colon === -1 ? entry : entry.slice(colon + 1)).trim()
    if (token === '' || users.some((user) => user.token === token)) continue
    const id = profileId(token)
    const name = colon === -1 ? '' : entry.slice(0, colon).trim()
    users.push({ name: name === '' ? id.slice(0, 6) : name, token, id })
  }
  return users
}

/** The user whose token this is, or null. Every token is compared, so the time does not say which one matched. */
function userOf(given: string | null, users: readonly TokenUser[]): TokenUser | null {
  if (users.length === 0) return LOCAL_USER
  if (given === null) return null
  let found: TokenUser | null = null
  for (const user of users) if (sameToken(given, user.token) && found === null) found = user
  return found
}

/** The caller of an http request under /api, by the bearer header only; LOCAL_USER when the server is open. */
export function httpUser(req: RequestLike, users: readonly TokenUser[]): TokenUser | null {
  return userOf(bearer(req), users)
}

/** The caller of the websocket upgrade at /api/asr, by ?token= or the header; LOCAL_USER when the server is open. */
export function upgradeUser(req: RequestLike, users: readonly TokenUser[]): TokenUser | null {
  return userOf(queryToken(req) ?? bearer(req), users)
}

const asUsers = (token: string | undefined | readonly TokenUser[]): readonly TokenUser[] =>
  token === undefined ? [] : typeof token === 'string' ? [{ name: '', token, id: profileId(token) }] : token

/** An http request under /api: the bearer header only. token: one token, the users of tokenUsers, or undefined for open. */
export function httpAuthorized(req: RequestLike, token: string | undefined | readonly TokenUser[]): boolean {
  return httpUser(req, asUsers(token)) !== null
}

/** The websocket upgrade at /api/asr: ?token= in its address, or the header for a client that can send one. */
export function upgradeAuthorized(req: RequestLike, token: string | undefined | readonly TokenUser[]): boolean {
  return upgradeUser(req, asUsers(token)) !== null
}

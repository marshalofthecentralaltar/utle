import type { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { InterpretRequestSchema } from '../src/core/intent.ts'
import { MODEL_DIR, attachAsr } from './asr.ts'
import type { AttachOptions } from './asr.ts'
import { LOCAL_USER, authState, httpUser, tokenUsers, upgradeUser } from './auth.ts'
import type { TokenUser } from './auth.ts'
import { pageIntent } from './intent.ts'
import { InterpretError, interpret } from './interpret.ts'
import type { InterpretErrorCode, MessagesClient } from './interpret.ts'
import { rehearse } from './rehearsal.ts'
import { profilePath, profileSummary } from './speaker.ts'

/** Sonnet 5.5: the eval on Opus 5.5 gave p50 2.7 s per command, too slow for a spoken command. UTLE_MODEL overrides. */
const DEFAULT_MODEL = 'claude-sonnet-5-5'
const MAX_BODY_BYTES = 1_000_000

const STATUS: Record<InterpretErrorCode, number> = {
  bad_request: 400,
  upstream_rejected: 502,
  upstream_unavailable: 502,
  timeout: 504,
}

export type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void
/** connect's `use(path, handler)` under another name: Vite's `server.middlewares.use` and the production router both have it. */
export type Mount = (path: string, handler: Handler) => void

export interface ApiOptions {
  /** The project root: models/ and the decode worker's entry are found from it. */
  root: string
  /** `vite --mode rehearsal`: /api/interpret answers from the demo script. */
  rehearsal?: boolean
  /** The environment the token and the keys are read from. Default process.env. */
  env?: NodeJS.ProcessEnv
  /** Starts the decode worker; tests pass a fake host. Default: the real worker. */
  startWorker?: AttachOptions['startWorker']
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new InterpretError('bad_request', 'The request is too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** The extension's offscreen document calls from a chrome-extension:// origin, so every answer allows any origin. */
function allowCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function send(res: ServerResponse, status: number, body: unknown): void {
  allowCors(res)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function preflight(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'OPTIONS') return false
  allowCors(res)
  res.statusCode = 204
  res.end()
  return true
}

function toKnownError(error: unknown): InterpretError {
  return error instanceof InterpretError
    ? error
    : new InterpretError('upstream_rejected', 'The server has no working Anthropic credentials.')
}

async function jsonBody(req: IncomingMessage): Promise<unknown> {
  try {
    return JSON.parse(await readBody(req))
  } catch (error) {
    if (error instanceof InterpretError) throw error
    throw new InterpretError('bad_request', 'The request body is not JSON.')
  }
}

/**
 * The API of ARCHITECTURE 27.1, on any http server (Vite's in development, server/serve.ts in production).
 *   GET  /api/status     which interpreter answers, whether /api/intent has a key, which speech engines can run, whether a token is needed
 *   POST /api/intent     one unrecognised utterance with the page in, one IntentAnswer out (M7)
 *   POST /api/interpret  one utterance in, one Intent out
 *   WS   /api/asr        the local recogniser (20.1), or Soniox (23.4); attached when httpServer is given
 * UTLE_TOKEN set: every /api request needs the bearer header and the websocket ?token= (27.2).
 * The Anthropic key is read from the server's environment and never reaches the browser (principle P8).
 */
export function attachUtleApi(httpServer: EventEmitter | null, mount: Mount, options: ApiOptions): void {
  const env = options.env ?? process.env
  const rehearsal = options.rehearsal === true
  const users = tokenUsers(env)
  // Each caller's voice profile file (27.6): owner.json for the open server, profiles/<id>.json per token.
  const profileOf = (user: TokenUser): string => profilePath(options.root, env, user.id)
  let client: MessagesClient | null = null
  const model = (): string => env.UTLE_MODEL ?? DEFAULT_MODEL

  const getClient = (): MessagesClient => {
    if (!client) {
      const anthropic = new Anthropic({ maxRetries: 0 })
      client = { messages: { create: (params, opts) => anthropic.messages.create(params, opts) } }
    }
    return client
  }

  const answer = async (input: unknown) => {
    if (!rehearsal) return interpret(input, { client: getClient(), model: model() })
    const parsed = InterpretRequestSchema.safeParse(input)
    if (!parsed.success) throw new InterpretError('bad_request', 'The request is malformed.')
    return rehearse(parsed.data)
  }

  if (httpServer) {
    attachAsr(httpServer, options.root, {
      authorize: (req) => upgradeUser(req, users) !== null,
      profileFor: (req) => {
        const user = upgradeUser(req, users)
        return user === null ? undefined : profileOf(user)
      },
      ...(options.startWorker ? { startWorker: options.startWorker } : {}),
    })
  }

  // First under /api: the token. A preflight carries no credentials, so it passes; the route answers it.
  mount('/api', (req, res, next) => {
    if (req.method === 'OPTIONS' || httpUser(req, users) !== null) {
      next()
      return
    }
    send(res, 401, { error: { code: 'unauthorized', message: 'The server token is missing or wrong.' } })
  })

  mount('/api/status', (req, res, next) => {
    if (preflight(req, res)) return
    if (req.method !== 'GET') {
      next()
      return
    }
    const intent = env.ANTHROPIC_API_KEY ? 'live' : 'no_key'
    // local: the model files are on disk (whether the addon loads is only known at the first connection).
    const speech = { local: existsSync(join(options.root, MODEL_DIR)), soniox: Boolean(env.SONIOX_API_KEY) }
    const auth = authState(users.length === 0 ? undefined : 'on')
    // The caller's profile (27.6): which user the token is, and whether that user's voice is learnt.
    const user = httpUser(req, users) ?? LOCAL_USER
    const profile = { name: user.name, ...profileSummary(profileOf(user)) }
    send(res, 200, rehearsal ? { mode: 'rehearsal', model: null, intent, speech, auth, profile } : { mode: 'live', model: model(), intent, speech, auth, profile })
  })

  mount('/api/intent', (req, res, next) => {
    if (preflight(req, res)) return
    if (req.method !== 'POST') {
      next()
      return
    }
    void (async () => {
      try {
        const input = await jsonBody(req)
        if (!env.ANTHROPIC_API_KEY) throw new InterpretError('upstream_rejected', 'no_key')
        send(res, 200, await pageIntent(input, { client: getClient(), model: model() }))
      } catch (error) {
        const known = toKnownError(error)
        send(res, STATUS[known.code], { error: { code: known.code, message: known.message } })
      }
    })()
  })

  mount('/api/interpret', (req, res, next) => {
    if (preflight(req, res)) return
    if (req.method !== 'POST') {
      next()
      return
    }
    void (async () => {
      try {
        send(res, 200, await answer(await jsonBody(req)))
      } catch (error) {
        const known = toKnownError(error)
        send(res, STATUS[known.code], { error: { code: known.code, message: known.message } })
      }
    })()
  })
}

/** True when path is prefix or below it, as connect mounts. */
function mounted(prefix: string, path: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

export interface ServeOptions extends ApiOptions {
  /** Attach the recogniser's websocket. Default true; the route test passes false. */
  asr?: boolean
}

/**
 * The production server (27.1): plain node:http, no Vite. `/` is one line of text, `/healthz` is
 * 200 without a token (the host's health check), `/api/*` is attachUtleApi, anything else 404.
 */
export function createUtleServer(options: ServeOptions): Server {
  const routes: { prefix: string; handler: Handler }[] = []
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    if (req.method === 'GET' && path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ok\n')
      return
    }
    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Ütle server\n')
      return
    }
    const matching = routes.filter((route) => mounted(route.prefix, path))
    const step = (i: number): void => {
      const route = matching[i]
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found\n')
        return
      }
      route.handler(req, res, () => step(i + 1))
    }
    step(0)
  })
  attachUtleApi(options.asr === false ? null : server, (prefix, handler) => routes.push({ prefix, handler }), options)
  return server
}

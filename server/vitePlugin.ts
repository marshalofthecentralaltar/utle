import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { Plugin } from 'vite'
import { InterpretRequestSchema } from '../src/core/intent.ts'
import { MODEL_DIR, attachAsr } from './asr.ts'
import { pageIntent } from './intent.ts'
import { InterpretError, interpret } from './interpret.ts'
import type { InterpretErrorCode, MessagesClient } from './interpret.ts'
import { rehearse } from './rehearsal.ts'

/** Sonnet 5.5: the eval on Opus 5.5 gave p50 2.7 s per command, too slow for a spoken command. UTLE_MODEL overrides. */
const DEFAULT_MODEL = 'claude-sonnet-5-5'
const MAX_BODY_BYTES = 1_000_000

const STATUS: Record<InterpretErrorCode, number> = {
  bad_request: 400,
  upstream_rejected: 502,
  upstream_unavailable: 502,
  timeout: 504,
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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

/**
 * Hosts the API on the Vite dev server, so `npm run dev` is the whole product.
 *   POST /api/interpret  one utterance in, one Intent out
 *   POST /api/intent     one unrecognised utterance with the page in, one IntentAnswer out (M7)
 *   GET  /api/status     which interpreter is answering, whether /api/intent has a key, which speech engines can run
 *   WS   /api/asr        the local recogniser (ARCHITECTURE 20.1)
 * The Anthropic key is read from the server's environment and never reaches the browser (principle P8).
 * `vite --mode rehearsal` answers from the demo script instead of the model.
 */
export function utleApi(): Plugin {
  let client: MessagesClient | null = null
  let rehearsal = false
  const model = (): string => process.env.UTLE_MODEL ?? DEFAULT_MODEL

  const getClient = (): MessagesClient => {
    if (!client) {
      const anthropic = new Anthropic({ maxRetries: 0 })
      client = { messages: { create: (params, options) => anthropic.messages.create(params, options) } }
    }
    return client
  }

  const answer = async (input: unknown) => {
    if (!rehearsal) return interpret(input, { client: getClient(), model: model() })
    const parsed = InterpretRequestSchema.safeParse(input)
    if (!parsed.success) throw new InterpretError('bad_request', 'The request is malformed.')
    return rehearse(parsed.data)
  }

  return {
    name: 'utle-api',
    configResolved(config) {
      rehearsal = config.mode === 'rehearsal'
    },
    configureServer(server) {
      // The local recogniser rides on the dev server's http server; vitest has none to listen on.
      if (server.httpServer && !process.env.VITEST) attachAsr(server.httpServer, server.config.root)

      server.middlewares.use('/api/status', (req, res, next) => {
        if (preflight(req, res)) return
        if (req.method !== 'GET') {
          next()
          return
        }
        const intent = process.env.ANTHROPIC_API_KEY ? 'live' : 'no_key'
        // local: the model files are on disk (whether the addon loads is only known at the first connection).
        const speech = { local: existsSync(join(server.config.root, MODEL_DIR)), soniox: Boolean(process.env.SONIOX_API_KEY) }
        send(res, 200, rehearsal ? { mode: 'rehearsal', model: null, intent, speech } : { mode: 'live', model: model(), intent, speech })
      })

      server.middlewares.use('/api/intent', (req, res, next) => {
        if (preflight(req, res)) return
        if (req.method !== 'POST') {
          next()
          return
        }
        void (async () => {
          try {
            let input: unknown
            try {
              input = JSON.parse(await readBody(req))
            } catch (error) {
              if (error instanceof InterpretError) throw error
              throw new InterpretError('bad_request', 'The request body is not JSON.')
            }
            if (!process.env.ANTHROPIC_API_KEY) throw new InterpretError('upstream_rejected', 'no_key')
            send(res, 200, await pageIntent(input, { client: getClient(), model: model() }))
          } catch (error) {
            const known = toKnownError(error)
            send(res, STATUS[known.code], { error: { code: known.code, message: known.message } })
          }
        })()
      })

      server.middlewares.use('/api/interpret', (req, res, next) => {
        if (preflight(req, res)) return
        if (req.method !== 'POST') {
          next()
          return
        }
        void (async () => {
          try {
            let input: unknown
            try {
              input = JSON.parse(await readBody(req))
            } catch (error) {
              if (error instanceof InterpretError) throw error
              throw new InterpretError('bad_request', 'The request body is not JSON.')
            }
            send(res, 200, await answer(input))
          } catch (error) {
            const known = toKnownError(error)
            send(res, STATUS[known.code], { error: { code: known.code, message: known.message } })
          }
        })()
      })
    },
  }
}

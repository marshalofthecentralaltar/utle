import type { IncomingMessage, ServerResponse } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import type { Plugin } from 'vite'
import { InterpretRequestSchema } from '../src/core/intent.ts'
import { InterpretError, interpret } from './interpret.ts'
import type { InterpretErrorCode, MessagesClient } from './interpret.ts'
import { rehearse } from './rehearsal.ts'

const DEFAULT_MODEL = 'claude-haiku-4-5'
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

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/**
 * Hosts the API on the Vite dev server, so `npm run dev` is the whole product.
 *   POST /api/interpret  one utterance in, one Intent out
 *   GET  /api/status     which interpreter is answering
 * The Anthropic key is read from the server's environment and never reaches the browser (principle P8).
 * `vite --mode rehearsal` answers from the demo script instead of the model.
 */
export function utleApi(): Plugin {
  let client: MessagesClient | null = null
  let rehearsal = false
  const model = (): string => process.env.UTLE_MODEL ?? DEFAULT_MODEL

  const getClient = (): MessagesClient => {
    if (!client) {
      const anthropic = new Anthropic({ maxRetries: 1 })
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
      server.middlewares.use('/api/status', (req, res, next) => {
        if (req.method !== 'GET') {
          next()
          return
        }
        send(res, 200, rehearsal ? { mode: 'rehearsal', model: null } : { mode: 'live', model: model() })
      })

      server.middlewares.use('/api/interpret', (req, res, next) => {
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
            const known =
              error instanceof InterpretError
                ? error
                : new InterpretError('upstream_rejected', 'The server has no working Anthropic credentials.')
            send(res, STATUS[known.code], { error: { code: known.code, message: known.message } })
          }
        })()
      })
    },
  }
}

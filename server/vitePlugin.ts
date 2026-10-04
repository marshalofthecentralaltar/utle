import type { IncomingMessage, ServerResponse } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import type { Plugin } from 'vite'
import { InterpretError, interpret } from './interpret.ts'
import type { InterpretErrorCode, MessagesClient } from './interpret.ts'

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
 * Hosts POST /api/interpret on the Vite dev server, so `npm run dev` is the whole product.
 * The Anthropic key is read from the server's environment and never reaches the browser (principle P8).
 */
export function utleApi(): Plugin {
  let client: MessagesClient | null = null

  const getClient = (): MessagesClient => {
    if (!client) {
      const anthropic = new Anthropic({ maxRetries: 1 })
      client = { messages: { create: (params, options) => anthropic.messages.create(params, options) } }
    }
    return client
  }

  return {
    name: 'utle-api',
    configureServer(server) {
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
            const model = process.env.UTLE_MODEL ?? DEFAULT_MODEL
            send(res, 200, await interpret(input, { client: getClient(), model }))
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

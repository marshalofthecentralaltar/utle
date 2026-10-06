import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createUtleServer } from './app.ts'
import { attachAsr } from './asr.ts'
import { upgradeAuthorized } from './auth.ts'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))))
})

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `127.0.0.1:${(server.address() as AddressInfo).port}`
}

const serve = (env: NodeJS.ProcessEnv): Promise<string> => listen(createUtleServer({ root: '.', env, asr: false }))

describe('the production server (27.1)', () => {
  it('answers / and /healthz without a token, and 404 elsewhere', async () => {
    const host = await serve({ UTLE_TOKEN: 't1' })
    const root = await fetch(`http://${host}/`)
    expect(root.status).toBe(200)
    expect(await root.text()).toBe('Ütle server\n')
    expect((await fetch(`http://${host}/healthz`)).status).toBe(200)
    expect((await fetch(`http://${host}/nothing`)).status).toBe(404)
  })

  it('needs the bearer token under /api when UTLE_TOKEN is set (27.2)', async () => {
    const host = await serve({ UTLE_TOKEN: 't1', ANTHROPIC_API_KEY: 'k' })
    const bare = await fetch(`http://${host}/api/status`)
    expect(bare.status).toBe(401)
    expect(bare.headers.get('access-control-allow-origin')).toBe('*')
    expect((await fetch(`http://${host}/api/status`, { headers: { authorization: 'Bearer t2' } })).status).toBe(401)
    expect((await fetch(`http://${host}/api/intent`, { method: 'POST', body: '{}' })).status).toBe(401)
    const ok = await fetch(`http://${host}/api/status`, { headers: { authorization: 'Bearer t1' } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ mode: 'live', intent: 'live', auth: 'on' })
  })

  it('answers a preflight without the token and allows the Authorization header', async () => {
    const host = await serve({ UTLE_TOKEN: 't1' })
    const res = await fetch(`http://${host}/api/status`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization')
  })

  it('is open with auth off when UTLE_TOKEN is unset', async () => {
    const host = await serve({})
    const res = await fetch(`http://${host}/api/status`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ intent: 'no_key', auth: 'off' })
  })
})

describe('the websocket upgrade with a token (27.2)', () => {
  const asrServer = async (): Promise<string> => {
    const server = createServer()
    // No model here: a socket that passes the gate is told the model is missing.
    attachAsr(server, '.', { startWorker: () => Promise.resolve({ ok: false, reason: 'model_missing' }), authorize: (req) => upgradeAuthorized(req, 't1') })
    return listen(server)
  }

  it('refuses the upgrade with 401 without ?token=', async () => {
    const host = await asrServer()
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://${host}/api/asr`)
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      ws.on('open', () => resolve(101))
      ws.on('error', () => undefined)
    })
    expect(status).toBe(401)
  })

  it('lets the upgrade through with the right ?token=', async () => {
    const host = await asrServer()
    const first = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://${host}/api/asr?token=t1`)
      ws.on('message', (data: Buffer) => {
        resolve(data.toString())
        ws.close()
      })
      ws.on('error', reject)
    })
    expect(JSON.parse(first)).toEqual({ type: 'unavailable', reason: 'model_missing' })
  })
})

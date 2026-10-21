import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { createUtleServer } from './app.ts'
import { attachAsr } from './asr.ts'
import type { DecoderHost } from './asrWorker.ts'
import { LOCAL_USER, profileId, upgradeAuthorized } from './auth.ts'

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

describe('profiles per token (round 7, HOST lane)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'utle-app-profiles-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const writeProfile = (id: string): void => {
    mkdirSync(join(dir, 'profiles'), { recursive: true })
    writeFileSync(join(dir, 'profiles', `${id}.json`), JSON.stringify({ version: 1, model: 'm', embedding: [1, 0], rms: 0.1, seconds: 8 }))
  }

  it('says in /api/status which profile the token is, and whether its voice is learnt', async () => {
    writeProfile(profileId('tb'))
    const host = await serve({ UTLE_TOKEN: 'ralf:ta,mari:tb', UTLE_DATA_DIR: dir })
    const status = async (token: string): Promise<unknown> => (await (await fetch(`http://${host}/api/status`, { headers: { authorization: `Bearer ${token}` } })).json()) as unknown
    expect(await status('ta')).toMatchObject({ auth: 'on', profile: { name: 'ralf', enrolled: false } })
    expect(await status('tb')).toMatchObject({ auth: 'on', profile: { name: 'mari', enrolled: true, seconds: 8 } })
  })

  it('names the local profile when the server is open', async () => {
    const host = await serve({})
    expect(await (await fetch(`http://${host}/api/status`)).json()).toMatchObject({ auth: 'off', profile: { name: LOCAL_USER.name } })
  })

  it('logs how many of the configured profiles are enrolled at start, not the state of owner.json', async () => {
    writeProfile(profileId('tb'))
    const lines: string[] = []
    const info = vi.spyOn(console, 'info').mockImplementation((line: string) => {
      lines.push(line)
    })
    const host: DecoderHost = { where: 'thread', ms: 0, speaker: { model: true, profile: false }, open: () => ({ accept: () => ({ text: '', endpoint: false }), reset: () => undefined, close: () => undefined }), onExit: () => undefined }
    try {
      await listen(createUtleServer({ root: '.', env: { UTLE_TOKEN: 'ralf:ta,mari:tb', UTLE_DATA_DIR: dir }, startWorker: () => Promise.resolve({ ok: true, host }) }))
      await new Promise((resolve) => setTimeout(resolve, 400))
    } finally {
      info.mockRestore()
    }
    expect(lines).toContain('[asr] speaker model loaded; 2 profiles, 1 enrolled')
  })

  it('opens each socket on its own token\'s profile', async () => {
    const opened: (string | undefined)[] = []
    const decoder = { accept: () => ({ text: '', endpoint: false }), reset: () => undefined, close: () => undefined }
    const host: DecoderHost = {
      where: 'thread',
      ms: 0,
      speaker: { model: false, profile: false },
      open: (profile) => {
        opened.push(profile)
        return decoder
      },
      onExit: () => undefined,
    }
    const address = await listen(createUtleServer({ root: '.', env: { UTLE_TOKEN: 'ralf:ta,mari:tb', UTLE_DATA_DIR: dir }, startWorker: () => Promise.resolve({ ok: true, host }) }))
    const ready = (token: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://${address}/api/asr?token=${token}`)
        ws.on('message', () => {
          ws.close()
          resolve()
        })
        ws.on('error', reject)
      })
    await ready('ta')
    await ready('tb')
    expect(opened).toEqual([join(dir, 'profiles', `${profileId('ta')}.json`), join(dir, 'profiles', `${profileId('tb')}.json`)])
  })
})

import type { IntentRequest } from '../../src/core/pageIntent.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ASR_URL, authHeaders, connectionFrom, serverCheck, serverStatus, socketAddress } from './connection.ts'
import { ENOUGH_PHRASES, asrAddress, askIntent, enrolledLine, foreignNotice, serverUrl } from './offscreenMain.ts'

describe('the server address (27.3)', () => {
  it('derives the http base from a ws address and https from wss', () => {
    expect(serverUrl('ws://localhost:5173/api/asr', '/api/status')).toBe('http://localhost:5173/api/status')
    expect(serverUrl('wss://utle.up.railway.app/api/asr', '/api/intent')).toBe('https://utle.up.railway.app/api/intent')
    expect(serverUrl('wss://utle.example:8443/api/asr', '/api/status')).toBe('https://utle.example:8443/api/status')
  })

  it('never carries the socket query (the token, the engine) into an http address', () => {
    const socket = socketAddress(asrAddress('wss://h.example/api/asr', 'soniox'), 's3cret')
    expect(socket).toBe('wss://h.example/api/asr?engine=soniox&token=s3cret')
    expect(serverUrl(socket, '/api/status')).toBe('https://h.example/api/status')
  })

  it('puts the token on the socket only when there is one, escaped', () => {
    expect(socketAddress('ws://localhost:5173/api/asr', '')).toBe('ws://localhost:5173/api/asr')
    expect(socketAddress('wss://h.example/api/asr', 'a+b/c')).toBe('wss://h.example/api/asr?token=a%2Bb%2Fc')
  })

  it('sends the token as a bearer header, and no header without one', () => {
    expect(authHeaders('t1')).toEqual({ Authorization: 'Bearer t1' })
    expect(authHeaders('')).toEqual({})
  })
})

describe('the server settings (27.3)', () => {
  it('reads the address and the token with defaults', () => {
    expect(connectionFrom({})).toEqual({ asrUrl: DEFAULT_ASR_URL, token: '' })
    expect(connectionFrom({ asrUrl: '', serverToken: '' })).toEqual({ asrUrl: DEFAULT_ASR_URL, token: '' })
    expect(connectionFrom({ asrUrl: ' wss://h.example/api/asr ', serverToken: ' t1 ' })).toEqual({ asrUrl: 'wss://h.example/api/asr', token: 't1' })
    expect(connectionFrom({ asrUrl: 42, serverToken: null })).toEqual({ asrUrl: DEFAULT_ASR_URL, token: '' })
  })

  it('falls back to the default for an address that is not a websocket address', () => {
    expect(connectionFrom({ asrUrl: 'not an address' }).asrUrl).toBe(DEFAULT_ASR_URL)
    expect(connectionFrom({ asrUrl: 'https://h.example/api/asr' }).asrUrl).toBe(DEFAULT_ASR_URL)
  })
})

describe('the status with a token (27.3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const answer = (status: number, body: unknown) => vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(body), { status })))

  it('sends the token and reads what the server has', async () => {
    const fetchMock = answer(200, { intent: 'live', speech: { local: true, soniox: false }, auth: 'on' })
    vi.stubGlobal('fetch', fetchMock)
    expect(await serverCheck('https://h.example/api/status', 't1')).toEqual({ state: 'live', speech: { local: true, soniox: false } })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer t1')
  })

  it('says bad_token for a 401, no_key and unreachable as before', async () => {
    vi.stubGlobal('fetch', answer(401, { error: { code: 'unauthorized' } }))
    expect(await serverStatus('https://h.example/api/status', 'wrong')).toBe('bad_token')
    vi.stubGlobal('fetch', answer(200, { intent: 'no_key' }))
    expect(await serverStatus('https://h.example/api/status', '')).toBe('no_key')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network'))))
    expect(await serverStatus('https://h.example/api/status', '')).toBe('unreachable')
    vi.stubGlobal('fetch', answer(500, {}))
    expect(await serverStatus('https://h.example/api/status', '')).toBe('unreachable')
  })

  it('sends the token on /api/intent and treats a 401 as no model', async () => {
    const request: IntentRequest = { lang: 'et', utterance: 'ava', page: { url: '', title: '', box: { present: false, text: '', armed: false }, items: [], media: null, hints: false }, tabs: [], recent: [] }
    const fetchMock = answer(401, { error: { code: 'unauthorized' } })
    vi.stubGlobal('fetch', fetchMock)
    const result = await askIntent('https://h.example/api/intent', request, undefined, 't1')
    expect(result).toEqual({ error: 'no_model' })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer t1')
  })
})

describe('strict mode lines on the strip (round 7)', () => {
  const text = { foreign: 'Keegi teine rääkis, jätsin vahele.', foreignRetrain: 'Kui see olid sina, õpeta hääl uuesti seadetes.' }
  it('strict mode: says who spoke at every drop, and the third drop message once', () => {
    expect([1, 2, 3, 4, 5].map((streak) => foreignNotice(streak, text))).toEqual([
      { foreign: text.foreign },
      { foreign: text.foreign },
      { foreign: text.foreign, line: text.foreignRetrain },
      { foreign: text.foreign },
      { foreign: text.foreign },
    ])
  })

  it('says how many phrases taught the voice, and when they were too few', () => {
    const lines = { enrolDone: 'done', enrolFailed: 'failed', enrolPhrasesDone: (n: number) => `done ${n}`, enrolFew: (n: number, enough: number) => `few ${n}/${enough}` }
    expect(enrolledLine(false, 12, lines)).toBe('failed')
    expect(enrolledLine(true, undefined, lines)).toBe('done')
    expect(enrolledLine(true, 12, lines)).toBe('done 12')
    expect(enrolledLine(true, ENOUGH_PHRASES, lines)).toBe(`done ${ENOUGH_PHRASES}`)
    expect(enrolledLine(true, ENOUGH_PHRASES - 1, lines)).toBe(`few ${ENOUGH_PHRASES - 1}/${ENOUGH_PHRASES}`)
  })
})

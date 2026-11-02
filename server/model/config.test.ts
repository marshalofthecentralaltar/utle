import { describe, expect, it } from 'vitest'
import { DEFAULT_CAREFUL_MODEL, DEFAULT_MODEL, ModelConfigError, modelConfig, parseModelSpec, specLabel } from './config.ts'
import { modelFromEnv, modelStatus } from './index.ts'

describe('the model configuration string (30.5.2)', () => {
  it('anthropic:x is Anthropic with ANTHROPIC_API_KEY', () => {
    expect(parseModelSpec('anthropic:claude-sonnet-5-5', 'UTLE_MODEL', { ANTHROPIC_API_KEY: 'k' })).toEqual({ kind: 'anthropic', provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'k' })
  })

  it('a bare id without a colon stays Anthropic, so every earlier UTLE_MODEL keeps working', () => {
    expect(parseModelSpec('claude-sonnet-5-5', 'UTLE_MODEL', {})).toEqual({ kind: 'anthropic', provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: undefined })
    expect(parseModelSpec('  claude-opus-5-5 ', 'UTLE_MODEL', {})).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' })
  })

  it('deepseek:x reads DEEPSEEK_API_KEY and the DeepSeek base URL; fireworks and openrouter likewise', () => {
    expect(parseModelSpec('deepseek:deepseek-flash', 'UTLE_MODEL', { DEEPSEEK_API_KEY: 'dk' })).toEqual({ kind: 'openai', provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey: 'dk' })
    expect(parseModelSpec('fireworks:accounts/fireworks/models/deepseek-v4p1-flash', 'UTLE_FALLBACK', { FIREWORKS_API_KEY: 'fk' })).toMatchObject({ provider: 'fireworks', model: 'accounts/fireworks/models/deepseek-v4p1-flash', baseUrl: 'https://api.fireworks.ai/inference/v1', apiKey: 'fk' })
    expect(parseModelSpec('openrouter:deepseek/deepseek-v4.1-flash', 'UTLE_MODEL', { OPENROUTER_API_KEY: 'ok' })).toMatchObject({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'ok' })
  })

  it('openai:x takes the URL and the key of its slot', () => {
    expect(parseModelSpec('openai:glm-5.3-flash', 'UTLE_MODEL', { UTLE_MODEL_URL: 'https://host.test/v1', UTLE_MODEL_KEY: 'mk' })).toEqual({ kind: 'openai', provider: 'openai', model: 'glm-5.3-flash', baseUrl: 'https://host.test/v1', apiKey: 'mk' })
    expect(parseModelSpec('openai:m', 'UTLE_FALLBACK', { UTLE_FALLBACK_URL: 'https://f.test/v1', UTLE_FALLBACK_KEY: 'fk' })).toMatchObject({ baseUrl: 'https://f.test/v1', apiKey: 'fk' })
  })

  it('rejects an unknown provider with a message naming it and the known ones', () => {
    expect(() => parseModelSpec('mistral:large', 'UTLE_MODEL', {})).toThrow(ModelConfigError)
    expect(() => parseModelSpec('mistral:large', 'UTLE_MODEL', {})).toThrow('UTLE_MODEL=mistral:large: unknown provider "mistral" (known: anthropic, deepseek, fireworks, openrouter, openai).')
  })

  it('a provider without its key, openai without its URL, or no model after the colon fails with the variable named', () => {
    expect(() => parseModelSpec('deepseek:deepseek-flash', 'UTLE_MODEL', {})).toThrow("UTLE_MODEL=deepseek:deepseek-flash needs DEEPSEEK_API_KEY in the server's environment.")
    expect(() => parseModelSpec('openai:m', 'UTLE_FALLBACK', { UTLE_FALLBACK_KEY: 'k' })).toThrow('needs UTLE_FALLBACK_URL')
    expect(() => parseModelSpec('openai:m', 'UTLE_MODEL', { UTLE_MODEL_URL: 'https://h' })).toThrow('needs UTLE_MODEL_KEY')
    expect(() => parseModelSpec('deepseek:', 'UTLE_MODEL', { DEEPSEEK_API_KEY: 'k' })).toThrow('no model after the provider')
  })

  it('UTLE_MODEL unset or empty is the default; UTLE_FALLBACK unset or empty is none', () => {
    for (const env of [{}, { UTLE_MODEL: '' }, { UTLE_MODEL: '  ', UTLE_FALLBACK: '' }]) {
      const config = modelConfig(env)
      expect(specLabel(config.primary)).toBe(`anthropic:${DEFAULT_MODEL}`)
      expect(config.fallback).toBeNull()
    }
    expect(DEFAULT_MODEL).toBe('claude-sonnet-5-5')
  })
})

describe('round 10 (#7, 33.1): the careful slot', () => {
  it('UTLE_MODEL_CAREFUL is a slot of its own: same syntax, openai takes UTLE_MODEL_CAREFUL_URL and _KEY', () => {
    expect(parseModelSpec('anthropic:claude-opus-5-5', 'UTLE_MODEL_CAREFUL', { ANTHROPIC_API_KEY: 'k' })).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' })
    expect(parseModelSpec('openai:m', 'UTLE_MODEL_CAREFUL', { UTLE_MODEL_CAREFUL_URL: 'https://c.test/v1', UTLE_MODEL_CAREFUL_KEY: 'ck' })).toMatchObject({ baseUrl: 'https://c.test/v1', apiKey: 'ck' })
    expect(specLabel(modelConfig({ UTLE_MODEL_CAREFUL: 'anthropic:claude-opus-5-5' }).careful)).toBe('anthropic:claude-opus-5-5')
  })

  it('both unset: the default pair; UTLE_MODEL set and UTLE_MODEL_CAREFUL unset: careful is the quick model', () => {
    const unset = modelConfig({})
    expect(specLabel(unset.primary)).toBe(`anthropic:${DEFAULT_MODEL}`)
    expect(specLabel(unset.careful)).toBe(`anthropic:${DEFAULT_CAREFUL_MODEL}`)
    for (const env of [{ UTLE_MODEL: 'deepseek:deepseek-flash', DEEPSEEK_API_KEY: 'dk' }, { UTLE_MODEL: 'deepseek:deepseek-flash', DEEPSEEK_API_KEY: 'dk', UTLE_MODEL_CAREFUL: ' ' }]) {
      const config = modelConfig(env)
      expect(specLabel(config.careful)).toBe('deepseek:deepseek-flash')
      expect(config.careful).toEqual(config.primary)
    }
  })

  it('an unknown provider or a missing key in the careful slot stops the start, naming UTLE_MODEL_CAREFUL', () => {
    expect(() => modelFromEnv({ ANTHROPIC_API_KEY: 'k', UTLE_MODEL_CAREFUL: 'nope:x' })).toThrow('UTLE_MODEL_CAREFUL=nope:x: unknown provider "nope"')
    expect(() => modelFromEnv({ ANTHROPIC_API_KEY: 'k', UTLE_MODEL_CAREFUL: 'deepseek:deepseek-flash' })).toThrow("UTLE_MODEL_CAREFUL=deepseek:deepseek-flash needs DEEPSEEK_API_KEY in the server's environment.")
    expect(() => modelFromEnv({ ANTHROPIC_API_KEY: 'k', UTLE_MODEL_CAREFUL: 'openai:m', UTLE_MODEL_CAREFUL_KEY: 'k' })).toThrow('needs UTLE_MODEL_CAREFUL_URL')
  })

  it('a careful slot without its key stops the start when the quick slot can answer; with no key at all the rules answer, as before', () => {
    const env = { UTLE_MODEL: 'deepseek:deepseek-flash', DEEPSEEK_API_KEY: 'dk', UTLE_MODEL_CAREFUL: 'anthropic:claude-opus-5-5' }
    expect(() => modelConfig(env)).toThrow(ModelConfigError)
    expect(() => modelFromEnv(env)).toThrow("UTLE_MODEL_CAREFUL=anthropic:claude-opus-5-5 needs ANTHROPIC_API_KEY in the server's environment.")
    expect(specLabel(modelConfig({ ...env, ANTHROPIC_API_KEY: 'k' }).careful)).toBe('anthropic:claude-opus-5-5')
    // A fallback with its key answers for the careful slot as it does for the quick one (30.5).
    expect(specLabel(modelConfig({ ...env, UTLE_FALLBACK: 'fireworks:f', FIREWORKS_API_KEY: 'fk' }).careful)).toBe('anthropic:claude-opus-5-5')
    // No key anywhere: the server starts and only the rules answer.
    expect(modelFromEnv({ UTLE_MODEL_CAREFUL: 'anthropic:claude-opus-5-5' }).ready).toBe(false)
  })

  it('the status names both models; each has its own last', () => {
    const configured = modelFromEnv({ ANTHROPIC_API_KEY: 'k', UTLE_MODEL: 'anthropic:claude-haiku-5-5', UTLE_MODEL_CAREFUL: 'anthropic:claude-opus-5-5' })
    expect(modelStatus(configured)).toEqual({ primary: 'anthropic:claude-haiku-5-5', careful: 'anthropic:claude-opus-5-5', fallback: null, last: null, lastCareful: null })
  })

  it('the fallback rules apply to each slot: a fast failure of the careful model goes to UTLE_FALLBACK, a timeout does not', async () => {
    const sent: string[] = []
    let failNext = 1
    const fakeFetch = (async (input: string | URL | Request) => {
      sent.push(String(input))
      if (failNext > 0) {
        failNext -= 1
        return new Response('{}', { status: 503 })
      }
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 })
    }) as typeof fetch
    const env = { UTLE_MODEL: 'deepseek:deepseek-flash', UTLE_MODEL_CAREFUL: 'openrouter:deepseek/deepseek-v4.1-flash', UTLE_FALLBACK: 'fireworks:f', DEEPSEEK_API_KEY: 'dk', OPENROUTER_API_KEY: 'ok', FIREWORKS_API_KEY: 'fk' }
    const configured = modelFromEnv(env, { fetch: fakeFetch })
    const ask = { system: 's', user: 'u', tools: [{ name: 'answer', description: '', schema: {} }], maxTokens: 10, timeoutMs: 1000 }
    const reply = await configured.careful.ask(ask)
    expect(reply.provider).toBe('fireworks')
    expect(sent).toEqual(['https://openrouter.ai/api/v1/chat/completions', 'https://api.fireworks.ai/inference/v1/chat/completions'])
    expect(modelStatus(configured)).toMatchObject({ last: null, lastCareful: 'fallback' })
    // The quick slot is a model of its own: it asks DeepSeek first.
    await configured.model.ask(ask)
    expect(sent[2]).toBe('https://api.deepseek.com/chat/completions')
    expect(modelStatus(configured)).toMatchObject({ last: 'primary', lastCareful: 'fallback' })

    const timing = modelFromEnv(env, { fetch: (async () => Promise.reject(new DOMException('The operation was aborted.', 'TimeoutError'))) as typeof fetch })
    await expect(timing.careful.ask(ask)).rejects.toMatchObject({ kind: 'timeout' })
    expect(modelStatus(timing).lastCareful).toBeNull()
  })
})

describe('modelFromEnv and the status fields', () => {
  it('reports primary, fallback and last (null before any ask)', () => {
    const configured = modelFromEnv({ UTLE_MODEL: 'claude-sonnet-5-5', ANTHROPIC_API_KEY: 'k', UTLE_FALLBACK: 'deepseek:deepseek-flash', DEEPSEEK_API_KEY: 'dk' })
    expect(modelStatus(configured)).toEqual({ primary: 'anthropic:claude-sonnet-5-5', careful: 'anthropic:claude-sonnet-5-5', fallback: 'deepseek:deepseek-flash', last: null, lastCareful: null })
    expect(configured.ready).toBe(true)
  })

  it('ready is false only when no slot has a key', () => {
    expect(modelFromEnv({}).ready).toBe(false)
    expect(modelFromEnv({ UTLE_FALLBACK: 'deepseek:deepseek-flash', DEEPSEEK_API_KEY: 'dk' }).ready).toBe(true)
    expect(modelFromEnv({ UTLE_MODEL: 'deepseek:deepseek-flash', DEEPSEEK_API_KEY: 'dk' }).ready).toBe(true)
  })

  it('throws the configuration error for a bad slot, the fallback slot too', () => {
    expect(() => modelFromEnv({ UTLE_MODEL: 'deepseek:deepseek-flash' })).toThrow('needs DEEPSEEK_API_KEY')
    expect(() => modelFromEnv({ ANTHROPIC_API_KEY: 'k', UTLE_FALLBACK: 'nope:x' })).toThrow('UTLE_FALLBACK=nope:x: unknown provider')
  })

  it('a configured DeepSeek model asks through fetch with its key, and last follows the answer', async () => {
    const sent: string[] = []
    const fakeFetch = (async (input: string | URL | Request) => {
      sent.push(String(input))
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 })
    }) as typeof fetch
    const configured = modelFromEnv({ UTLE_MODEL: 'deepseek:deepseek-flash', DEEPSEEK_API_KEY: 'dk' }, { fetch: fakeFetch })
    const reply = await configured.model.ask({ system: 's', user: 'u', tools: [{ name: 'answer', description: '', schema: {} }], maxTokens: 10, timeoutMs: 1000 })
    expect(reply.provider).toBe('deepseek')
    expect(sent).toEqual(['https://api.deepseek.com/chat/completions'])
    expect(modelStatus(configured).last).toBe('primary')
  })
})

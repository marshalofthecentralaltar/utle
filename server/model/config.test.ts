import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL, ModelConfigError, modelConfig, parseModelSpec, specLabel } from './config.ts'
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

describe('modelFromEnv and the status fields', () => {
  it('reports primary, fallback and last (null before any ask)', () => {
    const configured = modelFromEnv({ UTLE_MODEL: 'claude-sonnet-5-5', ANTHROPIC_API_KEY: 'k', UTLE_FALLBACK: 'deepseek:deepseek-flash', DEEPSEEK_API_KEY: 'dk' })
    expect(modelStatus(configured)).toEqual({ primary: 'anthropic:claude-sonnet-5-5', fallback: 'deepseek:deepseek-flash', last: null })
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

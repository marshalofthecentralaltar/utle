import { describe, expect, it } from 'vitest'
import { withFallback } from './fallback.ts'
import { ModelError, NO_USAGE } from './types.ts'
import type { Model, ModelAsk, ModelReplyNeutral } from './types.ts'

const ASK: ModelAsk = { system: 's', user: 'u', tools: [{ name: 'answer', description: '', schema: {} }], maxTokens: 400, timeoutMs: 7000 }

const ok = (provider: string): ModelReplyNeutral => ({ call: { id: 'c', name: 'answer', input: {} }, stop: 'tool', usage: NO_USAGE, provider, model: `${provider}-1`, ms: 1 })

function fake(provider: string, ...queue: Array<ModelReplyNeutral | Error>): Model & { calls: number } {
  const model = {
    calls: 0,
    ask: async (): Promise<ModelReplyNeutral> => {
      model.calls += 1
      const next = queue.shift()
      if (!next) throw new Error(`${provider}: nothing queued`)
      if (next instanceof Error) throw next
      return next
    },
  }
  return model
}

describe('withFallback (plan 4.2: fast failures only)', () => {
  it('a healthy primary answers; the fallback is never asked; last is primary', async () => {
    const primary = fake('anthropic', ok('anthropic'))
    const fallback = fake('deepseek')
    const model = withFallback(primary, fallback)
    expect(model.last()).toBeNull()
    expect((await model.ask(ASK)).provider).toBe('anthropic')
    expect(fallback.calls).toBe(0)
    expect(model.last()).toBe('primary')
  })

  const fast: Array<[string, ModelError | ModelReplyNeutral]> = [
    ['401', new ModelError('no_key', 'anthropic', 'no_key', 401)],
    ['403', new ModelError('no_key', 'anthropic', 'no_key', 403)],
    ['429', new ModelError('busy', 'anthropic', 'busy', 429)],
    ['500', new ModelError('busy', 'anthropic', 'busy', 500)],
    ['529', new ModelError('busy', 'anthropic', 'busy', 529)],
    ['connection refused', new ModelError('unreachable', 'anthropic', 'unreachable')],
    ['a refusal', { ...ok('anthropic'), stop: 'refusal', call: null }],
  ]
  for (const [name, failure] of fast) {
    it(`runs the fallback after ${name}, which answers; last is fallback`, async () => {
      const primary = fake('anthropic', failure)
      const fallback = fake('deepseek', ok('deepseek'))
      const model = withFallback(primary, fallback)
      const reply = await model.ask(ASK)
      expect(reply.provider).toBe('deepseek')
      expect(primary.calls).toBe(1)
      expect(fallback.calls).toBe(1)
      expect(model.last()).toBe('fallback')
    })
  }

  it('never runs the fallback on a timeout: the timeout is thrown as it was', async () => {
    const timeout = new ModelError('timeout', 'anthropic', 'slow')
    const fallback = fake('deepseek', ok('deepseek'))
    const model = withFallback(fake('anthropic', timeout), fallback)
    await expect(model.ask(ASK)).rejects.toBe(timeout)
    expect(fallback.calls).toBe(0)
    expect(model.last()).toBeNull()
  })

  it('never runs the fallback on another rejection (400) or on an error that is not a ModelError', async () => {
    for (const error of [new ModelError('rejected', 'anthropic', 'bad', 400), new Error('a bug')]) {
      const fallback = fake('deepseek', ok('deepseek'))
      await expect(withFallback(fake('anthropic', error), fallback).ask(ASK)).rejects.toBe(error)
      expect(fallback.calls).toBe(0)
    }
  })

  it('a cut or text reply of the primary is its answer, not a reason to ask again', async () => {
    for (const stop of ['cut', 'text'] as const) {
      const fallback = fake('deepseek', ok('deepseek'))
      const reply = await withFallback(fake('anthropic', { ...ok('anthropic'), stop, call: null }), fallback).ask(ASK)
      expect(reply.stop).toBe(stop)
      expect(fallback.calls).toBe(0)
    }
  })

  it('the fallback failing too throws its own error; last stays as it was', async () => {
    const fallbackError = new ModelError('no_key', 'deepseek', 'no_key', 401)
    const model = withFallback(fake('anthropic', ok('anthropic'), new ModelError('busy', 'anthropic', 'busy', 429)), fake('deepseek', fallbackError))
    await model.ask(ASK)
    await expect(model.ask(ASK)).rejects.toBe(fallbackError)
    expect(model.last()).toBe('primary')
  })

  it('without a fallback, a fast failure is thrown and a refusal is returned', async () => {
    const busy = new ModelError('busy', 'anthropic', 'busy', 429)
    await expect(withFallback(fake('anthropic', busy), null).ask(ASK)).rejects.toBe(busy)
    const refusal = { ...ok('anthropic'), stop: 'refusal' as const, call: null }
    expect((await withFallback(fake('anthropic', refusal), null).ask(ASK)).stop).toBe('refusal')
  })

  it('after a fallback answer the next ask tries the primary first again', async () => {
    const primary = fake('anthropic', new ModelError('busy', 'anthropic', 'busy', 503), ok('anthropic'))
    const model = withFallback(primary, fake('deepseek', ok('deepseek')))
    await model.ask(ASK)
    expect(model.last()).toBe('fallback')
    expect((await model.ask(ASK)).provider).toBe('anthropic')
    expect(model.last()).toBe('primary')
    expect(primary.calls).toBe(2)
  })
})

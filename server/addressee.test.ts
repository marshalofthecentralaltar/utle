import { describe, expect, it } from 'vitest'
import { addresseeAnswer, addresseeAsk } from './addressee.ts'
import { InterpretError } from './interpret.ts'
import { ModelError, NO_USAGE } from './model/types.ts'
import type { Model, ModelAsk, ModelReplyNeutral } from './model/types.ts'

const REQUEST = { lang: 'et', utterance: 'kas sa tuled ka poodi', finals: ['tere', 'kuidas läheb'], page: { url: 'https://web.whatsapp.com/', title: 'WhatsApp', box: { present: true, armed: true } } }

const replying = (input: unknown, seen: ModelAsk[] = []): Model => ({
  ask: (ask) => {
    seen.push(ask)
    const reply: ModelReplyNeutral = { call: { id: '1', name: 'verdict', input }, stop: 'tool', usage: NO_USAGE, provider: 'fake', model: 'm', ms: 1 }
    return Promise.resolve(reply)
  },
})

describe('POST /api/addressee (round 10, 32.3)', () => {
  it('one quick ask with the sentence, the earlier finals and the page; the verdict comes back', async () => {
    const seen: ModelAsk[] = []
    const answer = await addresseeAnswer(REQUEST, { model: replying({ verdict: 'ignore' }, seen) })
    expect(answer.verdict).toBe('ignore')
    expect(seen).toHaveLength(1)
    expect(JSON.parse(seen[0]?.user ?? '{}')).toEqual({ page: REQUEST.page, earlier: REQUEST.finals, sentence: REQUEST.utterance, language: 'et' })
    expect(addresseeAsk(REQUEST as Parameters<typeof addresseeAsk>[0]).effort).toBe('low')
  })

  it('round 10 (#7): the answer budget leaves room for a model that thinks before the call (Haiku 5.5 cut off at 60)', () => {
    expect(addresseeAsk(REQUEST as Parameters<typeof addresseeAsk>[0]).maxTokens).toBe(400)
  })

  it('a reply of the wrong shape is an error, never a guess; a malformed request is a 400', async () => {
    await expect(addresseeAnswer(REQUEST, { model: replying({ verdict: 'maybe' }) })).rejects.toBeInstanceOf(InterpretError)
    await expect(addresseeAnswer({ ...REQUEST, finals: ['a', 'b', 'c', 'd'] }, { model: replying({ verdict: 'ignore' }) })).rejects.toMatchObject({ code: 'bad_request' })
    const failing: Model = { ask: () => Promise.reject(new ModelError('timeout', 'fake', 'slow')) }
    await expect(addresseeAnswer(REQUEST, { model: failing })).rejects.toMatchObject({ code: 'timeout' })
  })
})

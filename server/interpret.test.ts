import Anthropic from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SAMPLE_DOC } from '../src/core/document.ts'
import type { InterpretRequest } from '../src/core/intent.ts'
import { InterpretError, interpret } from './interpret.ts'
import type { MessagesClient, ModelReply } from './interpret.ts'

type CreateParams = Parameters<MessagesClient['messages']['create']>[0]

function toolCall(name: string, input: unknown, id = 'toolu_1'): ModelReply {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] }
}

/** A client that answers with queued replies (or throws queued errors) and records every call. */
function fakeClient(...queue: Array<ModelReply | Error>): { client: MessagesClient; calls: CreateParams[] } {
  const calls: CreateParams[] = []
  const client: MessagesClient = {
    messages: {
      create: async (params) => {
        calls.push(structuredClone(params))
        const next = queue.shift()
        if (!next) throw new Error('fake client: no reply queued')
        if (next instanceof Error) throw next
        return next
      },
    },
  }
  return { client, calls }
}

function request(overrides: Partial<InterpretRequest> = {}): InterpretRequest {
  return { doc: SAMPLE_DOC, utterance: 'Change the budget deadline to Friday.', pending: null, choice: null, ...overrides }
}

const FRIDAY_CALL = toolCall('propose_edit', {
  summary: 'Budget: Thursday becomes Friday.',
  ops: [{ op: 'replace_text', block_id: 'b6', find: 'Thursday', replace: 'Friday' }],
})

function lastUserText(params: CreateParams): string {
  const first = params.messages[0]
  if (!first || typeof first.content !== 'string') throw new Error('expected the first message to be a string')
  return first.content
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('interpret', () => {
  it('turns a valid propose_edit call into an intent with one model call', async () => {
    const { client, calls } = fakeClient(FRIDAY_CALL)
    const intent = await interpret(request(), { client, model: 'm' })
    expect(intent).toEqual({
      kind: 'propose_edit',
      summary: 'Budget: Thursday becomes Friday.',
      ops: [{ op: 'replace_text', blockId: 'b6', find: 'Thursday', replace: 'Friday' }],
    })
    expect(calls).toHaveLength(1)
  })

  it('maps every op and intent shape from the tool input', async () => {
    const { client } = fakeClient(
      toolCall('propose_edit', {
        summary: 's',
        ops: [
          { op: 'insert_block', after_block_id: 'b8', block_type: 'li', text: 'New item.' },
          { op: 'move_blocks', block_ids: ['b9', 'b10'], before_block_id: 'b7' },
          { op: 'set_text', block_id: 'b10', text: 'No open risks.' },
          { op: 'delete_block', block_id: 'b2' },
        ],
      }),
      toolCall('navigate', { block_id: 'b3', read_aloud: true }),
      toolCall('not_understood', { message: 'Say that again.' }),
    )
    const deps = { client, model: 'm' }
    const edit = await interpret(request(), deps)
    expect(edit.kind === 'propose_edit' && edit.ops.map((o) => o.op)).toEqual([
      'insert_block',
      'move_blocks',
      'set_text',
      'delete_block',
    ])
    expect(await interpret(request(), deps)).toEqual({ kind: 'navigate', blockId: 'b3', readAloud: true })
    expect(await interpret(request(), deps)).toEqual({ kind: 'not_understood', message: 'Say that again.' })
  })

  it('forces exactly one call to one of four strict tools', async () => {
    const { client, calls } = fakeClient(FRIDAY_CALL)
    await interpret(request(), { client, model: 'claude-haiku-4-5' })
    const params = calls[0]
    expect(params?.model).toBe('claude-haiku-4-5')
    expect(params?.tool_choice).toEqual({ type: 'any', disable_parallel_tool_use: true })
    const tools = params?.tools ?? []
    const names = tools.map((t) => ('name' in t ? t.name : ''))
    expect(names.sort()).toEqual(['ask_which', 'navigate', 'not_understood', 'propose_edit'])
    for (const tool of tools) expect('strict' in tool && tool.strict).toBe(true)
  })

  it('sends the document with numbers and ids, and the utterance', async () => {
    const { client, calls } = fakeClient(FRIDAY_CALL)
    await interpret(request(), { client, model: 'm' })
    const text = lastUserText(calls[0] as CreateParams)
    expect(text).toContain('#6 id=b6 p: Spending is within plan.')
    expect(text).toContain('#3 id=b3 h2: Summary')
    expect(text).toContain('Change the budget deadline to Friday.')
  })

  it('sends the pending proposal when the utterance is a repair', async () => {
    const { client, calls } = fakeClient(FRIDAY_CALL)
    await interpret(
      request({
        utterance: 'Not Friday. Monday.',
        pending: {
          summary: 'Budget: Thursday becomes Friday.',
          ops: [{ op: 'replace_text', blockId: 'b6', find: 'Thursday', replace: 'Friday' }],
        },
      }),
      { client, model: 'm' },
    )
    const text = lastUserText(calls[0] as CreateParams)
    expect(text).toContain('Budget: Thursday becomes Friday.')
    expect(text).toContain('"replace":"Friday"')
    expect(text).toContain('Not Friday. Monday.')
  })

  it('sends the question and the picked candidate when the utterance is an answer', async () => {
    const { client, calls } = fakeClient(FRIDAY_CALL)
    await interpret(
      request({
        utterance: 'Shorten the sentence about the supplier.',
        choice: {
          utterance: 'Shorten the sentence about the supplier.',
          candidates: [
            { blockId: 'b4', quote: 'The pilot with the first supplier went live on 28 September.' },
            { blockId: 'b10', quote: 'The second supplier has not confirmed a start date.' },
          ],
          picked: 1,
        },
      }),
      { client, model: 'm' },
    )
    const text = lastUserText(calls[0] as CreateParams)
    expect(text).toContain('2. id=b10 "The second supplier has not confirmed a start date."')
    expect(text).toContain('The user chose candidate 2')
  })

  it('retries once with the error when the find text is not unique, then succeeds', async () => {
    const ambiguous = toolCall(
      'propose_edit',
      { summary: 's', ops: [{ op: 'replace_text', block_id: 'b4', find: 'supplier', replace: 'vendor' }] },
      'toolu_bad',
    )
    const { client, calls } = fakeClient(ambiguous, FRIDAY_CALL)
    const intent = await interpret(request(), { client, model: 'm' })
    expect(intent.kind).toBe('propose_edit')
    expect(calls).toHaveLength(2)
    const retry = calls[1]?.messages ?? []
    expect(retry).toHaveLength(3)
    expect(retry[1]?.role).toBe('assistant')
    const feedback = retry[2]?.content
    if (!Array.isArray(feedback)) throw new Error('expected the retry feedback to be a block list')
    const block = feedback[0]
    expect(block).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_bad', is_error: true })
    expect(JSON.stringify(block)).toContain('find_ambiguous')
  })

  it('gives not_understood after two failures and makes exactly two calls', async () => {
    const bad = toolCall('propose_edit', {
      summary: 's',
      ops: [{ op: 'replace_text', block_id: 'b6', find: 'Monday', replace: 'Friday' }],
    })
    const { client, calls } = fakeClient(bad, bad)
    const intent = await interpret(request(), { client, model: 'm' })
    expect(intent.kind).toBe('not_understood')
    expect(calls).toHaveLength(2)
  })

  it('catches an unknown block id, a one-candidate question and a quote that is not in the block', async () => {
    const cases = [
      toolCall('navigate', { block_id: 'zz', read_aloud: false }),
      toolCall('ask_which', { question: 'Which?', candidates: [{ block_id: 'b4', quote: 'The pilot' }] }),
      toolCall('ask_which', {
        question: 'Which?',
        candidates: [
          { block_id: 'b4', quote: 'The pilot' },
          { block_id: 'b10', quote: 'words that are not there' },
        ],
      }),
      toolCall('propose_edit', { summary: 's', ops: [] }),
      toolCall('no_such_tool', {}),
      toolCall('propose_edit', { summary: 's' }),
    ]
    for (const bad of cases) {
      const { client, calls } = fakeClient(bad, FRIDAY_CALL)
      const intent = await interpret(request(), { client, model: 'm' })
      expect(intent.kind).toBe('propose_edit')
      expect(calls).toHaveLength(2)
    }
  })

  it('gives not_understood when the model makes no tool call, refuses, or runs out of tokens', async () => {
    const replies: ModelReply[] = [
      { stop_reason: 'end_turn', content: [{ type: 'text' }] },
      { stop_reason: 'refusal', content: [] },
      { stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 't', name: 'propose_edit', input: {} }] },
    ]
    for (const reply of replies) {
      const { client, calls } = fakeClient(reply)
      expect((await interpret(request(), { client, model: 'm' })).kind).toBe('not_understood')
      expect(calls).toHaveLength(1)
    }
  })

  it('rejects a malformed request without calling the model', async () => {
    const { client, calls } = fakeClient(FRIDAY_CALL)
    await expect(interpret({ utterance: 'x' }, { client, model: 'm' })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(interpret(request({ utterance: '   ' }), { client, model: 'm' })).rejects.toBeInstanceOf(InterpretError)
    expect(calls).toHaveLength(0)
  })

  it('maps SDK errors to codes', async () => {
    const cases: Array<[Error, string]> = [
      [new Anthropic.APIConnectionTimeoutError(), 'timeout'],
      [new Anthropic.APIConnectionError({ message: 'offline' }), 'upstream_unavailable'],
      [Anthropic.APIError.generate(429, undefined, 'slow down', new Headers()), 'upstream_unavailable'],
      [Anthropic.APIError.generate(500, undefined, 'boom', new Headers()), 'upstream_unavailable'],
      [Anthropic.APIError.generate(400, undefined, 'bad', new Headers()), 'upstream_rejected'],
      [Anthropic.APIError.generate(401, undefined, 'no key', new Headers()), 'upstream_rejected'],
      [new Error('something else'), 'upstream_unavailable'],
    ]
    for (const [error, code] of cases) {
      const { client } = fakeClient(error)
      await expect(interpret(request(), { client, model: 'm' })).rejects.toMatchObject({ code })
    }
  })

  it('never logs document text or the utterance', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    const bad = toolCall('propose_edit', {
      summary: 's',
      ops: [{ op: 'replace_text', block_id: 'b6', find: 'Monday', replace: 'Friday' }],
    })
    const { client } = fakeClient(bad, FRIDAY_CALL)
    await interpret(request(), { client, model: 'm' })
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n')
    expect(logged).not.toContain('Spending is within plan')
    expect(logged).not.toContain('budget deadline')
    expect(logged).not.toContain('Thursday')
  })
})

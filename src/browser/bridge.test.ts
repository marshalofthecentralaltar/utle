import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRIDGE_TIMED_OUT } from '../core/browserIntent.ts'
import { createBridge } from './bridge.ts'
import type { BridgeWindow } from './bridge.ts'
import { BRIDGE_APP, BRIDGE_COMMAND_TIMEOUT_MS, BRIDGE_EXTENSION, BRIDGE_TIMEOUT_MS } from './protocol.ts'
import type { BridgeRequest, BrowserResult } from './protocol.ts'

/**
 * A window with no DOM: records what the page posts and lets the test answer.
 * With answerPings, an extension is present and answers every ping at once.
 */
function fakeWindow(opts: { answerPings: boolean }) {
  const listeners = new Set<(event: { data: unknown }) => void>()
  const posted: BridgeRequest[] = []
  const deliver = (data: unknown): void => [...listeners].forEach((listener) => listener({ data }))
  const win: BridgeWindow = {
    location: { origin: 'http://localhost:5182' },
    postMessage(message, origin) {
      expect(origin).toBe('http://localhost:5182')
      const request = message as BridgeRequest
      posted.push(request)
      if (opts.answerPings && request.command.kind === 'ping') {
        queueMicrotask(() => deliver({ source: BRIDGE_EXTENSION, id: request.id, result: { ok: true } }))
      }
    },
    addEventListener(_type, listener) {
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
  }
  const commands = (): BridgeRequest[] => posted.filter((r) => r.command.kind !== 'ping')
  const pings = (): BridgeRequest[] => posted.filter((r) => r.command.kind === 'ping')
  return { win, posted, commands, pings, deliver, listeners }
}

/** Lets queued microtasks (the ping answer, then the command post) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

function settledFlag(promise: Promise<BrowserResult>): { done: boolean } {
  const flag = { done: false }
  void promise.then(() => (flag.done = true))
  return flag
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('bridge client', () => {
  it('pings first, then posts the command', async () => {
    const { win, posted, commands } = fakeWindow({ answerPings: true })
    void createBridge(win).sendCommand({ kind: 'newTab' })
    expect(posted[0]?.command).toEqual({ kind: 'ping' })
    await flush()
    expect(commands()[0]?.source).toBe(BRIDGE_APP)
    expect(commands()[0]?.command).toEqual({ kind: 'newTab' })
  })

  it('resolves with the answer that carries the same id', async () => {
    const { win, commands, deliver } = fakeWindow({ answerPings: true })
    const bridge = createBridge(win)
    const first = bridge.sendCommand({ kind: 'newTab' })
    await flush()
    const second = bridge.sendCommand({ kind: 'reload' })
    await flush()
    const [a, b] = commands().map((r) => r.id)
    expect(a).not.toBe(b)
    deliver({ source: BRIDGE_EXTENSION, id: b, result: { ok: true, tab: { title: 'Reloaded', url: 'https://x' } } })
    deliver({ source: BRIDGE_EXTENSION, id: a, result: { ok: true, tab: { title: 'New Tab', url: 'chrome://newtab' } } })
    await expect(first).resolves.toEqual({ ok: true, tab: { title: 'New Tab', url: 'chrome://newtab' } })
    await expect(second).resolves.toEqual({ ok: true, tab: { title: 'Reloaded', url: 'https://x' } })
  })

  it('a slow command answered at 5 s resolves ok', async () => {
    const { win, commands, deliver } = fakeWindow({ answerPings: true })
    const pending = createBridge(win).sendCommand({ kind: 'goTo', url: 'https://www.messenger.com/' })
    await flush()
    const flag = settledFlag(pending)
    vi.advanceTimersByTime(5000)
    await flush()
    expect(flag.done).toBe(false)
    deliver({ source: BRIDGE_EXTENSION, id: commands()[0]?.id, result: { ok: true, tab: { title: 'Messenger', url: 'x' } } })
    await expect(pending).resolves.toEqual({ ok: true, tab: { title: 'Messenger', url: 'x' } })
  })

  it('no ping answer: no_extension at 1.5 s and the command is never posted', async () => {
    const { win, commands, listeners } = fakeWindow({ answerPings: false })
    const pending = createBridge(win).sendCommand({ kind: 'openConversation', name: 'Mari' })
    const flag = settledFlag(pending)
    vi.advanceTimersByTime(BRIDGE_TIMEOUT_MS - 1)
    await flush()
    expect(flag.done).toBe(false)
    vi.advanceTimersByTime(1)
    const result = await pending
    expect(!result.ok && result.code).toBe('no_extension')
    await flush()
    expect(commands()).toEqual([])
    expect(listeners.size).toBe(0)
  })

  it('no command answer: failed, marked as timed out, at 20 s', async () => {
    const { win, commands } = fakeWindow({ answerPings: true })
    const pending = createBridge(win).sendCommand({ kind: 'insertText', text: 'Tere', submit: true })
    await flush()
    expect(commands()).toHaveLength(1)
    const flag = settledFlag(pending)
    vi.advanceTimersByTime(BRIDGE_COMMAND_TIMEOUT_MS - 1)
    await flush()
    expect(flag.done).toBe(false)
    vi.advanceTimersByTime(1)
    await expect(pending).resolves.toEqual({ ok: false, code: 'failed', message: BRIDGE_TIMED_OUT })
  })

  it('a second command after a good first one posts no extra ping', async () => {
    const { win, commands, pings, deliver } = fakeWindow({ answerPings: true })
    const bridge = createBridge(win)
    const first = bridge.sendCommand({ kind: 'newTab' })
    await flush()
    deliver({ source: BRIDGE_EXTENSION, id: commands()[0]?.id, result: { ok: true } })
    await first
    void bridge.sendCommand({ kind: 'reload' })
    await flush()
    expect(pings()).toHaveLength(1)
    expect(commands().map((r) => r.command.kind)).toEqual(['newTab', 'reload'])
  })

  it('checks again with a ping after a command failed', async () => {
    const { win, commands, pings } = fakeWindow({ answerPings: true })
    const bridge = createBridge(win)
    const first = bridge.sendCommand({ kind: 'reload' })
    await flush()
    vi.advanceTimersByTime(BRIDGE_COMMAND_TIMEOUT_MS)
    await first
    void bridge.sendCommand({ kind: 'reload' })
    await flush()
    expect(pings()).toHaveLength(2)
    expect(commands()).toHaveLength(2)
  })

  it('ping itself uses the short timeout and is posted once', async () => {
    const { win, posted } = fakeWindow({ answerPings: false })
    const pending = createBridge(win).sendCommand({ kind: 'ping' })
    vi.advanceTimersByTime(BRIDGE_TIMEOUT_MS)
    const result = await pending
    expect(!result.ok && result.code).toBe('no_extension')
    expect(posted).toHaveLength(1)
  })

  it('ignores foreign and malformed messages, its own request echoed back, and unknown ids', async () => {
    const { win, commands, deliver } = fakeWindow({ answerPings: true })
    const pending = createBridge(win).sendCommand({ kind: 'closeTab' })
    await flush()
    const request = commands()[0]
    if (!request) throw new Error('no command posted')
    const flag = settledFlag(pending)
    deliver(request) // window.postMessage also reaches the page's own listener
    deliver({ source: 'someone-else', id: request.id, result: { ok: true } })
    deliver({ source: BRIDGE_EXTENSION, id: request.id + 1000, result: { ok: true } })
    deliver({ source: BRIDGE_EXTENSION, id: request.id })
    deliver({ source: BRIDGE_EXTENSION, id: request.id, result: { ok: 'maybe' } })
    deliver('a string')
    deliver(null)
    await flush()
    expect(flag.done).toBe(false)
    deliver({ source: BRIDGE_EXTENSION, id: request.id, result: { ok: false, code: 'not_allowed', message: 'chrome page' } })
    await expect(pending).resolves.toEqual({ ok: false, code: 'not_allowed', message: 'chrome page' })
  })

  it('a late answer after the timeout changes nothing', async () => {
    const { win, commands, deliver } = fakeWindow({ answerPings: true })
    const pending = createBridge(win).sendCommand({ kind: 'reload' })
    await flush()
    vi.advanceTimersByTime(BRIDGE_COMMAND_TIMEOUT_MS)
    deliver({ source: BRIDGE_EXTENSION, id: commands()[0]?.id, result: { ok: true } })
    const result = await pending
    expect(!result.ok && result.code).toBe('failed')
  })
})

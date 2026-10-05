import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBridge } from './bridge.ts'
import type { BridgeWindow } from './bridge.ts'
import { BRIDGE_APP, BRIDGE_EXTENSION, BRIDGE_TIMEOUT_MS } from './protocol.ts'
import type { BridgeRequest } from './protocol.ts'

/** A window with no DOM: records what the page posts and lets the test answer. */
function fakeWindow() {
  const listeners = new Set<(event: { data: unknown }) => void>()
  const posted: Array<{ message: unknown; origin: string }> = []
  const win: BridgeWindow = {
    location: { origin: 'http://localhost:5182' },
    postMessage(message, origin) {
      posted.push({ message, origin })
    },
    addEventListener(_type, listener) {
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
  }
  const deliver = (data: unknown): void => listeners.forEach((listener) => listener({ data }))
  return { win, posted, deliver, listeners }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('bridge client', () => {
  it('posts a BridgeRequest to its own origin', () => {
    const { win, posted } = fakeWindow()
    void createBridge(win).sendCommand({ kind: 'newTab' })
    expect(posted).toHaveLength(1)
    const request = posted[0]?.message as BridgeRequest
    expect(request.source).toBe(BRIDGE_APP)
    expect(request.command).toEqual({ kind: 'newTab' })
    expect(typeof request.id).toBe('number')
    expect(posted[0]?.origin).toBe('http://localhost:5182')
  })

  it('resolves with the answer that carries the same id', async () => {
    const { win, posted, deliver } = fakeWindow()
    const bridge = createBridge(win)
    const first = bridge.sendCommand({ kind: 'newTab' })
    const second = bridge.sendCommand({ kind: 'reload' })
    const [a, b] = posted.map((p) => (p.message as BridgeRequest).id)
    expect(a).not.toBe(b)
    deliver({ source: BRIDGE_EXTENSION, id: b, result: { ok: true, tab: { title: 'Reloaded', url: 'https://x' } } })
    deliver({ source: BRIDGE_EXTENSION, id: a, result: { ok: true, tab: { title: 'New Tab', url: 'chrome://newtab' } } })
    await expect(first).resolves.toEqual({ ok: true, tab: { title: 'New Tab', url: 'chrome://newtab' } })
    await expect(second).resolves.toEqual({ ok: true, tab: { title: 'Reloaded', url: 'https://x' } })
  })

  it('ignores foreign and malformed messages, its own request echoed back, and unknown ids', async () => {
    const { win, posted, deliver } = fakeWindow()
    const pending = createBridge(win).sendCommand({ kind: 'closeTab' })
    const request = posted[0]?.message as BridgeRequest
    let settled = false
    void pending.then(() => (settled = true))
    deliver(request) // window.postMessage also reaches the page's own listener
    deliver({ source: 'someone-else', id: request.id, result: { ok: true } })
    deliver({ source: BRIDGE_EXTENSION, id: request.id + 1000, result: { ok: true } })
    deliver({ source: BRIDGE_EXTENSION, id: request.id })
    deliver({ source: BRIDGE_EXTENSION, id: request.id, result: { ok: 'maybe' } })
    deliver('a string')
    deliver(null)
    await Promise.resolve()
    expect(settled).toBe(false)
    deliver({ source: BRIDGE_EXTENSION, id: request.id, result: { ok: false, code: 'not_allowed', message: 'chrome page' } })
    await expect(pending).resolves.toEqual({ ok: false, code: 'not_allowed', message: 'chrome page' })
  })

  it('resolves no_extension when nobody answers in time', async () => {
    const { win, listeners } = fakeWindow()
    const pending = createBridge(win).sendCommand({ kind: 'ping' })
    vi.advanceTimersByTime(BRIDGE_TIMEOUT_MS - 1)
    let settled = false
    void pending.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    vi.advanceTimersByTime(1)
    const result = await pending
    expect(result.ok).toBe(false)
    expect(!result.ok && result.code).toBe('no_extension')
    expect(listeners.size).toBe(0)
  })

  it('a late answer after the timeout changes nothing', async () => {
    const { win, posted, deliver } = fakeWindow()
    const pending = createBridge(win).sendCommand({ kind: 'ping' })
    vi.advanceTimersByTime(BRIDGE_TIMEOUT_MS)
    const request = posted[0]?.message as BridgeRequest
    deliver({ source: BRIDGE_EXTENSION, id: request.id, result: { ok: true } })
    const result = await pending
    expect(!result.ok && result.code).toBe('no_extension')
  })
})

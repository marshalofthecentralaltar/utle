import { BRIDGE_APP, BRIDGE_EXTENSION, BRIDGE_TIMEOUT_MS } from './protocol.ts'
import type { BridgeRequest, BrowserCommand, BrowserResult } from './protocol.ts'

/**
 * The page's side of the bridge (docs/ARCHITECTURE.md section 20.3). Posts a BridgeRequest on
 * the window and resolves the BridgeResponse with the same id. Never rejects: no answer in time
 * is no_extension. The window and the timers are injected, so it is tested without a DOM.
 */

/** The part of window the bridge uses. */
export interface BridgeWindow {
  location: { origin: string }
  postMessage(message: unknown, targetOrigin: string): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

export interface BridgeTimers {
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface Bridge {
  sendCommand(command: BrowserCommand): Promise<BrowserResult>
}

const FAILURES = new Set(['no_extension', 'no_target', 'not_found', 'not_allowed', 'failed'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A BrowserResult, or null when the value is not one. */
function asResult(value: unknown): BrowserResult | null {
  if (!isRecord(value)) return null
  if (value.ok === true) {
    const result: BrowserResult = { ok: true }
    const tab = value.tab
    if (isRecord(tab) && typeof tab.title === 'string' && typeof tab.url === 'string') result.tab = { title: tab.title, url: tab.url }
    if (typeof value.hints === 'number') result.hints = value.hints
    return result
  }
  if (value.ok === false && typeof value.code === 'string' && FAILURES.has(value.code)) {
    const code = value.code as Extract<BrowserResult, { ok: false }>['code']
    return { ok: false, code, message: typeof value.message === 'string' ? value.message : '' }
  }
  return null
}

const realTimers: BridgeTimers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createBridge(win: BridgeWindow, timers: BridgeTimers = realTimers): Bridge {
  // Ids start somewhere random, so two pages open at once do not answer each other's requests.
  let nextId = Math.floor(Math.random() * 1_000_000) + 1

  return {
    sendCommand(command) {
      const id = nextId
      nextId += 1
      return new Promise<BrowserResult>((resolve) => {
        let timer: unknown = null
        const finish = (result: BrowserResult): void => {
          win.removeEventListener('message', listener)
          if (timer !== null) timers.clearTimeout(timer)
          resolve(result)
        }
        const listener = (event: { data: unknown }): void => {
          const data = event.data
          if (!isRecord(data) || data.source !== BRIDGE_EXTENSION || data.id !== id) return
          const result = asResult(data.result)
          if (result) finish(result)
        }
        win.addEventListener('message', listener)
        timer = timers.setTimeout(
          () => finish({ ok: false, code: 'no_extension', message: 'No answer from the Ütle extension.' }),
          BRIDGE_TIMEOUT_MS,
        )
        const request: BridgeRequest = { source: BRIDGE_APP, id, command }
        win.postMessage(request, win.location.origin)
      })
    },
  }
}

let shared: Bridge | null = null

/** Sends one command through the bridge on this page's window. */
export function sendCommand(command: BrowserCommand): Promise<BrowserResult> {
  shared ??= createBridge(window)
  return shared.sendCommand(command)
}

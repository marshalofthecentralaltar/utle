import { BRIDGE_APP, BRIDGE_EXTENSION } from './protocol.ts'
import type { BridgeResponse, BrowserCommand, BrowserResult } from './protocol.ts'
import type { BridgeWindow } from './bridge.ts'

/** What the fake answers: success, with a plausible tab for commands that show one. */
function fakeResult(command: BrowserCommand): BrowserResult {
  switch (command.kind) {
    case 'goTo':
      return { ok: true, tab: { title: /messenger/.test(command.url) ? 'Messenger' : command.url, url: command.url } }
    case 'newTab':
      return { ok: true, tab: { title: 'Uus vaheleht', url: 'chrome://newtab/' } }
    case 'openConversation':
      return { ok: true, tab: { title: command.name, url: 'https://www.messenger.com/' } }
    case 'showHints':
      return { ok: true, hints: 12 }
    default:
      return { ok: true }
  }
}

/**
 * An in-page stand-in for the extension, for demos without it (`?bridge=fake`).
 * Answers every BridgeRequest with success after a short delay. Returns a function that removes it.
 */
export function installFakeBridge(win: BridgeWindow, delayMs = 250): () => void {
  const listener = (event: { data: unknown }): void => {
    const data = event.data
    if (typeof data !== 'object' || data === null) return
    const request = data as { source?: unknown; id?: unknown; command?: unknown }
    if (request.source !== BRIDGE_APP || typeof request.id !== 'number' || typeof request.command !== 'object' || request.command === null) return
    const response: BridgeResponse = { source: BRIDGE_EXTENSION, id: request.id, result: fakeResult(request.command as BrowserCommand) }
    globalThis.setTimeout(() => win.postMessage(response, win.location.origin), delayMs)
  }
  win.addEventListener('message', listener)
  return () => win.removeEventListener('message', listener)
}

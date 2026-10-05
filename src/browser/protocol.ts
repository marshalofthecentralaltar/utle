/**
 * The contract between the Ütle page and the Ütle browser extension.
 *
 * The page cannot open tabs or touch other sites. It posts a BridgeRequest on its own window;
 * the extension's content script on the Ütle page relays it to the extension and posts the
 * BridgeResponse back. Commands act on the active tab of the last focused ordinary browser
 * window, never on the window that shows Ütle.
 */

export const BRIDGE_APP = 'utle-app'
export const BRIDGE_EXTENSION = 'utle-extension'

/** How long the page waits for an answer before it decides no extension is installed. */
export const BRIDGE_TIMEOUT_MS = 1500

export type BrowserCommand =
  /** Answers at once. Tells the page the extension is there. */
  | { kind: 'ping' }
  | { kind: 'newTab'; url?: string }
  | { kind: 'closeTab' }
  /** index is 1-based, left to right. query matches a tab's title or address, case-insensitive. */
  | { kind: 'switchTab'; to: 'next' | 'previous' | { index: number } | { query: string } }
  /** A full address, scheme included. The page turns site names into addresses. */
  | { kind: 'goTo'; url: string }
  | { kind: 'history'; direction: 'back' | 'forward' }
  | { kind: 'reload' }
  | { kind: 'scroll'; direction: 'up' | 'down' | 'top' | 'bottom' }
  /** Puts a number on everything clickable or typeable that is visible. Answers with how many. */
  | { kind: 'showHints' }
  | { kind: 'hideHints' }
  /** Clicks the numbered element (a text field is focused instead) and removes the numbers. */
  | { kind: 'clickHint'; number: number }
  /** On a messaging site, opens the conversation whose name best matches. */
  | { kind: 'openConversation'; name: string }
  /** Types into the focused text field, or the page's message box. submit presses Enter after. */
  | { kind: 'insertText'; text: string; submit: boolean }

export type BrowserFailure = 'no_extension' | 'no_target' | 'not_found' | 'not_allowed' | 'failed'

export type BrowserResult =
  | { ok: true; tab?: { title: string; url: string }; hints?: number }
  | { ok: false; code: BrowserFailure; message: string }

/** Posted by the page with window.postMessage(request, window.location.origin). */
export interface BridgeRequest {
  source: typeof BRIDGE_APP
  id: number
  command: BrowserCommand
}

/** Posted back by the extension's content script, with the id of the request it answers. */
export interface BridgeResponse {
  source: typeof BRIDGE_EXTENSION
  id: number
  result: BrowserResult
}

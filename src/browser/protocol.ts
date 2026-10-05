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

/** How long the page waits for any command other than ping, which may load a page or a conversation first. */
export const BRIDGE_COMMAND_TIMEOUT_MS = 20_000

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
  /** mode page (default) is 80% of the view; little a third; slow a steady 90 px/s until stop or another scroll; stop ends a slow scroll. */
  | { kind: 'scroll'; direction: 'up' | 'down' | 'top' | 'bottom'; mode?: ScrollMode }
  /** Puts a number on everything clickable or typeable that is visible. Answers with how many. */
  | { kind: 'showHints' }
  | { kind: 'hideHints' }
  /** Clicks the numbered element (a text field is focused instead) and removes the numbers. */
  | { kind: 'clickHint'; number: number }
  /** On a messaging site, opens the conversation whose name best matches. */
  | { kind: 'openConversation'; name: string }
  /** Types into the focused text field, or the page's message box. submit presses Enter after. */
  | { kind: 'insertText'; text: string; submit: boolean }
  /** Reads the page's message box (the focused text field, else the site's message box). Answers with box. */
  | { kind: 'readBox' }
  /** Replaces everything in the message box with text and leaves the caret at the end. Answers with box. */
  | { kind: 'setText'; text: string }
  /** Sends what is in the message box (Enter, else the site's send button). Fails when the box is empty. */
  | { kind: 'pressSend' }
  // M7 (docs/plans/2026-10-05-m7-understanding.md): what is on the page, and acting on it by meaning.
  /** Answers page: what is on the page in front, for the model. The page keeps the items' elements by id until the next readPage. */
  | { kind: 'readPage' }
  /** Clicks an item of the last readPage; a text field is focused and armed for dictation instead. */
  | { kind: 'clickItem'; id: number }
  /** Focuses the item's text field and arms it for dictation. */
  | { kind: 'focusItem'; id: number }
  /** Types the query into the site's own search field and presses Enter. Arms nothing. */
  | { kind: 'siteSearch'; query: string }
  /** Acts on the largest visible video or audio element. */
  | { kind: 'media'; action: MediaAction }
  /** A key on the focused element. */
  | { kind: 'pressKey'; key: PressableKey; times?: number }
  // M8 (round 3): editing inside the armed box, like a keyboard would.
  /** Moves the caret inside the armed or focused field. find: the first match before or after the caret (case-insensitive), the caret lands before or after it. */
  | { kind: 'caret'; to: CaretTarget }
  /** Selects inside the armed or focused field; typeText or Backspace then act on the selection. */
  | { kind: 'select'; what: SelectTarget }
  /** Types text at the caret (replacing a selection), without touching the rest of the field. */
  | { kind: 'typeText'; text: string }
  /** Empties the focused or armed field, whichever it is. */
  | { kind: 'clearField' }
  /** Marks the focused field as the dictation target ("kirjuta siia"), or releases it. */
  | { kind: 'arm'; on: boolean }
  /** Hides the strip to a small microphone pill, or shows it again. Every tab follows. */
  | { kind: 'bar'; show: boolean }

export type ScrollMode = 'page' | 'little' | 'slow' | 'stop'

export type PressableKey =
  | 'Escape'
  | 'Enter'
  | 'Tab'
  | 'Backspace'
  | 'Delete'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'
  | 'Undo'
  | 'Redo'
  | 'SelectAll'

export type CaretTarget =
  | 'start'
  | 'end'
  | 'lineStart'
  | 'lineEnd'
  | 'sentenceStart'
  | 'sentenceEnd'
  | 'wordBack'
  | 'wordForward'
  | { find: string; where: 'before' | 'after' }

export type SelectTarget = 'all' | 'word' | 'sentence' | 'line' | 'lastWord' | 'lastSentence' | { find: string }

export type MediaAction =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'mute'
  | 'unmute'
  | 'volumeUp'
  | 'volumeDown'
  | 'fullscreen'
  | 'exitFullscreen'
  | 'forward'
  | 'back'

/** One visible actionable element of the page, as the model sees it (readPage). */
export interface PageItem {
  id: number
  /** link, button, field, tab, option, row, other. */
  role: string
  /** Its visible text or label, at most 60 characters. */
  text: string
}

export interface MediaState {
  playing: boolean
  muted: boolean
  /** 0 to 1. */
  volume: number
  fullscreen: boolean
}

/** What is on the page in front, as readPage answers it. */
export interface PageContext {
  url: string
  title: string
  box: BoxState
  items: PageItem[]
  media: MediaState | null
  /** True while numbered labels show. */
  hints: boolean
}

/**
 * The message box of the page in front. present is false when the page has no text field to write in.
 * armed is true only where dictation may go (M7): the site's own composer, or a field the user picked
 * through Ütle. A field the page focused by itself is present and not armed.
 */
export interface BoxState {
  present: boolean
  text: string
  armed: boolean
  /** composer, search, field or none: what kind of box it is, for the model and the strip. */
  kind?: 'composer' | 'search' | 'field' | 'none'
  /** The field's label or placeholder, at most 60 characters. */
  label?: string
}

export type BrowserFailure = 'no_extension' | 'no_target' | 'not_found' | 'not_allowed' | 'failed'

export type BrowserResult =
  | { ok: true; tab?: { title: string; url: string }; hints?: number; box?: BoxState; page?: PageContext }
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

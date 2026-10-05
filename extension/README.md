# Ütle extension

## Install

1. Start Ütle: `npm run dev` (it serves http://localhost:5173).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose this `extension/` folder.
5. Pin the Ütle icon. Clicking it docks Ütle on the left and moves the browser window to the right.
6. If Ütle runs at another address, set it under the extension's **Details → Extension options**.

## Commands (src/browser/protocol.ts)

`ping`, `newTab {url?}`, `closeTab`, `switchTab {to: next | previous | {index} | {query}}`, `goTo {url}`,
`history {back | forward}`, `reload`, `scroll {up | down | top | bottom}`, `showHints`, `hideHints`,
`clickHint {number}`, `openConversation {name}`, `insertText {text, submit}`.

They act on the active tab of the last focused ordinary browser window that is not Ütle's window.
Only the page at the configured Ütle origin gets answers. Messenger selectors and its home address
live in `sites.js`. `openConversation` from any other site first switches to a Messenger tab in the
window, or opens https://www.messenger.com/ in the target tab.

## Test

`npx tsx extension/test/run.ts` from the repository root. It opens Playwright's Chromium windows
on screen for about half a minute (headless Chromium crashes with the extension loaded).

## Unverified

- Real Messenger: every selector in `sites.js` is a best guess; nobody has tried it logged in.
- Whether Messenger sends on a synthetic Enter (it is not a trusted key press); the send-button
  click is the fallback.
- Branded Google Chrome (tested in Playwright's bundled Chromium only).
- A real person using it by voice, and the dock on a multi-monitor or scaled display.

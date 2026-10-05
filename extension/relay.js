// Content script on the Ütle page. Relays BridgeRequests (src/browser/protocol.ts) to the
// service worker and posts the BridgeResponse back. Ignores every other message.

const BRIDGE_APP = 'utle-app'
const BRIDGE_EXTENSION = 'utle-extension'

function isBridgeRequest(data) {
  return (
    data !== null &&
    typeof data === 'object' &&
    data.source === BRIDGE_APP &&
    typeof data.id === 'number' &&
    data.command !== null &&
    typeof data.command === 'object' &&
    typeof data.command.kind === 'string'
  )
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (!isBridgeRequest(data)) return

  const reply = (result) => {
    window.postMessage({ source: BRIDGE_EXTENSION, id: data.id, result }, window.location.origin)
  }

  chrome.runtime.sendMessage({ type: 'utle-command', command: data.command }).then(
    (answer) => {
      // The service worker answers { ignored: true } when this page is not the Ütle page.
      if (answer && answer.result) reply(answer.result)
    },
    (error) => {
      reply({ ok: false, code: 'failed', message: `The extension did not answer: ${String(error && error.message ? error.message : error)}` })
    },
  )
})

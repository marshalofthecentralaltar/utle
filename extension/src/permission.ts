// The microphone permission page (docs/ARCHITECTURE.md 21.2). An offscreen document cannot ask,
// so this extension page asks once, tells the service worker, and closes itself.
import { STRINGS } from '../../src/core/strings.ts'
import type { ToBackground } from './messages.ts'

const text = STRINGS.et.strip
const title = document.getElementById('title')
const status = document.getElementById('status')
const retry = document.getElementById('retry')
if (title) title.textContent = text.permissionTitle
if (retry) retry.textContent = text.permissionRetry
document.title = text.permissionTitle

async function ask(): Promise<void> {
  if (status) status.textContent = text.permissionAsk
  if (retry) retry.hidden = true
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
  } catch {
    if (status) status.textContent = text.micBlocked
    if (retry) retry.hidden = false
    return
  }
  if (status) status.textContent = text.permissionDone
  const message: ToBackground = { type: 'utle-mic-granted' }
  await chrome.runtime.sendMessage(message).catch(() => undefined)
  const tab = await chrome.tabs.getCurrent()
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id)
  else window.close()
}

retry?.addEventListener('click', () => {
  void ask()
})
void ask()

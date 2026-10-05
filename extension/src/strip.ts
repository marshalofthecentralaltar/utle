// The strip (docs/ARCHITECTURE.md 21.2): a content script on every http and https page. A bar
// across the bottom of the viewport in a closed shadow root: the microphone target, the words
// heard, one line of what was done. It renders the state the service worker keeps in
// chrome.storage.session, so every tab's strip shows the same thing.

import { STRINGS } from '../../src/core/strings.ts'
import { createDwell } from '../../src/ui/dwell.ts'
import { bottomBox } from './box.ts'
import { INITIAL_STATE, STATE_KEY } from './messages.ts'
import type { StripMeasure, StripState, ToBackground, ToStrip } from './messages.ts'
import { SITES, siteOf } from './sites.ts'
import type { SiteName } from './sites.ts'

export const STRIP_HEIGHT = 128
const MIC_SIZE = 104
const text = STRINGS.et.strip

const CSS = `
:host { all: initial; }
.bar { position: fixed; left: 0; right: 0; bottom: 0; height: ${STRIP_HEIGHT}px; box-sizing: border-box;
  display: flex; align-items: center; gap: 16px; padding: 8px 16px; background: #111; color: #fff;
  border-top: 4px solid #ffd400; font-family: system-ui, "Segoe UI", sans-serif; z-index: 2147483647; }
.mic { position: relative; flex: none; width: ${MIC_SIZE}px; height: ${MIC_SIZE}px; box-sizing: border-box;
  border-radius: 16px; border: 4px solid #fff; background: transparent; color: #fff; cursor: pointer; overflow: hidden;
  font: 700 18px/1.1 system-ui, "Segoe UI", sans-serif; padding: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; }
.mic[data-state="listening"] { background: #00c853; border-color: #00c853; color: #000; }
.mic[data-state="resting"] { background: #2962ff; border-color: #2962ff; color: #fff; }
.mic:focus-visible { outline: 4px solid #ffd400; outline-offset: 2px; }
.dot { width: 28px; height: 28px; border-radius: 50%; border: 4px solid currentColor; box-sizing: border-box; }
.mic[data-state="listening"] .dot { background: #000; }
.label, .dot { position: relative; z-index: 1; }
.fill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: #ffd400; opacity: .85; }
.mic.dwelling .fill { height: 100%; transition: height 1s linear; }
.words { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.heard { font: 700 26px/1.2 system-ui, "Segoe UI", sans-serif; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 31px; }
.line { font: 500 20px/1.25 system-ui, "Segoe UI", sans-serif; color: #ffd400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.line.problem { color: #000; background: #ff8a80; padding: 2px 8px; border-radius: 6px; font-weight: 700; }
`

const ROOM_CSS = `html { height: calc(100% - ${STRIP_HEIGHT}px) !important; padding-bottom: ${STRIP_HEIGHT}px !important; box-sizing: content-box !important; }`

function micState(state: StripState): 'listening' | 'resting' | 'off' {
  if (!state.listening) return 'off'
  return state.resting ? 'resting' : 'listening'
}

function micLabel(state: StripState): string {
  const s = micState(state)
  return s === 'listening' ? text.listening : s === 'resting' ? text.resting : text.notListening
}

export function mountStrip(): void {
  for (const old of document.querySelectorAll('utle-strip')) old.remove()
  document.getElementById('utle-room')?.remove()

  const host = document.createElement('utle-strip')
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = CSS
  const bar = document.createElement('div')
  bar.className = 'bar'
  const mic = document.createElement('button')
  mic.type = 'button'
  mic.className = 'mic'
  mic.setAttribute('aria-label', text.micLabel)
  const fill = document.createElement('span')
  fill.className = 'fill'
  const dot = document.createElement('span')
  dot.className = 'dot'
  const label = document.createElement('span')
  label.className = 'label'
  mic.append(fill, dot, label)
  const words = document.createElement('div')
  words.className = 'words'
  const heard = document.createElement('div')
  heard.className = 'heard'
  heard.setAttribute('aria-live', 'polite')
  const line = document.createElement('div')
  line.className = 'line'
  line.setAttribute('role', 'status')
  words.append(heard, line)
  bar.append(mic, words)
  root.append(style, bar)

  const room = document.createElement('style')
  room.id = 'utle-room'
  room.textContent = ROOM_CSS
  ;(document.head ?? document.documentElement).append(room)
  document.documentElement.append(host)

  let state: StripState = INITIAL_STATE
  const render = (): void => {
    mic.dataset.state = micState(state)
    mic.setAttribute('aria-pressed', String(state.listening))
    label.textContent = micLabel(state)
    heard.textContent = state.heard
    const problem = state.problem !== ''
    line.textContent = problem ? state.problem : state.line
    line.classList.toggle('problem', problem)
  }
  render()

  const toggle = (): void => {
    const message: ToBackground = { type: 'utle-toggle' }
    chrome.runtime.sendMessage(message).catch(() => undefined)
  }
  const dwell = createDwell({
    onFire: toggle,
    onChange: (dwelling) => mic.classList.toggle('dwelling', dwelling),
  })
  mic.addEventListener('pointerenter', () => dwell.enter())
  mic.addEventListener('pointerleave', () => dwell.leave())
  // Pressing the control must not take focus from the site's message box.
  mic.addEventListener('mousedown', (event) => event.preventDefault())
  mic.addEventListener('click', () => {
    if (dwell.click()) toggle()
  })

  const read = (): void => {
    chrome.storage.session.get(STATE_KEY).then(
      (stored) => {
        const value = stored[STATE_KEY] as StripState | undefined
        if (value) {
          state = { ...INITIAL_STATE, ...value }
          render()
        }
      },
      () => undefined,
    )
  }
  read()
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes[STATE_KEY]) return
    const value = changes[STATE_KEY].newValue as StripState | undefined
    state = { ...INITIAL_STATE, ...value }
    render()
  })
  // A tab that comes back to the front shows the state as it is now.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') read()
  })
  // A page restored from the back/forward cache missed the changes made while it was away.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) read()
  })

  // Making room: a full-height app built on 100vh is shrunk so its message box sits above the strip.
  let site: SiteName | null = null
  chrome.storage.local.get(['siteOverrides', 'messagingHome']).then(
    (stored) => {
      const overrides = stored.siteOverrides && typeof stored.siteOverrides === 'object' ? (stored.siteOverrides as Record<string, SiteName>) : {}
      const home = typeof stored.messagingHome === 'string' ? stored.messagingHome : null
      site = siteOf(location.href, { siteOverrides: overrides, messagingHome: home })
      fitApp()
    },
    () => undefined,
  )
  const fitApp = (): void => {
    const box = bottomBox(site === null ? null : SITES[site])
    if (!box) return
    const limit = window.innerHeight - STRIP_HEIGHT
    if (box.getBoundingClientRect().bottom <= limit + 1) return
    let pick: HTMLElement | null = null
    for (let el = box.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const r = el.getBoundingClientRect()
      if (Math.abs(r.height - window.innerHeight) <= 2 && r.top <= 1) pick = el
    }
    if (!pick) return
    pick.style.setProperty('height', `calc(100vh - ${STRIP_HEIGHT}px)`, 'important')
    pick.style.setProperty('max-height', `calc(100vh - ${STRIP_HEIGHT}px)`, 'important')
  }
  // A page that rewrites its document can take the strip with it: put it back.
  const stay = (): void => {
    if (!host.isConnected) document.documentElement.append(host)
    if (!room.isConnected) (document.head ?? document.documentElement).append(room)
  }
  setInterval(() => {
    stay()
    fitApp()
  }, 1000)

  // For the tests: where the strip and the microphone are, and what they show.
  chrome.runtime.onMessage.addListener((message: ToStrip, _sender, reply) => {
    if (!message || message.type !== 'utle-strip-measure') return false
    const box = (el: Element): StripMeasure['strip'] => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    }
    const answer: StripMeasure = { strip: box(bar), mic: box(mic), micState: mic.dataset.state ?? '', heard: heard.textContent ?? '', heardPx: parseFloat(getComputedStyle(heard).fontSize), line: line.textContent ?? '' }
    reply(answer)
    return false
  })
}

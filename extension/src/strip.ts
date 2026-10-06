// The strip (docs/ARCHITECTURE.md 21.2): a content script on every http and https page. A bar
// across the bottom of the viewport in a closed shadow root: the microphone target, the words
// heard, one line of what was done, and two small controls (hide, settings). Folded ("peida
// riba") it is a round microphone pill in the bottom-right corner. It renders the state the
// service worker keeps in chrome.storage.session, so every tab's strip shows the same thing, and
// reads its own look (height, microphone side) from chrome.storage.local, set on the options page.

import { STRINGS } from '../../src/core/strings.ts'
import { createDwell } from '../../src/ui/dwell.ts'
import { createGaze, GAZE_OFF_MS, GAZE_ON_MS, GAZE_POLL_MS } from '../../src/ui/gaze.ts'
import type { Gaze } from '../../src/ui/gaze.ts'
import { bottomBox, watchTrustedClicks } from './box.ts'
import { INITIAL_STATE, STATE_KEY } from './messages.ts'
import type { StripMeasure, StripState, ToBackground, ToStrip } from './messages.ts'
import { SITES, siteOf } from './sites.ts'
import type { SiteName } from './sites.ts'

/** The default bar height; the options page offers BAR_HEIGHTS. */
export const STRIP_HEIGHT = 128
export const BAR_HEIGHTS = [96, 128, 192] as const
export type BarHeight = (typeof BAR_HEIGHTS)[number]
export type MicSide = 'left' | 'right'

/** What the options page stores in chrome.storage.local (M7, ui lane). */
/** toggle: a click or dwell turns listening on and off. gaze: it listens while the pointer rests on the target (round 3). */
export type ListenMode = 'toggle' | 'gaze'
/** What the gaze rests on in gaze mode: the microphone square, or the whole bar. */
export type GazeTarget = 'mic' | 'bar'
/** local: TalTech's model on this computer. soniox: Soniox through the dev server (needs SONIOX_API_KEY there). */
export type SpeechEngine = 'local' | 'soniox'
export interface StripSettings {
  barHeight: BarHeight
  micSide: MicSide
  /** The bar starts folded to the pill when the browser starts. */
  barHiddenDefault: boolean
  listenMode: ListenMode
  gazeTarget: GazeTarget
  speechEngine: SpeechEngine
  /** Round 4: only the owner's voice is obeyed (needs an enrolled voice on the dev server). */
  onlyOwner: boolean
}
export const DEFAULT_SETTINGS: StripSettings = { barHeight: STRIP_HEIGHT, micSide: 'left', barHiddenDefault: false, listenMode: 'toggle', gazeTarget: 'mic', speechEngine: 'local', onlyOwner: false }
export const SETTING_KEYS = ['barHeight', 'micSide', 'barHiddenDefault', 'listenMode', 'gazeTarget', 'speechEngine', 'onlyOwner'] as const

/** Reads the strip's settings out of a chrome.storage.local answer, defaults for anything missing. */
export function settingsFrom(stored: Record<string, unknown>): StripSettings {
  const h = stored.barHeight
  const barHeight = BAR_HEIGHTS.find((x) => x === h) ?? DEFAULT_SETTINGS.barHeight
  const micSide: MicSide = stored.micSide === 'right' ? 'right' : 'left'
  return {
    barHeight,
    micSide,
    barHiddenDefault: stored.barHiddenDefault === true,
    listenMode: stored.listenMode === 'gaze' ? 'gaze' : 'toggle',
    gazeTarget: stored.gazeTarget === 'bar' ? 'bar' : 'mic',
    speechEngine: stored.speechEngine === 'soniox' ? 'soniox' : 'local',
    onlyOwner: stored.onlyOwner === true,
  }
}

const PILL_SIZE = 72
const SHOW_SIZE = 40
/** Resting on the pill this long brings the bar back (the mic toggles at the usual 1 s). */
const PILL_SHOW_MS = 2000
/** The lag line appears when the speech server is this far behind, and stays until it has caught up (round 3). Matches the engine's LAG_SHOWN_MS, below the server's 1500 ms backlog. */
export const LAG_SHOW_MS = 1000
const text = STRINGS.et.strip

/** Per height: the microphone square, the controls, the type. */
function sizes(h: BarHeight): { mic: number; control: [number, number]; heard: number; line: number; notice: number; pad: number; columns: boolean } {
  if (h === 96) return { mic: 96, control: [80, 56], heard: 24, line: 18, notice: 14, pad: 0, columns: false }
  if (h === 192) return { mic: 152, control: [100, 72], heard: 40, line: 28, notice: 18, pad: 12, columns: true }
  return { mic: 104, control: [80, 56], heard: 26, line: 20, notice: 15, pad: 4, columns: true }
}

export const FONT = `"Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, "Segoe UI", sans-serif`

const CSS = `
:host { all: initial;
  --bg: #141414; --ink: #f5f1e8; --dim: #a8a399; --edge: #3a3a3a; --panel: #242424;
  --green: #3ddc84; --amber: #f0b429; }
button { font-family: ${FONT}; }
.bar { position: fixed; left: 0; right: 0; bottom: 0; height: var(--h); box-sizing: border-box;
  display: flex; align-items: center; gap: 16px; padding: var(--pad) 16px; background: var(--bg); color: var(--ink);
  border-top: 2px solid var(--edge); font-family: ${FONT}; z-index: 2147483647; }
.bar[data-side="right"] { flex-direction: row-reverse; }
.bar[hidden], .pill[hidden] { display: none; }
.mic { position: relative; flex: none; width: var(--mic); height: var(--mic); box-sizing: border-box;
  border-radius: 18px; border: 3px solid var(--ink); background: transparent; color: var(--ink); cursor: pointer; overflow: hidden;
  font-size: 18px; line-height: 1.1; font-weight: 700; padding: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px; }
.mic[data-state="listening"] { background: var(--green); border-color: var(--green); color: #141414; }
.mic[data-state="resting"] { border-color: var(--amber); color: var(--amber); }
.mic:focus-visible, .ctl:focus-visible { outline: 3px solid var(--amber); outline-offset: 2px; }
.dot { width: 26px; height: 26px; border-radius: 50%; border: 4px solid currentColor; box-sizing: border-box; }
.mic[data-state="listening"] .dot { background: #141414; }
.label, .dot, .ctl > span { position: relative; z-index: 1; }
.fill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: var(--amber); opacity: .45; }
.dwelling .fill { height: 100%; transition: height 1s linear; }
.pillmic.dwelling-long .fill { height: 100%; transition: height ${PILL_SHOW_MS}ms linear; }
.words { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.heard { font-size: var(--heard); line-height: 1.2; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: calc(var(--heard) * 1.2); }
.row { display: flex; align-items: center; gap: 12px; min-width: 0; }
.line { font-size: var(--line); line-height: 1.25; font-weight: 500; color: var(--amber); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: calc(var(--line) * 1.25); }
.line.problem { color: #141414; background: var(--amber); padding: 1px 8px; border-radius: 6px; font-weight: 700; }
.think { flex: none; display: none; align-items: center; gap: 8px; color: var(--dim); font-size: var(--line); line-height: 1.25; }
.think.on { display: inline-flex; }
.think i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--dim); animation: pulse 1.2s infinite ease-in-out; }
.think i:nth-child(2) { animation-delay: .2s; }
.think i:nth-child(3) { animation-delay: .4s; }
@keyframes pulse { 0%, 80%, 100% { opacity: .25; transform: scale(.8); } 40% { opacity: 1; transform: scale(1); } }
.notice { display: none; font-size: var(--notice); line-height: 1.25; color: var(--amber); border-top: 1px solid var(--amber); padding-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.notice.on { display: block; }
.lag { display: none; font-size: var(--notice); line-height: 1.25; color: var(--dim); border-top: 1px solid var(--edge); padding-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lag.on { display: block; }
/* Round 4: someone else's utterance was skipped (only-owner mode). */
.foreign { display: none; font-size: var(--notice); line-height: 1.25; color: var(--dim); border-top: 1px solid var(--edge); padding-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.foreign.on { display: block; }
/* Gaze mode (round 3): the target listens while the pointer rests on it. A quick amber fill says the rest was
   seen (arming); a green inner outline says it listens; the fill growing again over the grace says it is about to stop. */
.bar > * { position: relative; z-index: 1; }
.barfill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: var(--amber); opacity: .3; z-index: 0; pointer-events: none; }
.bar[data-gaze="arming"] .barfill, .mic[data-gaze="arming"] .fill { height: 100%; transition: height ${GAZE_ON_MS}ms linear; }
.bar[data-gaze="leaving"] .barfill, .mic[data-gaze="leaving"] .fill { height: 100%; transition: height ${GAZE_OFF_MS}ms linear; }
.bar[data-gaze="on"] { box-shadow: inset 0 0 0 4px var(--green); }
.bar[data-gaze="leaving"] { box-shadow: inset 0 0 0 4px var(--amber); }
.mic.gaze { cursor: default; }
.mic.gaze[data-state="off"] { font-size: 15px; }
.mic .label { text-align: center; padding: 0 6px; }
.ctls { flex: none; display: flex; flex-direction: column; gap: 8px; }
.ctls.rows { flex-direction: row; }
.ctl { position: relative; overflow: hidden; width: var(--control-w); height: var(--control-h); box-sizing: border-box; padding: 0;
  border-radius: 12px; border: 2px solid var(--edge); background: var(--panel); color: var(--ink); cursor: pointer;
  font-size: 15px; line-height: 1; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.ctl:hover { border-color: var(--dim); }
.pill { position: fixed; right: 16px; bottom: 16px; display: flex; align-items: flex-end; gap: 10px; z-index: 2147483647; font-family: ${FONT}; }
.pillmic { width: ${PILL_SIZE}px; height: ${PILL_SIZE}px; border-radius: 50%; gap: 0; font-size: 0; box-shadow: 0 2px 12px rgba(0,0,0,.5); background: var(--bg); }
.pillmic[data-state="listening"] { background: var(--green); }
.pillmic .dot { width: 30px; height: 30px; }
.show { width: ${SHOW_SIZE}px; height: ${SHOW_SIZE}px; border-radius: 10px; font-size: 13px; box-shadow: 0 2px 12px rgba(0,0,0,.5); }
`

const roomCss = (h: number): string => `html { height: calc(100% - ${h}px) !important; padding-bottom: ${h}px !important; box-sizing: content-box !important; }`

function micState(state: StripState): 'listening' | 'resting' | 'off' {
  if (!state.listening) return 'off'
  return state.resting ? 'resting' : 'listening'
}

function micLabel(state: StripState, gaze: boolean): string {
  const s = micState(state)
  return s === 'listening' ? text.listening : s === 'resting' ? text.resting : gaze ? text.gazeOff : text.notListening
}

/** The lag line: shown once the server is LAG_SHOW_MS behind, kept until it has caught up (0). */
export function lagShown(lag: number, shown: boolean): boolean {
  return lag > LAG_SHOW_MS || (shown && lag > 0)
}

function send(message: ToBackground): void {
  chrome.runtime.sendMessage(message).catch(() => undefined)
}

function inside(el: Element, point: { x: number; y: number }): boolean {
  const r = el.getBoundingClientRect()
  return point.x >= r.left && point.x < r.right && point.y >= r.top && point.y < r.bottom
}

/**
 * A control that acts on a click or on a 1 s dwell, without taking focus from the page's box.
 * when: the control is live only while this holds (the microphone is not a toggle in gaze mode).
 */
function dwellable(el: HTMLElement, onFire: () => void, when: () => boolean = () => true): void {
  const dwell = createDwell({
    onFire,
    onChange: (dwelling) => el.classList.toggle('dwelling', dwelling),
  })
  el.addEventListener('pointerenter', () => {
    if (when()) dwell.enter()
  })
  el.addEventListener('pointerleave', () => dwell.leave())
  el.addEventListener('mousedown', (event) => event.preventDefault())
  el.addEventListener('click', () => {
    if (!when()) return
    if (dwell.click()) onFire()
  })
}

function micButton(className: string): { mic: HTMLButtonElement; label: HTMLSpanElement } {
  const mic = document.createElement('button')
  mic.type = 'button'
  mic.className = className
  mic.setAttribute('aria-label', text.micLabel)
  const fill = document.createElement('span')
  fill.className = 'fill'
  const dot = document.createElement('span')
  dot.className = 'dot'
  const label = document.createElement('span')
  label.className = 'label'
  mic.append(fill, dot, label)
  return { mic, label }
}

function control(className: string, name: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `ctl ${className}`
  b.setAttribute('aria-label', name)
  const fill = document.createElement('span')
  fill.className = 'fill'
  const label = document.createElement('span')
  label.textContent = name
  b.append(fill, label)
  return b
}

export function mountStrip(): void {
  // A real click into a field arms it for dictation from the first page load, before any command injects page.js.
  watchTrustedClicks()
  for (const old of document.querySelectorAll('utle-strip')) old.remove()
  document.getElementById('utle-room')?.remove()

  const host = document.createElement('utle-strip')
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = CSS

  // The bar.
  const bar = document.createElement('div')
  bar.className = 'bar'
  const { mic, label } = micButton('mic')
  const words = document.createElement('div')
  words.className = 'words'
  const heard = document.createElement('div')
  heard.className = 'heard'
  heard.setAttribute('aria-live', 'polite')
  const row = document.createElement('div')
  row.className = 'row'
  const line = document.createElement('div')
  line.className = 'line'
  line.setAttribute('role', 'status')
  const think = document.createElement('span')
  think.className = 'think'
  think.append(document.createElement('i'), document.createElement('i'), document.createElement('i'))
  const thinkText = document.createElement('span')
  thinkText.textContent = text.thinking
  think.append(thinkText)
  row.append(line, think)
  const notice = document.createElement('div')
  notice.className = 'notice'
  const lag = document.createElement('div')
  lag.className = 'lag'
  const foreign = document.createElement('div')
  foreign.className = 'foreign'
  words.append(heard, row, notice, lag, foreign)
  const ctls = document.createElement('div')
  ctls.className = 'ctls'
  const hide = control('hide', text.hide)
  const settings = control('settings', text.settings)
  ctls.append(hide, settings)
  const barFill = document.createElement('span')
  barFill.className = 'barfill'
  bar.append(barFill, mic, words, ctls)

  // The pill.
  const pill = document.createElement('div')
  pill.className = 'pill'
  const show = control('show', text.show)
  const { mic: pillMic } = micButton('mic pillmic')
  pill.append(show, pillMic)
  pill.hidden = true

  root.append(style, bar, pill)

  const room = document.createElement('style')
  room.id = 'utle-room'
  ;(document.head ?? document.documentElement).append(room)
  document.documentElement.append(host)

  let settingsNow: StripSettings = DEFAULT_SETTINGS
  let state: StripState = INITIAL_STATE
  let lagOn = false
  const gazeMode = (): boolean => settingsNow.listenMode === 'gaze'

  // Gaze mode (round 3): the target listens while the pointer rests on it. The pointer's last
  // position is kept because a page can swallow the leave event; a poll then ends the rest.
  let pointer: { x: number; y: number } | null = null
  document.addEventListener(
    'pointermove',
    (event) => {
      pointer = { x: event.clientX, y: event.clientY }
    },
    true,
  )
  let gaze: Gaze | null = null
  let gazeEl: HTMLElement | null = null
  let unbindGaze: (() => void) | null = null
  const gazeTargetEl = (): HTMLElement | null => {
    if (!gazeMode()) return null
    if (state.hidden) return pillMic
    return settingsNow.gazeTarget === 'bar' ? bar : mic
  }
  const bindGaze = (): void => {
    const el = gazeTargetEl()
    if (el === gazeEl) return
    unbindGaze?.()
    unbindGaze = null
    // Disposing a gaze that is on sends the stop, so the microphone never stays open on a target that went away.
    gaze?.dispose()
    gaze = null
    gazeEl = el
    if (!el) return
    const g = createGaze({
      onStart: () => send({ type: 'utle-listen', on: true }),
      onStop: () => send({ type: 'utle-listen', on: false, flush: true }),
      onPhase: (phase) => {
        if (phase === 'off') delete el.dataset.gaze
        else el.dataset.gaze = phase
      },
    })
    gaze = g
    const enter = (): void => g.enter()
    const leave = (): void => g.leave()
    el.addEventListener('pointerenter', enter)
    el.addEventListener('pointerleave', leave)
    unbindGaze = () => {
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointerleave', leave)
      delete el.dataset.gaze
    }
    // The pointer is already on the new target (the mode changed, the bar unfolded under it).
    if (pointer && inside(el, pointer)) g.enter()
  }
  // The poll only ever leaves. It never enters: the last position seen is stale once the pointer
  // has left the window (an eye tracker parks it at the bottom edge, on the bar), and an enter from
  // it would start the microphone again with nobody looking.
  setInterval(() => {
    if (!gaze || !gazeEl || !pointer) return
    if (!inside(gazeEl, pointer)) gaze.leave()
  }, GAZE_POLL_MS)

  const applySettings = (): void => {
    const s = sizes(settingsNow.barHeight)
    host.style.setProperty('--h', `${settingsNow.barHeight}px`)
    host.style.setProperty('--mic', `${s.mic}px`)
    host.style.setProperty('--control-w', `${s.control[0]}px`)
    host.style.setProperty('--control-h', `${s.control[1]}px`)
    host.style.setProperty('--heard', `${s.heard}px`)
    host.style.setProperty('--line', `${s.line}px`)
    host.style.setProperty('--notice', `${s.notice}px`)
    host.style.setProperty('--pad', `${s.pad}px`)
    bar.dataset.side = settingsNow.micSide
    ctls.classList.toggle('rows', !s.columns)
  }

  // Making room: a full-height app built on 100vh is shrunk so its message box sits above the strip.
  let site: SiteName | null = null
  let fitted: { el: HTMLElement; height: string; maxHeight: string } | null = null
  const unfit = (): void => {
    if (!fitted) return
    fitted.el.style.height = fitted.height
    fitted.el.style.maxHeight = fitted.maxHeight
    fitted = null
  }
  const fitApp = (): void => {
    if (state.hidden) return
    const h = settingsNow.barHeight
    const box = bottomBox(site === null ? null : SITES[site])
    if (!box) return
    const limit = window.innerHeight - h
    if (box.getBoundingClientRect().bottom <= limit + 1) return
    let pick: HTMLElement | null = null
    for (let el = box.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const r = el.getBoundingClientRect()
      if (Math.abs(r.height - window.innerHeight) <= 2 && r.top <= 1) pick = el
    }
    if (!pick) return
    if (fitted && fitted.el !== pick) unfit()
    if (!fitted) fitted = { el: pick, height: pick.style.height, maxHeight: pick.style.maxHeight }
    pick.style.setProperty('height', `calc(100vh - ${h}px)`, 'important')
    pick.style.setProperty('max-height', `calc(100vh - ${h}px)`, 'important')
  }

  const render = (): void => {
    const ms = micState(state)
    for (const m of [mic, pillMic]) {
      m.dataset.state = ms
      m.setAttribute('aria-pressed', String(state.listening))
      m.classList.toggle('gaze', gazeMode())
    }
    label.textContent = micLabel(state, gazeMode())
    heard.textContent = state.heard
    const problem = state.problem !== ''
    line.textContent = problem ? state.problem : state.line
    line.classList.toggle('problem', problem)
    think.classList.toggle('on', state.thinking)
    notice.textContent = state.modelProblem
    notice.classList.toggle('on', state.modelProblem !== '')
    lagOn = lagShown(state.lag, lagOn)
    lag.textContent = lagOn ? text.lagLine(Math.round(state.lag / 1000)) : ''
    lag.classList.toggle('on', lagOn)
    foreign.textContent = state.foreign
    foreign.classList.toggle('on', state.foreign !== '')
    bar.hidden = state.hidden
    pill.hidden = !state.hidden
    if (state.hidden) {
      room.textContent = ''
      unfit()
    } else {
      const css = roomCss(settingsNow.barHeight)
      if (room.textContent !== css) room.textContent = css
      fitApp()
    }
    bindGaze()
  }
  applySettings()
  render()

  // In gaze mode the microphone is not a toggle: a click or a dwell on it does nothing.
  const toggleMode = (): boolean => !gazeMode()
  const toggle = (): void => send({ type: 'utle-toggle' })
  dwellable(mic, toggle, toggleMode)
  dwellable(pillMic, toggle, toggleMode)
  dwellable(hide, () => send({ type: 'utle-bar', show: false }))
  dwellable(show, () => send({ type: 'utle-bar', show: true }))
  dwellable(settings, () => send({ type: 'utle-open-options' }))
  // Resting on the pill for 2 s brings the bar back (not in gaze mode, where resting on it is how he speaks).
  const long = createDwell({
    onFire: () => send({ type: 'utle-bar', show: true }),
    onChange: (dwelling) => pillMic.classList.toggle('dwelling-long', dwelling),
    ms: PILL_SHOW_MS,
  })
  pillMic.addEventListener('pointerenter', () => {
    if (toggleMode()) long.enter()
  })
  pillMic.addEventListener('pointerleave', () => long.leave())

  const read = (): void => {
    chrome.storage.session.get(STATE_KEY).then(
      (stored) => {
        const value = stored[STATE_KEY] as StripState | undefined
        if (value) {
          state = { ...INITIAL_STATE, ...value }
          render()
        } else if (settingsNow.barHiddenDefault) {
          // The first page since the browser started: the bar begins folded when he asked for that.
          send({ type: 'utle-bar', show: false })
        }
      },
      () => undefined,
    )
  }
  chrome.storage.local.get(['siteOverrides', 'messagingHome', ...SETTING_KEYS]).then(
    (stored) => {
      const overrides = stored.siteOverrides && typeof stored.siteOverrides === 'object' ? (stored.siteOverrides as Record<string, SiteName>) : {}
      const home = typeof stored.messagingHome === 'string' ? stored.messagingHome : null
      site = siteOf(location.href, { siteOverrides: overrides, messagingHome: home })
      settingsNow = settingsFrom(stored)
      applySettings()
      render()
      read()
    },
    () => read(),
  )
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes[STATE_KEY]) {
      const value = changes[STATE_KEY].newValue as StripState | undefined
      state = { ...INITIAL_STATE, ...value }
      render()
    }
    if (area === 'local' && SETTING_KEYS.some((key) => changes[key])) {
      const next: Record<string, unknown> = { ...settingsNow }
      for (const key of SETTING_KEYS) if (changes[key]) next[key] = changes[key].newValue
      settingsNow = settingsFrom(next)
      applySettings()
      render()
    }
  })
  // A tab that comes back to the front shows the state as it is now.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') read()
  })
  // A page restored from the back/forward cache missed the changes made while it was away.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) read()
  })

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
    const visibleMic = state.hidden ? pillMic : mic
    const answer: StripMeasure = {
      strip: box(bar),
      mic: box(visibleMic),
      micState: visibleMic.dataset.state ?? '',
      heard: heard.textContent ?? '',
      heardPx: parseFloat(getComputedStyle(heard).fontSize),
      line: line.textContent ?? '',
      hidden: state.hidden,
      gaze: gazeEl?.dataset.gaze ?? '',
      lag: lag.textContent ?? '',
    }
    reply(answer)
    return false
  })
}

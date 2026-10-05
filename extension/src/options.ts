// The options page (M7, ui lane): large choices a voice or eye-tracker user can change (bar
// height, microphone side, bar folded at start), and under "Täpsemalt" the two addresses from
// section 20. The same strip as every page is mounted here, so the microphone and the lines are
// in view while he changes them. Like newtab.html, dist/page.js is loaded first so page commands
// (utle-page-run) can number the buttons; see the note in extension/README.md.

import { STRINGS } from '../../src/core/strings.ts'
import { createDwell } from '../../src/ui/dwell.ts'
import type { ToPage } from './messages.ts'
import { BAR_HEIGHTS, SETTING_KEYS, mountStrip, settingsFrom } from './strip.ts'
import type { StripSettings } from './strip.ts'

const text = STRINGS.et.strip
const en = STRINGS.en.strip

const status = document.getElementById('status')
const say = (line: string): void => {
  if (status) status.textContent = line
}

const setText = (id: string, value: string): void => {
  const el = document.getElementById(id)
  if (el) el.textContent = value
}
document.title = text.optionsTitle
setText('title', text.optionsTitle)
setText('help', text.optionsHelp)
setText('helpEn', text.optionsHelpEn)
setText('advancedTitle', text.advanced)
setText('advancedEn', en.advanced)
setText('asrLabel', `${text.asrUrl} · ${en.asrUrl}`)
setText('utleLabel', `${text.utleUrl} · ${en.utleUrl}`)
setText('saveLabel', text.save)

/** Click or a 1 s dwell. */
function dwellable(el: HTMLElement, onFire: () => void): void {
  const dwell = createDwell({ onFire, onChange: (dwelling) => el.classList.toggle('dwelling', dwelling) })
  el.addEventListener('pointerenter', () => dwell.enter())
  el.addEventListener('pointerleave', () => dwell.leave())
  el.addEventListener('click', () => {
    if (dwell.click()) onFire()
  })
}

// ---------- the large choices ----------

type SettingKey = (typeof SETTING_KEYS)[number]
interface Choice {
  value: StripSettings[SettingKey]
  label: string
  sub: string
}
interface Group {
  key: SettingKey
  title: string
  titleEn: string
  choices: Choice[]
  /** One line under the choices (the speech model's key). */
  note?: string
  /** The group is shown only while this holds (the gaze target needs gaze mode). */
  when?(settings: StripSettings): boolean
}

const GROUPS: Group[] = [
  {
    key: 'barHeight',
    title: text.barHeight,
    titleEn: en.barHeight,
    choices: [
      { value: BAR_HEIGHTS[0], label: text.barSmall, sub: `${en.barSmall} · ${BAR_HEIGHTS[0]} px` },
      { value: BAR_HEIGHTS[1], label: text.barNormal, sub: `${en.barNormal} · ${BAR_HEIGHTS[1]} px` },
      { value: BAR_HEIGHTS[2], label: text.barLarge, sub: `${en.barLarge} · ${BAR_HEIGHTS[2]} px` },
    ],
  },
  {
    key: 'micSide',
    title: text.micSide,
    titleEn: en.micSideEn || en.micSide,
    choices: [
      { value: 'left', label: text.micLeft, sub: en.micLeft },
      { value: 'right', label: text.micRight, sub: en.micRight },
    ],
  },
  {
    key: 'barHiddenDefault',
    title: text.startHidden,
    titleEn: en.startHidden,
    choices: [
      { value: false, label: text.startShown, sub: en.startShown },
      { value: true, label: text.startFolded, sub: en.startFolded },
    ],
  },
  // Push-to-talk by looking (round 3).
  {
    key: 'listenMode',
    title: text.listenMode,
    titleEn: text.listenModeEn,
    choices: [
      { value: 'toggle', label: text.listenToggle, sub: text.listenToggleEn },
      { value: 'gaze', label: text.listenGaze, sub: text.listenGazeEn },
    ],
  },
  {
    key: 'gazeTarget',
    title: text.gazeTarget,
    titleEn: text.gazeTargetEn,
    when: (s) => s.listenMode === 'gaze',
    choices: [
      { value: 'mic', label: text.gazeMic, sub: text.gazeMicEn },
      { value: 'bar', label: text.gazeBar, sub: text.gazeBarEn },
    ],
  },
  {
    key: 'speechEngine',
    title: text.speechEngine,
    titleEn: text.speechEngineEn,
    note: `${text.engineNote} ${text.engineNoteEn}`,
    choices: [
      { value: 'local', label: text.engineLocal, sub: text.engineLocalEn },
      { value: 'soniox', label: text.engineSoniox, sub: text.engineSonioxEn },
    ],
  },
]

let current: StripSettings = settingsFrom({})
const buttons = new Map<SettingKey, { value: Choice['value']; button: HTMLButtonElement }[]>()
const sections = new Map<SettingKey, HTMLElement>()

function reflect(): void {
  for (const [key, list] of buttons) for (const { value, button } of list) button.setAttribute('aria-pressed', String(current[key] === value))
  for (const group of GROUPS) {
    const section = sections.get(group.key)
    if (section) section.hidden = group.when ? !group.when(current) : false
  }
}

function choose(key: SettingKey, value: Choice['value']): void {
  current = settingsFrom({ ...current, [key]: value })
  reflect()
  chrome.storage.local.set({ [key]: value }).then(
    () => say(text.saved),
    () => say(text.saved),
  )
}

const groups = document.getElementById('groups')
for (const group of GROUPS) {
  const section = document.createElement('section')
  section.id = group.key
  const h2 = document.createElement('h2')
  h2.textContent = group.title
  const sub = document.createElement('p')
  sub.className = 'en'
  sub.textContent = group.titleEn
  const grid = document.createElement('div')
  grid.className = 'choices'
  const list: { value: Choice['value']; button: HTMLButtonElement }[] = []
  for (const choice of group.choices) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'choice'
    b.setAttribute('aria-pressed', 'false')
    const fill = document.createElement('span')
    fill.className = 'fill'
    const name = document.createElement('span')
    name.textContent = choice.label
    const small = document.createElement('span')
    small.className = 'sub'
    small.textContent = choice.sub
    b.append(fill, name, small)
    dwellable(b, () => choose(group.key, choice.value))
    grid.append(b)
    list.push({ value: choice.value, button: b })
  }
  buttons.set(group.key, list)
  section.append(h2, sub, grid)
  if (group.note !== undefined) {
    const note = document.createElement('p')
    note.className = 'note'
    note.textContent = group.note
    section.append(note)
  }
  sections.set(group.key, section)
  groups?.append(section)
}
reflect()

chrome.storage.local.get([...SETTING_KEYS]).then(
  (stored) => {
    current = settingsFrom(stored)
    reflect()
  },
  () => reflect(),
)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !SETTING_KEYS.some((key) => changes[key])) return
  const next: Record<string, unknown> = { ...current }
  for (const key of SETTING_KEYS) if (changes[key]) next[key] = changes[key].newValue
  current = settingsFrom(next)
  reflect()
})

// ---------- the addresses (section 20) ----------

const URL_KEYS = ['utleUrl', 'asrUrl'] as const

for (const key of URL_KEYS) {
  const input = document.getElementById(key)
  if (!(input instanceof HTMLInputElement)) continue
  void chrome.storage.local.get(key).then((stored) => {
    const value = stored[key]
    input.value = typeof value === 'string' ? value : ''
  })
}

const save = document.getElementById('save')
if (save) {
  dwellable(save, () => {
    void (async () => {
      for (const key of URL_KEYS) {
        const input = document.getElementById(key)
        if (!(input instanceof HTMLInputElement)) continue
        const value = input.value.trim()
        if (value === '') {
          await chrome.storage.local.remove(key)
          continue
        }
        try {
          new URL(value)
        } catch {
          say(text.notAnAddress(value))
          return
        }
        await chrome.storage.local.set({ [key]: value })
      }
      say(text.savedReload)
    })()
  })
}

// ---------- the strip and page commands ----------

mountStrip()

// Page commands from the service worker, for this tab only (as on the new-tab page).
let myId: number | null = null
const myTab: Promise<number | null> = chrome.tabs.getCurrent().then(
  (tab) => (myId = tab?.id ?? -1),
  () => (myId = -1),
)
const answer = async (message: ToPage, reply: (result: unknown) => void): Promise<void> => {
  const utle = globalThis.__utle
  reply(utle ? await utle.run(message.command) : { ok: false, code: 'failed', message: 'The page script is missing.' })
}
chrome.runtime.onMessage.addListener((message: ToPage, _sender, reply) => {
  if (!message || message.type !== 'utle-page-run') return false
  if (myId !== null && myId !== message.tabId) return false
  void myTab.then((id) => {
    if (id === message.tabId) void answer(message, reply)
  })
  return true
})

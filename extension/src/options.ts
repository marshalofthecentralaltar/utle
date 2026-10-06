// The options page (M7, ui lane): large choices a voice or eye-tracker user can change (bar
// height, microphone side, bar folded at start), and under "Täpsemalt" the two addresses from
// section 20. The same strip as every page is mounted here, so the microphone and the lines are
// in view while he changes them. Like newtab.html, dist/page.js is loaded first so page commands
// (utle-page-run) can number the buttons; see the note in extension/README.md.

import { SAVED_KEY, SAVED_KINDS, savedFrom, savedPhrases } from '../../src/core/saved.ts'
import type { SavedItem, SavedKind } from '../../src/core/saved.ts'
import { entryChips, entryStep, startEntry } from '../../src/core/savedEntry.ts'
import type { EntryResult, EntryState } from '../../src/core/savedEntry.ts'
import { STRINGS } from '../../src/core/strings.ts'
import { createDwell } from '../../src/ui/dwell.ts'
import type { ToBackground, ToPage } from './messages.ts'
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
  /** A button before the choices that does something instead of choosing (round 4: "Õpeta mu hääl"). */
  action?: { label: string; sub: string; run(): void }
}

/** Round 4: how long the owner speaks for the server to learn his voice. */
export const ENROL_SECONDS = 8

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
  // The owner's voice (round 4, VOICE lane): teach the server his voice, then obey only it.
  {
    key: 'onlyOwner',
    title: text.myVoice,
    titleEn: text.myVoiceEn,
    note: `${text.voiceNote} ${text.voiceNoteEn}`,
    action: {
      label: text.teachVoice,
      sub: text.teachVoiceEn,
      run: () => {
        const message: ToBackground = { type: 'utle-enrol', seconds: ENROL_SECONDS }
        chrome.runtime.sendMessage(message).catch(() => undefined)
        say(text.enrolStart(ENROL_SECONDS))
      },
    },
    choices: [
      { value: true, label: text.onlyOwner, sub: text.onlyOwnerEn },
      { value: false, label: text.everyone, sub: text.everyoneEn },
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
  if (group.action) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'choice action'
    const fill = document.createElement('span')
    fill.className = 'fill'
    const name = document.createElement('span')
    name.textContent = group.action.label
    const small = document.createElement('span')
    small.className = 'sub'
    small.textContent = group.action.sub
    b.append(fill, name, small)
    const { run } = group.action
    dwellable(b, run)
    grid.append(b)
  }
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

// ---------- Minu andmed (round 6, docs/ARCHITECTURE.md 26.5, 26.6) ----------
// His saved e-mail, phone number and ID code: the list with what to say, the voice entry flow
// (the engine sends each utterance here as savedEntry while it runs), and a keyboard form for Tom.

const A = STRINGS.et.andmed
const KINDS: readonly SavedKind[] = ['email', 'tel', 'code', 'text']
let savedItems: SavedItem[] = []
let entry: EntryState | null = null
/** The id of the item the keyboard form is changing, or null for a new one. */
let editing: string | null = null
/** What the engine was last told about the flow, so it is told on change only. */
let entryTold = false

const el = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null

setText('andmedTitle', A.title)
setText('andmedEn', A.titleEn)
setText('andmedHelp', A.help)
setText('entryTitle', A.stepTitle)
setText('formTitle', A.formTitle)
setText('savedNameLabel', A.formName)
setText('savedKindLabel', A.formKind)
setText('savedValueLabel', A.formValue)
setText('savedSaveLabel', A.formSave)

/** Tells the strip one line, as the engine would. */
function strip(line: string): void {
  say(line)
  if (line === '') return
  const message: ToBackground = { type: 'utle-state', patch: { line } }
  chrome.runtime.sendMessage(message).catch(() => undefined)
}

/** Tells the engine whether utterances are for the flow: on while it runs and this page is visible. */
function tellEntry(): void {
  const on = entry !== null && document.visibilityState === 'visible'
  if (on === entryTold) return
  entryTold = on
  const message: ToBackground = { type: 'utle-entry', on }
  chrome.runtime.sendMessage(message).catch(() => undefined)
}

async function store(next: SavedItem[]): Promise<void> {
  savedItems = next
  renderSaved()
  await chrome.storage.local.set({ [SAVED_KEY]: next }).catch(() => undefined)
}

function smallButton(label: string, onFire: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'choice small'
  const fill = document.createElement('span')
  fill.className = 'fill'
  const name = document.createElement('span')
  name.textContent = label
  b.append(fill, name)
  dwellable(b, onFire)
  return b
}

function renderSaved(): void {
  const list = el<HTMLDivElement>('savedList')
  if (!list) return
  list.replaceChildren()
  if (savedItems.length === 0) {
    const p = document.createElement('p')
    p.className = 'note'
    p.textContent = A.empty
    list.append(p)
  }
  for (const item of savedItems) {
    const card = document.createElement('div')
    card.className = 'saved-item'
    card.dataset.id = item.id
    const name = document.createElement('div')
    name.className = 'saved-name'
    name.textContent = `${item.name} · ${A.kindName(item.kind)}`
    const value = document.createElement('div')
    value.className = 'saved-value'
    value.textContent = item.value
    const sayLine = document.createElement('div')
    sayLine.className = 'saved-say'
    sayLine.textContent = A.sayLine(savedPhrases(item, savedItems))
    const row = document.createElement('div')
    row.className = 'saved-actions'
    row.append(
      smallButton(A.edit, () => {
        editing = item.id
        const n = el<HTMLInputElement>('savedName')
        const k = el<HTMLSelectElement>('savedKind')
        const v = el<HTMLInputElement>('savedValue')
        if (n) n.value = item.name
        if (k) k.value = item.kind
        if (v) v.value = item.value
        n?.focus()
      }),
      smallButton(A.forget, () => {
        void store(savedItems.filter((other) => other.id !== item.id)).then(() => strip(A.forgotten(item.name)))
      }),
    )
    card.append(name, value, sayLine, row)
    list.append(card)
  }
  renderEntry()
}

function renderEntry(): void {
  const panel = el<HTMLDivElement>('entry')
  if (!panel) return
  panel.hidden = entry === null
  if (entry === null) return
  setText('entryKind', entry.kind === null ? '' : `${A.kindName(entry.kind)}${entry.name === '' ? '' : ` · ${entry.name}`}`)
  // The step line stays in view whatever the last line said: what to say now.
  setText('entryStep', entry.step === 'kind' ? A.askKind : entry.step === 'name' ? A.askName : entry.kind === 'email' ? `${A.stepValue} ${A.suffixHint}` : A.stepValue)
  const chips = el<HTMLDivElement>('entryChips')
  if (!chips) return
  chips.replaceChildren()
  const { letters, suffix } = entryChips(entry)
  for (const letter of letters) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.textContent = letter
    chips.append(chip)
  }
  if (suffix !== '') {
    const chip = document.createElement('span')
    chip.className = 'chip suffix'
    chip.title = A.suffixLabel
    chip.textContent = suffix
    chips.append(chip)
  }
}

/** One result of the flow: shown, stored when it saves, and the engine told whether it still runs. */
function applyEntry(result: EntryResult): void {
  entry = result.state
  setText('entryLine', result.line)
  if (result.save) {
    const item: SavedItem = { id: crypto.randomUUID(), ...result.save }
    void store([...savedItems, item])
  } else renderSaved()
  strip(result.line)
  tellEntry()
}

function startFlow(kind: SavedKind | null): void {
  el<HTMLElement>('andmed')?.scrollIntoView({ block: 'start' })
  applyEntry(startEntry(kind, savedItems, 'et'))
}

const addRow = el<HTMLDivElement>('savedAdd')
for (const kind of KINDS) addRow?.append(smallButton(A.add(kind), () => startFlow(kind)))
const entryButtons = el<HTMLDivElement>('entryButtons')
entryButtons?.append(
  smallButton(A.done, () => {
    if (entry) applyEntry(entryStep(entry, 'valmis', savedItems, 'et'))
  }),
  smallButton(A.cancel, () => {
    if (entry) applyEntry(entryStep(entry, 'katkesta', savedItems, 'et'))
  }),
)

const kindSelect = el<HTMLSelectElement>('savedKind')
for (const kind of SAVED_KINDS) {
  const option = document.createElement('option')
  option.value = kind
  option.textContent = A.kindName(kind)
  kindSelect?.append(option)
}

const saveButton = el<HTMLButtonElement>('savedSave')
if (saveButton) {
  dwellable(saveButton, () => {
    const name = el<HTMLInputElement>('savedName')?.value.trim() ?? ''
    const value = el<HTMLInputElement>('savedValue')?.value.trim() ?? ''
    const kind = SAVED_KINDS.find((k) => k === kindSelect?.value) ?? 'text'
    if (name === '' || value === '') {
      strip(A.formMissing)
      return
    }
    const id = editing ?? crypto.randomUUID()
    const item: SavedItem = { id, name, value, kind }
    const next = editing === null ? [...savedItems, item] : savedItems.map((other) => (other.id === id ? { ...other, name, value, kind } : other))
    editing = null
    for (const field of ['savedName', 'savedValue']) {
      const input = el<HTMLInputElement>(field)
      if (input) input.value = ''
    }
    void store(next).then(() => strip(A.formSaved(name)))
  })
}

/** #andmed opens the section; #andmed:email starts the voice flow for that kind (the openSettings command). */
function fromHash(): void {
  const m = /^#andmed(?::(\w+))?$/u.exec(window.location.hash)
  if (!m) return
  const kind = SAVED_KINDS.find((k) => k === m[1])
  el<HTMLElement>('andmed')?.scrollIntoView({ block: 'start' })
  if (kind !== undefined) {
    // The address goes back to #andmed, so the next "lisa uus e-post" changes it again.
    history.replaceState(null, '', '#andmed')
    startFlow(kind)
  }
}

void chrome.storage.local.get(SAVED_KEY).then(
  (stored) => {
    savedItems = savedFrom(stored[SAVED_KEY])
    renderSaved()
    fromHash()
  },
  () => {
    renderSaved()
    fromHash()
  },
)
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[SAVED_KEY]
  if (area !== 'local' || change === undefined) return
  savedItems = savedFrom(change.newValue)
  renderSaved()
})
window.addEventListener('hashchange', fromHash)
document.addEventListener('visibilitychange', tellEntry)
window.addEventListener('pagehide', () => {
  entryTold = false
  const message: ToBackground = { type: 'utle-entry', on: false }
  chrome.runtime.sendMessage(message).catch(() => undefined)
})

/** One utterance of the flow, from the engine through the service worker. */
function savedEntryAnswer(utterance: string): { ok: true } | { ok: false; code: 'not_found'; message: string } {
  if (entry === null) {
    tellEntry()
    return { ok: false, code: 'not_found', message: 'No entry flow is running.' }
  }
  applyEntry(entryStep(entry, utterance, savedItems, 'et'))
  return { ok: true }
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
  // Round 6: the entry flow lives on this page; page.js does not know the command.
  if (message.command.kind === 'savedEntry') {
    reply(savedEntryAnswer(message.command.utterance))
    return
  }
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

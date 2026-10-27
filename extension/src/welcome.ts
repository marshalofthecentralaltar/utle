// The welcome page (docs/ARCHITECTURE.md 30.1): the first run, in five cards, for a helper who is
// not a developer. Opened on install instead of the bare microphone page, and again by "ava juhend"
// or the toolbar menu's "Alustamine". Like newtab.html, dist/page.js is loaded first, so page
// commands (utle-page-run) number its buttons and type into its demo box; the strip is mounted here.

import { STRINGS } from '../../src/core/strings.ts'
import { createDwell } from '../../src/ui/dwell.ts'
import { armElement } from './box.ts'
import { CONNECTION_KEYS, connectionFrom, connectionOf, isHostedAddress, isSocketAddress, serverCheck, serverUrl } from './connection.ts'
import type { ToBackground, ToPage } from './messages.ts'
import { mountStrip } from './strip.ts'

const W = STRINGS.et.welcome
const WE = STRINGS.en.welcome
const text = STRINGS.et.strip
const en = STRINGS.en.strip

/** Step 3: the words in the demo box must stand still this long to count as a final that landed. */
export const DEMO_SETTLE_MS = 1000

const send = (message: ToBackground): void => {
  chrome.runtime.sendMessage(message).catch(() => undefined)
}

const setText = (id: string, value: string): void => {
  const el = document.getElementById(id)
  if (el) el.textContent = value
}

/** Click or a 1 s dwell, as on the settings page. */
function dwellable(el: HTMLElement, onFire: () => void): void {
  const dwell = createDwell({ onFire, onChange: (dwelling) => el.classList.toggle('dwelling', dwelling) })
  el.addEventListener('pointerenter', () => dwell.enter())
  el.addEventListener('pointerleave', () => dwell.leave())
  el.addEventListener('click', () => {
    if (dwell.click()) onFire()
  })
}

/** A large button: the Estonian label, the English one dim under it. */
function choice(id: string, label: string, sub: string, onFire: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.id = id
  b.className = 'choice'
  const fill = document.createElement('span')
  fill.className = 'fill'
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = label
  const small = document.createElement('span')
  small.className = 'sub'
  small.textContent = sub
  b.append(fill, name, small)
  dwellable(b, onFire)
  return b
}

interface Card {
  section: HTMLElement
  result: HTMLParagraphElement
}

/** One card: a dwellable head (number, title, English, "Tehtud") that runs the card's main action, then its body. */
function card(n: number, id: string, title: string, titleEn: string, body: string, bodyEn: string, onHead: () => void): Card {
  const section = document.createElement('section')
  section.className = 'step'
  section.id = id
  section.dataset.done = 'false'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'head'
  head.id = `${id}Head`
  const fill = document.createElement('span')
  fill.className = 'fill'
  const num = document.createElement('span')
  num.className = 'num'
  num.textContent = String(n)
  const titles = document.createElement('span')
  titles.className = 'titles'
  const t = document.createElement('span')
  t.textContent = title
  const sub = document.createElement('span')
  sub.className = 'sub'
  sub.textContent = titleEn
  titles.append(t, sub)
  const tick = document.createElement('span')
  tick.className = 'tick'
  tick.textContent = `✓ ${W.done}`
  head.append(fill, num, titles, tick)
  dwellable(head, onHead)
  const p = document.createElement('p')
  p.className = 'body'
  p.textContent = body
  const pe = document.createElement('p')
  pe.className = 'en'
  pe.textContent = bodyEn
  const result = document.createElement('p')
  result.className = 'result'
  result.id = `${id}Result`
  result.setAttribute('role', 'status')
  section.append(head, p, pe)
  document.getElementById('steps')?.append(section)
  return { section, result }
}

const done = { mic: false, server: false, demo: false, voice: false }
/** Card 5, once it is made: the cards above it tick it. */
let readyCard: Card | null = null

function show(c: Card, line: string, ok = false): void {
  c.result.textContent = line
  c.result.classList.toggle('ok', ok)
}

function mark(c: Card, on: boolean): void {
  c.section.dataset.done = String(on)
  readyCheck()
}

// ---------- the page ----------

document.title = `Ütle: ${W.title.toLocaleLowerCase('et')}`
setText('title', W.title)
setText('titleEn', WE.title)
setText('intro', W.intro)
setText('introEn', WE.intro)
setText('how', W.how)

// ---------- 1. Mikrofon ----------

const mic = card(1, 'stepMic', W.micTitle, WE.micTitle, W.micBody, WE.micBody, () => void askMic())
const micButton = choice('micAsk', W.micAsk, WE.micAsk, () => void askMic())
const micRow = document.createElement('div')
micRow.className = 'choices'
micRow.append(micButton)
mic.section.append(micRow, mic.result)

function micGranted(): void {
  if (!done.mic) send({ type: 'utle-mic-granted' })
  done.mic = true
  show(mic, W.micGranted, true)
  mark(mic, true)
}

function micBlocked(): void {
  done.mic = false
  show(mic, W.micDenied)
  const name = micButton.querySelector('.name')
  const sub = micButton.querySelector('.sub')
  if (name) name.textContent = text.permissionRetry
  if (sub) sub.textContent = en.permissionRetry
  mark(mic, false)
}

async function askMic(): Promise<void> {
  show(mic, '')
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
  } catch {
    micBlocked()
    return
  }
  micGranted()
}

/** On load: granted ticks at once, prompt asks (Chrome's own question), denied says how to allow it. */
async function micOnLoad(): Promise<void> {
  let status: PermissionStatus | null = null
  try {
    status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
  } catch {
    status = null
  }
  if (status) {
    status.addEventListener('change', () => {
      if (status?.state === 'granted') micGranted()
      else if (status?.state === 'denied') micBlocked()
    })
  }
  if (status?.state === 'granted') micGranted()
  else if (status?.state === 'denied') micBlocked()
  else await askMic()
}

// ---------- 2. Server ----------

const server = card(2, 'stepServer', W.serverTitle, WE.serverTitle, W.serverBody, WE.serverBody, () => void testServer())
const where = document.createElement('div')
where.className = 'choices'
const local = choice('serverLocal', W.choiceLocal, WE.choiceLocal, () => void chooseLocal())
const hosted = choice('serverHosted', W.choiceHosted, WE.choiceHosted, () => chooseHosted())
where.append(local, hosted)
const whereNote = document.createElement('p')
whereNote.className = 'note'
whereNote.id = 'serverNote'
// The English on its own dim line under the Estonian, as everywhere on the page.
const whereNoteEn = document.createElement('p')
whereNoteEn.className = 'en'
whereNoteEn.id = 'serverNoteEn'
const fields = document.createElement('div')
fields.className = 'fields'
fields.id = 'serverFields'
const field = (id: string, label: string, type: string, placeholder: string): HTMLInputElement => {
  const l = document.createElement('label')
  l.htmlFor = id
  l.textContent = label
  const input = document.createElement('input')
  input.id = id
  input.type = type
  input.placeholder = placeholder
  input.autocomplete = 'off'
  input.spellcheck = false
  dwellable(input, () => input.focus())
  fields.append(l, input)
  return input
}
const address = field('asrUrl', `${text.serverAddress} · ${en.serverAddress}`, 'url', 'wss://…/api/asr')
const token = field('serverToken', `${text.serverToken} · ${en.serverToken}`, 'password', '')
const testRow = document.createElement('div')
testRow.className = 'choices'
testRow.append(choice('serverTest', text.serverTest, en.serverTest, () => void testServer()))
server.section.append(where, whereNote, whereNoteEn, fields, testRow, server.result)

let hostedChosen = false
function pressWhere(isHosted: boolean): void {
  hostedChosen = isHosted
  local.setAttribute('aria-pressed', String(!isHosted))
  hosted.setAttribute('aria-pressed', String(isHosted))
  fields.hidden = !isHosted
  whereNote.textContent = isHosted ? W.choiceHostedNote : W.choiceLocalNote
  whereNoteEn.textContent = isHosted ? WE.choiceHostedNote : WE.choiceLocalNote
}

/** Samas arvutis: the stored address and token go, so the local default holds; then it is tried. */
async function chooseLocal(): Promise<void> {
  pressWhere(false)
  address.value = ''
  token.value = ''
  await chrome.storage.local.remove(['asrUrl', 'serverToken']).catch(() => undefined)
  await testServer()
}

function chooseHosted(): void {
  pressWhere(true)
  show(server, '')
  address.focus()
}

/** Stores the fields (hosted only); false when the address is not a ws:// or wss:// address. */
async function storeServer(): Promise<boolean> {
  if (!hostedChosen) return true
  const value = address.value.trim()
  if (value !== '' && !isSocketAddress(value)) {
    show(server, text.notAnAddress(value))
    return false
  }
  if (value === '') await chrome.storage.local.remove('asrUrl')
  else await chrome.storage.local.set({ asrUrl: value })
  const secret = token.value.trim()
  if (secret === '') await chrome.storage.local.remove('serverToken')
  else await chrome.storage.local.set({ serverToken: secret })
  return true
}

/** "Proovi ühendust": GET /api/status through the settings page's path; the result goes to the strip's dot too. */
async function testServer(): Promise<void> {
  if (!(await storeServer())) return
  show(server, text.serverChecking)
  const connection = connectionFrom(await chrome.storage.local.get([...CONNECTION_KEYS]))
  const check = await serverCheck(serverUrl(connection.asrUrl, '/api/status'), connection.token)
  send({ type: 'utle-state', patch: { connection: connectionOf(check.state) } })
  done.server = check.state === 'live' || check.state === 'no_key'
  if (check.state === 'bad_token') show(server, text.serverWrongToken)
  else if (check.state === 'unreachable') show(server, `${text.serverUnreachable} ${isHostedAddress(connection.asrUrl) ? W.hintHosted : W.hintLocal}`)
  else {
    const ok = text.serverOk(check.speech ?? { local: false, soniox: false }, check.state === 'live')
    show(server, check.profile ? `${ok} ${text.serverProfile(check.profile)}` : ok, true)
  }
  mark(server, done.server)
  done.voice = check.profile?.enrolled === true
  mark(voice, done.voice)
  if (done.voice) show(voice, W.voiceDone, true)
}

void chrome.storage.local.get([...CONNECTION_KEYS]).then((stored) => {
  const a = typeof stored.asrUrl === 'string' ? stored.asrUrl : ''
  address.value = a
  token.value = typeof stored.serverToken === 'string' ? stored.serverToken : ''
  pressWhere(a.trim() !== '')
})

// ---------- 3. Proovi ----------

const demoCard = card(3, 'stepTry', W.tryTitle, WE.tryTitle, W.tryBody, WE.tryBody, () => armDemo())
const demo = document.createElement('textarea')
demo.id = 'demo'
demo.rows = 2
demo.setAttribute('aria-label', W.tryTitle)
const demoRow = document.createElement('div')
demoRow.className = 'choices'
demoRow.append(choice('demoArm', W.tryArm, WE.tryArm, () => armDemo()))
demoCard.section.append(demo, demoRow, demoCard.result)
show(demoCard, W.tryWaiting)

/** The demo box is the armed box: dictation goes there (page.ts reads the same armed field). */
function armDemo(): void {
  armElement(demo)
  demo.focus()
}

// A final has landed when the words have stood still for DEMO_SETTLE_MS (previews change as he speaks).
let lastText = ''
let changedAt = Date.now()
setInterval(() => {
  const now = demo.value
  if (now !== lastText) {
    lastText = now
    changedAt = Date.now()
    return
  }
  if (done.demo || now.trim() === '' || Date.now() - changedAt < DEMO_SETTLE_MS) return
  done.demo = true
  show(demoCard, W.tryWorks, true)
  mark(demoCard, true)
}, 200)

// ---------- 4. Hääl ----------

const voice = card(4, 'stepVoice', W.voiceTitle, WE.voiceTitle, W.voiceBody, WE.voiceBody, () => openVoice())
const voiceRow = document.createElement('div')
voiceRow.className = 'choices'
voiceRow.append(choice('voiceOpen', text.teachScript, text.teachScriptEn, () => openVoice()))
voice.section.append(voiceRow, voice.result)

function openVoice(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#onlyOwner'), active: true })
}

// ---------- 5. Valmis ----------

const ready = card(5, 'stepReady', W.readyTitle, WE.readyTitle, W.readyBody, WE.readyBody, () => void openHelp())
const list = document.createElement('ul')
list.className = 'examples'
for (const example of text.examples.slice(0, 3)) {
  const li = document.createElement('li')
  li.textContent = example
  list.append(li)
}
const readyRow = document.createElement('div')
readyRow.className = 'choices'
readyRow.append(
  choice('readyHelp', W.help, WE.help, () => void openHelp()),
  choice('readySettings', text.settings, en.settings, () => void chrome.runtime.openOptionsPage()),
)
ready.section.append(list, readyRow, ready.result)
readyCard = ready

/** Abi: the help page (30.2). */
async function openHelp(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL('help.html'), active: true })
}

function readyCheck(): void {
  if (readyCard === null) return
  const all = done.mic && done.server && done.demo
  readyCard.section.dataset.done = String(all)
  show(readyCard, all ? W.readyDone : '', all)
}

// ---------- start ----------

readyCheck()
armDemo()
void micOnLoad()
// The server as stored is tried at once, so the card says where things stand.
void testServer()

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

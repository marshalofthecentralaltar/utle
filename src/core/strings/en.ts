// The English lines (src/core/strings.ts assembles both languages).

import type { MediaAction, PressableKey, FormatStyle } from '../../browser/protocol.ts'
import { dialogButtons } from '../../browser/protocol.ts'
import { HELP_EXAMPLES_EN, PHRASE_GROUPS } from '../phrases.ts'
import type { Strings } from './types.ts'
import { placeOf } from './placeOf.ts'

const FORMAT_EN: Record<FormatStyle, string> = {
  bold: 'Bold.',
  italic: 'Italic.',
  underline: 'Underlined.',
  heading: 'Heading.',
  normal: 'Normal text.',
  list: 'Bulleted list.',
  paragraph: 'New paragraph.',
}

const KEY_EN: Record<PressableKey, string> = {
  Escape: 'Closing.',
  Enter: 'Confirming.',
  Tab: 'Next field.',
  Backspace: 'Deleting backwards.',
  Delete: 'Deleting forwards.',
  ArrowLeft: 'Left.',
  ArrowRight: 'Right.',
  ArrowUp: 'Up.',
  ArrowDown: 'Down.',
  Home: 'Start of the line.',
  End: 'End of the line.',
  Undo: 'Undoing.',
  Redo: 'Redoing.',
  SelectAll: 'Selecting everything.',
}

const MEDIA_EN: Record<MediaAction, string> = {
  play: 'Playing.',
  pause: 'Paused.',
  toggle: 'Play or pause.',
  mute: 'Muted.',
  unmute: 'Sound back on.',
  volumeUp: 'Louder.',
  volumeDown: 'Quieter.',
  fullscreen: 'Full screen.',
  exitFullscreen: 'Leaving full screen.',
  forward: 'Forward ten seconds.',
  back: 'Back ten seconds.',
}

function amountEn(seconds: number): string {
  return seconds === 60 ? 'one minute' : seconds % 60 === 0 ? `${seconds / 60} minutes` : seconds === 1 ? 'one second' : `${seconds} seconds`
}

function seekEn(action: MediaAction, seconds: number): string {
  return `${action === 'back' ? 'Back' : 'Forward'} ${amountEn(seconds)}.`
}

export const EN: Strings = {
  promptListening: 'Say what to change, or a paragraph number.',
  promptThinking: 'Working on it.',
  promptConfirming: 'Say yes or no, or only the word to change.',
  promptAsleep: 'Say wake up to continue.',
  promptReading: 'Say stop to end the reading.',
  promptChoosing: (count) => `Say a number from 1 to ${count}, or no.`,
  promptDraft: 'Say what to write. Say send when it is ready.',
  promptConfirmSend: 'Say yes or no.',
  promptSending: 'Sending.',

  waiting: 'Waiting for you to speak.',
  stillWorking: 'One moment, still working on the last one.',
  nothingToConfirm: 'Nothing to confirm.',
  noLongerFits: 'That no longer fits the document. Nothing changed.',
  saved: 'Done. Saved as a tracked change.',
  asleep: 'Asleep. The microphone is ignored.',
  listeningAgain: 'Listening.',
  alreadyListening: 'Already listening.',
  helpShown: 'Here is what you can say.',
  nothingToUndo: 'Nothing to undo.',
  undone: (what) => `Undone: ${what}`,
  lastEdit: 'the last edit',
  noParagraph: (n) => `There is no paragraph ${n}.`,
  paragraph: (n) => `Paragraph ${n}.`,
  readingParagraph: (n) => `Reading paragraph ${n}.`,
  discarded: 'Discarded. Nothing changed.',
  dropped: 'Dropped. Nothing changed.',
  nothingToChoose: 'Nothing to choose.',
  countToChoose: (n) => `There are ${n} to choose from.`,
  didNotFit: 'That did not fit the document. Nothing changed.',
  couldNotTell: 'I could not tell which part you meant. Say it another way.',
  placeNotFound: 'I could not find that place.',
  stoppedReading: 'Stopped reading.',
  nothingRead: 'Nothing is being read.',

  sayWhichToRead: 'Say which paragraph to read.',
  sayWhichToDelete: 'Say which paragraph to delete.',
  noParagraphOf: (n, total) => `There is no paragraph ${n}. The document has ${total}.`,
  paragraphDeleted: (n) => `Paragraph ${n} deleted.`,

  // oxlint-disable-next-line max-lines-per-function, complexity -- EDGES removes this
  browserDoing(command) {
    switch (command.kind) {
      case 'ping':
        return 'Checking for the extension.'
      case 'newTab':
        return 'Opening a new tab.'
      case 'closeTab':
        return 'Closing the tab.'
      case 'switchTab': {
        const to = command.to
        if (to === 'next') return 'Next tab.'
        if (to === 'previous') return 'Previous tab.'
        return 'index' in to ? `Tab ${to.index}.` : `Looking for the tab: ${to.query}.`
      }
      case 'goTo': {
        const place = placeOf(command.url)
        return place.search !== null ? `Searching: ${place.search}` : `Opening ${place.host}`
      }
      case 'history':
        return command.direction === 'back' ? 'Back.' : 'Forward.'
      case 'reload':
        return 'Reloading the page.'
      case 'scroll':
        if (command.mode === 'stop') return 'Scrolling stopped.'
        if (command.mode === 'slow' && command.seconds !== undefined) return `Scrolling slowly ${command.direction === 'up' ? 'up' : 'down'} for ${amountEn(command.seconds)}. “Stop” ends it.`
        if (command.mode === 'slow') return command.direction === 'up' ? 'Scrolling slowly up.' : 'Scrolling slowly down.'
        return { down: 'Scrolling down.', up: 'Scrolling up.', top: 'To the top of the page.', bottom: 'To the end of the page.' }[command.direction]
      case 'showHints':
        return 'Showing numbers.'
      case 'hideHints':
        return 'Hiding the numbers.'
      case 'clickHint':
        return `Clicking ${command.number}.`
      case 'openConversation':
        return `Opening the conversation with ${command.name}.`
      case 'insertText':
        return 'Writing the message.'
      case 'readBox':
        return 'Reading the message box.'
      case 'setText':
        return 'Writing.'
      case 'pressSend':
        return 'Sending.'
      case 'readPage':
        return 'Looking at the page.'
      case 'clickItem':
        return 'Clicking.'
      case 'focusItem':
        return 'Picking the field.'
      case 'hover':
        return 'Showing its options.'
      case 'contextMenu':
        return 'Opening the menu.'
      case 'scrollTo':
        return 'Scrolling to it.'
      case 'siteSearch':
        return `Searching here: ${command.query}`
      case 'media':
        return command.seconds === undefined ? MEDIA_EN[command.action] : seekEn(command.action, command.seconds)
      case 'pressKey':
        return KEY_EN[command.key]
      case 'caret':
        return 'Moving the caret.'
      case 'select':
        return 'Selecting text.'
      case 'typeText':
        return 'Typing here.'
      case 'clearField':
        return 'Clearing the field.'
      case 'arm':
        return command.on ? 'Writing here.' : 'Not writing here any more.'
      case 'bar':
        return command.show ? 'Showing the bar.' : 'Hiding the bar.'
      case 'zoom':
        return command.direction === 'in' ? 'Zooming in.' : command.direction === 'out' ? 'Zooming out.' : 'Normal size.'
      case 'openSettings':
        return command.section === 'andmed' ? 'Opening my details.' : command.section === 'welcome' ? 'Opening the setup guide.' : command.section === 'voice' ? 'Opening voice training.' : 'Opening the settings.'
      case 'openHelp': {
        const group = PHRASE_GROUPS.find((g) => g.id === command.group)
        return group ? `Opening help: ${group.nameEn}.` : 'Opening help.'
      }
      case 'savedEntry':
        return ''
      case 'format':
        return FORMAT_EN[command.style]
      // ---------- mail (29.3) ----------
      case 'compose':
        return command.to ? `New mail: ${command.to}.` : 'New mail.'
      case 'composeTo':
        return `New mail: ${command.address}.`
      case 'mailField':
        return command.field === 'subject' ? `Subject: ${command.text ?? ''}`.trim() : 'Adding a Cc.'
      // Round 8 (29.4.3): the engine says these itself, with the address.
      case 'savePlace':
        return `Saving the place "${command.noun}".`
      case 'removePlace':
        return `Removing the place "${command.noun}".`
      // ---------- reading aloud (29.5) ----------
      case 'read':
        return command.what === 'continue' ? EN.read.onward : command.what === 'stop' ? EN.read.stopped : EN.read.now
    }
  },
  browserDone(command, title, hints) {
    switch (command.kind) {
      case 'newTab':
        return title ? `New tab: ${title}.` : 'New tab open.'
      case 'closeTab':
        return 'Tab closed.'
      case 'switchTab':
        return title ? `Tab: ${title}.` : EN.browserDoing(command)
      case 'goTo':
        return title ? `Opened: ${title}.` : EN.browserDoing(command)
      case 'history':
        return title ? `${command.direction === 'back' ? 'Back' : 'Forward'}: ${title}.` : EN.browserDoing(command)
      case 'reload':
        return 'Page reloaded.'
      case 'showHints':
        return hints === null ? 'Numbers are showing. Say one.' : `${hints} numbers are showing. Say one.`
      case 'hideHints':
        return 'Numbers hidden.'
      case 'clickHint':
        return `Clicked ${command.number}.`
      case 'clickItem':
        return 'Clicked.'
      case 'focusItem':
      case 'arm':
        return command.kind === 'arm' && !command.on ? 'Not writing here any more.' : 'Field picked. Speak.'
      case 'siteSearch':
        return `Searched: ${command.query}`
      case 'clearField':
        return 'The field is empty.'
      default:
        return EN.browserDoing(command)
    }
  },
  browserFailed(command, code, message) {
    // ---------- reading aloud (29.5) ----------
    if (command.kind === 'read' && code === 'not_allowed') return EN.read.noVoice
    if (command.kind === 'read' && code === 'not_found') return command.what === 'continue' ? EN.read.ended : EN.read.nothing
    if (command.kind === 'read' && code === 'failed') return EN.read.failed
    switch (code) {
      case 'no_extension':
        return 'The browser extension is not answering. Install the Ütle extension and reload this page.'
      case 'no_target':
        return 'No browser window found. Open an ordinary Chrome window.'
      case 'not_found':
        if (command.kind === 'clickHint') return `There is no number ${command.number}.`
        if (command.kind === 'switchTab') return 'There is no such tab.'
        if (command.kind === 'openConversation') return `No conversation with ${command.name} was found.`
        if (command.kind === 'insertText') return 'No message box was found.'
        if (command.kind === 'clickItem' || command.kind === 'focusItem' || command.kind === 'hover' || command.kind === 'contextMenu' || command.kind === 'scrollTo') return 'That is no longer on the page. Say it again.'
        if (command.kind === 'siteSearch') {
          const buttons = dialogButtons(message)
          if (buttons) {
            const say = buttons.slice(0, 2).map((b) => `“${b}”`).join(' or ')
            return say === '' ? 'The search is behind a window on the page. Answer it first, then say the search again.' : `The search is behind a window on the page. Answer it first, for example ${say}, then say the search again.`
          }
          return 'This page has no search. Say "search google for".'
        }
        if (command.kind === 'media') return 'There is no video here.'
        if (command.kind === 'clearField' || command.kind === 'arm') return 'No field is picked. Say "show numbers" and a number.'
        if (command.kind === 'caret' || command.kind === 'select') return 'That text is not in the field.'
        if (command.kind === 'typeText') return 'No field is picked to write in.'
        // mail (29.3)
        if (command.kind === 'compose' || command.kind === 'composeTo') return 'Could not open a new mail. Open Gmail and say it again.'
        if (command.kind === 'mailField') return 'There is no open mail here. Say "new email".'
        return 'That was not found.'
      case 'not_allowed':
        return 'Ütle cannot control this page.'
      case 'failed':
        return 'That did not work.'
    }
  },

  draftStarted: (to) => (to ? `New message to ${to}.` : 'New message. It goes into the message box open in the browser.'),
  draftAlreadyOpen: 'A message is already open. Say send, or cancel the message.',
  draftEmpty: 'The message is still empty.',
  draftTextSummary: 'The message text.',
  answerFirst: 'Say yes or no first.',
  confirmSend: (to, text) => (to ? `To ${to}: "${text}" Send it?` : `Into the open message box: "${text}" Send it?`),
  sendYesOrNo: 'Send it? Say yes or no.',
  sendCancelled: 'Not sent. The message is still here.',
  sent: (to) => (to ? `Sent to ${to}. The document is back.` : 'Sent. The document is back.'),
  sendFailed: (reason) => `Not sent. ${reason} The message is still here.`,
  draftDropped: 'Message cancelled. The document is back.',
  noDraft: 'There is no message open.',
  browserTimedOut: 'The browser did not answer in time.',
  sendTimedOut: 'The browser did not answer in time. The message may or may not have gone: look at the conversation before you send it again.',

  inpage: {
    sleeping: 'Resting. Nothing will be typed.',
    resting: 'Resting. Say "wake up" to continue.',
    pickField: 'Where should it go? Say "show numbers" and the number of the box, or open a conversation, for example "message Mari".',
    sayWho: 'To whom? Say, for example, "message Mari".',
    nothingToSend: 'The message box is empty, there is nothing to send.',
    boxEmpty: 'The message box is empty.',
    boxNotFound: 'No message box was found.',
    notInText: (text) => `"${text}" is not in the text.`,
    replacing: (from, to) => `"${to}" instead of "${from}".`,
    deletingWord: 'Deleting the last word.',
    deletingSentence: 'Deleting the last sentence.',
    deletingNamed: (word) => `Deleting the word "${word}".`,
    clearing: 'Deleting everything.',
    newLine: 'New line.',
    mark: (mark) => ({ '.': 'Full stop.', ',': 'Comma.', '?': 'Question mark.', '!': 'Exclamation mark.' })[mark] ?? mark,
    undoing: 'Undoing.',
    written: 'Done.',
    conversationOpen: (name) => `Conversation open: ${name}.`,
    sent: 'Sent.',
    notSent: (reason) => `Not sent. ${reason}`,
    understood: (text) => `Understood: "${text}".`,
    notUnderstood: 'I did not understand. Say it another way, for example "open youtube" or "scroll down", or say "help".',
    thinking: 'Thinking…',
    modelOff: 'Free-form understanding is off: the server has no Anthropic key. Commands still work.',
    noPlaceToWrite: 'There is nowhere to write here. Say "write here" on a field, "show numbers" and a number, or open a conversation.',
    catchingUp: 'Catching up…',
    lateCommand: (say) => `Later: "${say}" was a command, text left as is.`,
    spellDigits: 'Writing as digits.',
    spellWords: 'Writing as words.',
    typedInto: (text) => `Typed: ${text} (say "next", "done" or "wrong")`,
    thinkingLong: 'Thinking it through…',
    tookTooLong: 'It took too long, I stopped it.',
    cancelled: 'Cancelled.',
    scrollEnded: 'Scrolling ended.',
    keptWords: 'The long sentence stays in the box; no command was run.',
    fieldUnverified: 'The assistant did not answer; nothing was typed into the field.',
    insertedSaved: (text, name) => `Typed: ${text} (${name}). Say "done", "next" or "wrong".`,
    insertedContact: (name, address) => `To: ${name} (${address}). Say "next" or "wrong".`,
    contactMail: (name, address) => `New mail: ${name} (${address}).`,
    wrongCleared: 'Deleted. Spell it letter by letter.',
    whichSaved: (names) => (names.length <= 2 ? `Which one: ${names.join(' or ')}?` : `Which one: ${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? ''}?`),
    whichItem: (names) => `Which one: ${names.map((name, i) => `${i + 1} ${name}`).join(', ')}?`,
    beside: 'In a new tab; this page stays.',
    savedMissing: 'That is no longer saved. Say "my details".',
    savedHint: (names) => ` Or say ${names.map((n) => `"${n}"`).join(' or ')}.`,
    entryGone: 'The My details page is not in front. Say "my details".',
    documentNoSend: 'Nothing is sent from a document.',
    reading: 'Reading it out.',
  },

  stillWorks: 'Yes, no and undo still work.',
  unreachable: 'The assistant is unreachable.',
  tooSlow: 'The assistant took too long.',
  unreadable: 'The assistant sent an answer I could not read.',
  assistantFailed: 'The assistant failed.',
  assistantRejected: 'The assistant rejected the request.',
  couldNotWork: 'I could not work that out. Nothing changed.',
  notSafe: 'I could not turn that into a safe edit. Nothing changed.',

  ui: {
    language: 'Language',
    docName: 'minutes-5-october.docx',
    draftName: (to) => (to ? `Message to ${to}` : 'New message'),
    micTurnOff: 'Turn the microphone off',
    micTurnOn: 'Turn the microphone on',
    voiceCheck: 'Voice check',
    backToDocument: 'Back to the document',
    noticeDemo: 'This is the scripted demo. Nobody is speaking; the lines play by themselves.',
    noticeRehearsal: 'Rehearsal: answers come from the demo script, not from a model.',
    noticeServerDown: 'The server is not answering. Start it with npm run dev.',
    noticeNoSpeech: 'This browser has no speech recognition. Use Chrome, or type.',
    noticeFakeBridge: 'The browser extension is replaced by a fake: commands do not reach a real browser.',
    typeInstead: 'Type instead of speaking',
    say: 'Say',
    yes: 'Yes',
    no: 'No',
    microphone: 'Microphone',
    micListening: 'Listening',
    micNotListening: 'Not listening',
    youCanSay: 'You can say',
    sayList: [
      ['What to change', 'Change the budget deadline to Friday'],
      ['Yes, no, or only the corrected word', 'Not Wednesday. Tuesday.'],
      ['A paragraph number', 'Six'],
      ['Where to go', 'Go to budget. Next. Top.'],
      ['What to read aloud', 'Read paragraph four. Stop.'],
      ['To take the last edit back', 'Undo'],
      ['In the browser', 'New tab. Open messenger. Page back. Scroll down.'],
      ['Buttons on a page', 'Show numbers. Click five.'],
      ['A message', 'Write to Mari that I will be there at three. Send.'],
      ['To be left alone', 'Stop listening. Wake up.'],
    ],
    changes: 'Changes',
    undoHint: 'Say undo to take the last one back.',
    startAgain: 'Start again with the sample document',
    document: 'Document',
    message: 'Message',
    recipient: 'To',
    noRecipient: 'the message box open in the browser',
    emptyDraft: 'The message is empty. Say what to write.',
  },

  check: {
    title: (language) => `Voice check, ${language}`,
    intro: 'Read each line aloud. The next line lights up when one has been heard. The score is the share of words the recogniser got wrong.',
    stop: 'Stop',
    start: 'Start',
    continue: 'Continue',
    startOver: 'Start over',
    copy: 'Copy the result',
    copied: 'Copied',
    listening: 'Listening.',
    right: 'right',
    wrong: (n) => `${n} wrong`,
    percentWrong: 'percent of words wrong',
    ofWords: (errors, words, finished) => `: ${errors} of ${words}${finished ? '.' : ' so far.'}`,
    report: (language, errors, words, percent) => `Ütle voice check, ${language}: ${errors} of ${words} words wrong (${percent} percent).`,
    reportLine: (n, expected, heard, errors) => `${n}. expected "${expected}" heard "${heard}" errors ${errors}`,
    noSpeech: 'This browser has no speech recognition. Use Chrome.',
  },

  strip: {
    micLabel: 'Microphone on or off',
    listening: 'Listening',
    notListening: 'Not listening',
    resting: 'Resting',
    sayPrompt: 'Speak. The words go into the message box.',
    modelUnreachable: 'The speech model is not answering. Start it on this computer with npm run dev.',
    micBlocked: 'The microphone is blocked. Allow it on the page that opened.',
    permissionTitle: 'Ütle needs the microphone',
    permissionAsk: 'Press “Allow” in the browser’s question. This page closes itself.',
    permissionDone: 'The microphone is allowed. This page is closing.',
    permissionRetry: 'Try again',
    // The new-tab page (21.3), ext lane.
    newTabTitle: 'New tab',
    newTabHint: 'Rest your eyes on a tile for one second to open it. Or say “show numbers” and a number.',
    hide: 'Hide',
    show: 'Show',
    settings: 'Settings',
    thinking: 'Thinking',
    examples: HELP_EXAMPLES_EN,
    examplesLead: 'Say:',
    optionsTitle: 'Ütle settings',
    optionsHelp: 'Rest your eyes on a button for one second, or say “show numbers” and then the number. A choice is saved at once.',
    optionsHelpEn: '',
    barHeight: 'Bar height',
    barSmall: 'Small',
    barNormal: 'Normal',
    barLarge: 'Large',
    micSide: 'Microphone',
    micSideEn: '',
    micLeft: 'Left',
    micRight: 'Right',
    startHidden: 'Bar at start',
    startShown: 'Shown',
    startFolded: 'Folded',
    advanced: 'Advanced',
    advancedEn: '',
    asrUrl: 'Speech model address',
    utleUrl: 'Address of the Ütle development page',
    save: 'Save',
    saved: 'Saved.',
    notAnAddress: (value) => `Not a full address: ${value}`,
    savedReload: 'Saved. Reload the extension for a new speech address to take effect.',
    gazeOff: 'Look here and speak',
    lagLine: (seconds) => `Speech is ${seconds} s behind`,
    listenMode: 'Listening',
    listenModeEn: '',
    listenToggle: 'Toggle',
    listenToggleEn: 'A click or a one-second look turns it on and off',
    listenGaze: 'By looking',
    listenGazeEn: 'It listens while you look at the microphone',
    gazeTarget: 'Gaze target',
    gazeTargetEn: '',
    gazeMic: 'Microphone',
    gazeMicEn: 'The microphone square',
    gazeBar: 'The whole bar',
    gazeBarEn: 'The whole bar',
    myVoice: 'My voice',
    myVoiceEn: '',
    onlyOwner: 'Listen only to me',
    onlyOwnerEn: '',
    everyone: 'Listen to everyone',
    everyoneEn: '',
    voiceNote: '"Listen only to me" needs the learnt voice and the speaker model on the dev server (npm run model). Without the model or a learnt voice nobody is obeyed. The choice takes effect the next time listening starts. The server keeps only numbers about the voice (its description, how many phrases, their length and loudness, the line and the check phrases’ result, dates), never audio or text. "Delete my voice" deletes them.',
    voiceNoteEn: '',
    enrolStart: (seconds) => `Speak for ${seconds} seconds in your usual voice…`,
    enrolDone: 'Your voice is learnt.',
    enrolFailed: 'Learning your voice did not work.',
    foreign: 'Someone else spoke; skipped it.',
    foreignRetrain: 'If that was you, teach it your voice again in the settings.',
    voiceUnverified: 'Could not confirm the voice.',
    voiceTooShort: 'Too short to check the voice. Say it longer: "saada sõnum" or "jah, kinnitan".',
    voiceUnsupported: 'The voice cannot be checked right now. Choose the local speech engine in the settings, or allow all voices.',
    voiceNoProfile: 'Teach me your voice first.',
    voiceNoProfileHow: 'Look at the bar\'s "Settings" button and choose "Teach it my voice with sentences" or "Listen to everyone".',
    voiceMismatch: 'The voice was taught with another model. Teach it again: the bar\'s "Settings" button.',
    guardWaiting: 'Noted: "Listen only to me" turns on once your voice is taught. Until then I listen to everyone.',
    phraseProblem: {
      too_short: 'The sentence was too short. Read it again.',
      too_quiet: 'Too quiet. Speak closer to the microphone and read it again.',
      clipped: 'Too loud, the sound distorts. Speak a little softer and read it again.',
      model_error: 'The voice could not be measured. Read it again.',
      slow: 'The computer is slow right now. Wait a moment, the sentence you read is still on its way.',
    },
    enrolFailedWhy: {
      too_few_phrases: 'Too few sentences, at least six are needed. The voice you had is kept.',
      too_little_speech: 'Too little speech. The voice you had is kept.',
      held_out_failed: 'I did not know you on the last two sentences. The voice you had is kept. Try again somewhere quieter.',
      write_failed: 'The voice could not be saved. The voice you had is kept.',
      model_unavailable: 'The speaker model is not running (npm run model). The voice you had is kept.',
    },
    enrolVerified: (phrases, held) => `Your voice is learnt from ${phrases} sentences and checked on ${held} new ones.`,
    readiness: {
      ready: 'Listening only to you: the voice is checked.',
      no_profile: 'No voice is learnt, so "Listen only to me" obeys no one. Teach your voice or choose "Listen to everyone".',
      needs_retraining: 'The voice was learnt in an old format and protects nothing. Teach it again.',
      model_unavailable: 'The speaker model is not running, the voice cannot be checked. I obey no one.',
      model_mismatch: 'The voice was learnt with another model and protects nothing. Teach it again.',
    },
    voiceTest: {
      recognised: 'I know your voice.',
      not_recognised: 'I did not know your voice. Try again or teach it again.',
      too_short: 'Too short. Say a longer sentence.',
      noisy: 'Too noisy or too loud. Try somewhere quieter.',
      unavailable: 'The voice cannot be checked right now.',
    },
    voiceTestSay: 'Say in your usual voice:',
    voiceDeleted: 'The voice is deleted. "Listen only to me" obeys no one until you teach it again.',
    voiceDeleteFailed: 'The voice could not be deleted.',
    deleteVoice: 'Delete my voice',
    deleteVoiceEn: '',
    testVoice: 'Check my voice',
    testVoiceEn: '',
    teachScript: 'Teach it my voice with sentences',
    teachScriptEn: 'Read 12 short sentences aloud',
    teachFree: 'Teach it by speaking freely',
    teachFreeEn: 'Speak for 8 seconds',
    scriptStart: 'Read this sentence in your usual voice. The next one comes by itself.',
    scriptStep: (at, total) => `${at} / ${total}`,
    scriptFinish: 'Done',
    scriptFinishEn: '',
    enrolPhrasesDone: (phrases) => `Your voice is learnt from ${phrases} sentences.`,
    enrolFew: (phrases, enough) => `Your voice is learnt from only ${phrases} sentences. ${enough} or more is surer: teach it again if it does not know you.`,
    // The hosted server (round 6, HOST lane).
    serverTitle: 'Server',
    serverAddress: 'Server address',
    serverAddressHelp: 'Leave empty when the server runs on this computer.',
    serverToken: 'Server token',
    serverTest: 'Test the connection',
    serverChecking: 'Testing…',
    serverOk: (speech, understanding) => {
      return `Connected: ${speech.local ? "TalTech's speech model" : 'no speech model'}, understanding ${understanding ? 'on' : 'off'}.`
    },
    serverUnreachable: 'Cannot connect.',
    serverWrongToken: 'Wrong token.',
    serverProfile: (profile) => `Profile: ${profile.name}, voice ${profile.enrolled ? 'learnt' : 'not learnt yet'}.`,
    badToken: 'The server token is wrong.',
    // ---------- the first run (30.1, ONBOARD lane) ----------
    serverDownLocal: 'The speech server is not answering. Ask your helper to start it (npm run dev).',
    serverDownHosted: 'The speech server is not answering. Check the internet connection or ask your helper to look at the server.',
    serverBack: 'The server is answering again.',
    connConnected: 'Connected',
    connConnecting: 'Connecting',
    connDown: 'The server is not answering',
    helpTitle: 'What you can say',
    helpHint: 'Rest your eyes on a group for one second to open it. Or say “show numbers” and a number. “read aloud” reads the open group.',
    askingFold: 'The bar is hidden while the page is asking.',
  },

  andmed: {
    title: 'My details',
    titleEn: '',
    help: 'Save an e-mail, a phone number or an ID code once. Say “add a new email” or rest your eyes on a button. Afterwards say “my email” in a form field.',
    helpEn: '',
    empty: 'Nothing is saved yet.',
    sayLine: (phrases) => `Say: ${phrases.join(', ')}`,
    edit: 'Change',
    forget: 'Forget',
    forgotten: (name) => `Forgot: ${name}.`,
    add: (kind) => `Add ${({ email: 'e-mail', tel: 'phone', code: 'ID code', number: 'number', text: 'other', contact: 'contact' } as const)[kind]}`,
    kindName: (kind) => ({ email: 'e-mail', tel: 'phone', code: 'ID code', number: 'number', text: 'other', contact: 'Contact: a name and an e-mail address' } as const)[kind],
    defaultName: (kind) => ({ email: 'minu e-post', tel: 'minu telefon', code: 'minu isikukood', number: 'minu number', text: 'minu tekst', contact: 'kontakt' } as const)[kind],
    formTitle: 'By keyboard (a helper)',
    formName: 'Name',
    formKind: 'Kind',
    formValue: 'Value',
    formSave: 'Save',
    formMissing: 'A name and a value are needed.',
    formSaved: (name) => `Saved: ${name}.`,
    askKind: 'What to save? Say "email", "phone", "ID code" or "other".',
    askName: 'Under what name? Say for example "work email".',
    nameTaken: (name) => `"${name}" exists already. Say another name.`,
    stepValue: 'Spell it letter by letter; "dot" is ., "at" is @; "done" saves.',
    suffixHint: 'For the ending say "gmail", "hotmail" or "mail dot ee".',
    now: (value, suffix) => `Now: ${value}${suffix}`,
    readBack: (spoken, suffix) => `Now: ${spoken}${suffix === '' ? '' : `, ending ${suffix}`}.`,
    nothingYet: 'Nothing yet. Spell it letter by letter.',
    needAt: 'The address has no @. Say "at" or "gmail".',
    needDigit: 'No digits yet. Say the numbers.',
    savedOk: (name) => `Saved: ${name}. Say "${name}" in a form field.`,
    abandoned: 'Cancelled, nothing was saved.',
    stepTitle: 'Adding by voice',
    suffixLabel: 'ending',
    done: 'Done',
    cancel: 'Cancel',
  },
  // ---------- wake word and places (29.4) ----------
  wake: {
    prompt: (word) => `Listening. Start with "${word}".`,
    passive: (word) => `Waiting for "${word}".`,
    active: 'Listening to you.',
    notForMe: (count) => (count === 1 ? '1 sentence was not for me' : `${count} sentences were not for me`),
    uploadsOff: 'The wake word works only with the speech server on this computer: otherwise all the sound in the room would leave it. Choose the toggle in the settings, or use this computer’s server.',
    listenWake: 'Wake word',
    listenWakeEn: 'Always listening, acts on what starts with the word',
    wordLabel: 'Wake word',
    wordHelp: 'One or two words. Anything that does not start with it is skipped.',
    wordSave: 'Save the word',
    wordSaved: (word) => `The wake word is now "${word}".`,
    opening: (label) => `Opening ${label}.`,
    missing: 'That place is no longer in the settings.',
    placesTitle: 'My places',
    placesTitleEn: 'A word opens a site',
    placesHelp: 'Say "show the news", "open the radio" or "what is the weather". To add your own, open the page and say "save this place as news"; "remove place news" removes it. Your row replaces the default one.',
    placeNoun: 'Word (e.g. news)',
    placeUrl: 'Address (e.g. postimees.ee)',
    placeAdd: 'Add the place',
    placeRemove: 'Remove',
    placeAdded: (noun) => `Place "${noun}" saved.`,
    placeRemoved: (noun) => `Place "${noun}" removed.`,
    placeBad: 'Type a word and an address (https://… or name.ee).',
    sayLine: (noun) => `Say: open ${noun}`,
    placeSaved: (noun, host) => `Place "${noun}" saved: ${host}`,
    placeAsk: 'Say what word to call this place.',
    placeAskRemove: 'Say which place to remove.',
    placeNotSaved: 'This page cannot be saved as a place.',
    placeNotThere: (noun) => `There is no place "${noun}".`,
  },
  // ---------- end of wake word and places ----------
  // ---------- reading aloud (29.5) ----------
  read: {
    now: 'Reading…',
    onward: 'Reading on…',
    stopped: 'Reading stopped.',
    noVoice: 'This browser has no Estonian voice; Edge has one.',
    skipped: 'I skipped one sentence.',
    ended: 'Nothing more to read.',
    nothing: 'Nothing here to read.',
    failed: 'Could not read aloud.',
    barTitle: 'Read the bar aloud',
    barOn: 'Read aloud',
    barOff: 'Silent',
    barNote: 'New lines of the bar are read in an Estonian voice (Edge has one). While the bar speaks, the microphone does not listen.',
  },
  // ---------- the first run (30.1, ONBOARD lane) ----------
  welcome: {
    title: 'Getting started',
    intro: 'Five steps. A helper does them once; after that Ütle is used by voice alone.',
    how: 'Rest your eyes on a button for one second to press it. Or say “show numbers” and a number.',
    done: 'Done',
    micTitle: 'Microphone',
    micBody: 'Ütle listens to the microphone for the whole browser. Press “Allow” in the browser’s question.',
    micAsk: 'Allow the microphone',
    micGranted: 'The microphone is allowed.',
    micDenied: 'The microphone is blocked. Allow it from the lock icon in the address bar, then press “Try again”.',
    serverTitle: 'The speech server',
    serverBody: 'Ütle sends speech to a server that recognises it. Choose where the server runs.',
    choiceLocal: 'On this computer',
    choiceLocalNote: 'The server is started on this computer with npm run dev.',
    choiceHosted: 'On another computer',
    choiceHostedNote: 'The address and the token come from whoever runs the server.',
    hintLocal: 'Start the server on this computer with npm run dev.',
    hintHosted: 'Check the internet connection, the address and the token.',
    tryTitle: 'Try it',
    tryBody: 'Press the microphone and say: tere',
    tryArm: 'Write here',
    tryWaiting: 'The words appear in this box.',
    tryWorks: 'It works.',
    voiceTitle: 'Teach it my voice',
    voiceBody: 'Read 12 short sentences in your usual voice. After each one I say whether it was good. The last two are a check: on them I see whether I know you. No sound is stored, only a description of the voice.',
    voiceDone: 'The voice is learnt.',
    voiceStart: 'Start reading',
    voiceFinish: 'Finish with these sentences',
    voiceStep: (at, of) => `Sentence ${at} / ${of}`,
    testTitle: 'Check my voice',
    testBody: 'Say one new sentence. Ütle does nothing with it, it only says whether it knew you.',
    testStart: 'Check my voice',
    guardTitle: 'Listen only to me',
    guardBody: 'When this is on, Ütle does nothing anyone else says. It is not secure identity verification.',
    guardOn: 'Turn it on',
    guardOnSub: 'Listen only to me',
    guardAll: 'Listen to everyone',
    guardAllSub: 'Every voice, no protection',
    guardOnDone: 'On: listening only to you.',
    guardAllDone: 'Listening to every voice. Protection is off.',
    readyTitle: 'Ready',
    readyBody: 'Say, for example:',
    readyDone: 'Everything is ready.',
    help: 'Help',
    menuWelcome: 'Getting started',
    menuSettings: 'Settings',
    menuHelp: 'Help',
  },
}

import type { BrowserCommand, BrowserFailure, MediaAction, PressableKey } from '../browser/protocol.ts'

/**
 * Every line a person can read in Ütle, in one table keyed by language, so a native speaker
 * proofreads one file. Estonian is the default (docs/ARCHITECTURE.md section 20.3).
 */
export type Lang = 'et' | 'en'

export const DEFAULT_LANG: Lang = 'et'

/** The recogniser's BCP 47 tag for each language. */
export const LANG_TAG: Record<Lang, string> = { et: 'et-EE', en: 'en-US' }

/** The interface language for a recogniser tag. Anything Estonian is Estonian, the rest English. */
export function langOfTag(tag: string): Lang {
  return tag.toLowerCase().startsWith('et') ? 'et' : 'en'
}

export interface Strings {
  // What the user can say next, per mode.
  promptListening: string
  promptThinking: string
  promptConfirming: string
  promptAsleep: string
  promptReading: string
  promptChoosing(count: number): string
  promptDraft: string
  promptConfirmSend: string
  promptSending: string

  // What the editor made of an utterance.
  waiting: string
  stillWorking: string
  nothingToConfirm: string
  noLongerFits: string
  saved: string
  asleep: string
  listeningAgain: string
  alreadyListening: string
  helpShown: string
  nothingToUndo: string
  undone(what: string): string
  lastEdit: string
  noParagraph(n: number): string
  paragraph(n: number): string
  readingParagraph(n: number): string
  discarded: string
  dropped: string
  nothingToChoose: string
  countToChoose(n: number): string
  didNotFit: string
  couldNotTell: string
  placeNotFound: string
  stoppedReading: string
  nothingRead: string

  // Local document commands.
  sayWhichToRead: string
  sayWhichToDelete: string
  noParagraphOf(n: number, total: number): string
  paragraphDeleted(n: number): string

  // Browser commands: while on the way, after success, after failure.
  browserDoing(command: BrowserCommand): string
  browserDone(command: BrowserCommand, tabTitle: string | null, hints: number | null): string
  browserFailed(command: BrowserCommand, code: BrowserFailure): string

  // Messages.
  draftStarted(to: string | null): string
  draftAlreadyOpen: string
  draftEmpty: string
  draftTextSummary: string
  answerFirst: string
  confirmSend(to: string | null, text: string): string
  sendYesOrNo: string
  sendCancelled: string
  sent(to: string | null): string
  sendFailed(reason: string): string
  draftDropped: string
  noDraft: string
  browserTimedOut: string
  sendTimedOut: string

  // In-page mode (section 21.1): what an utterance did to the site's message box.
  inpage: {
    sleeping: string
    resting: string
    pickField: string
    sayWho: string
    nothingToSend: string
    boxEmpty: string
    boxNotFound: string
    notInText(text: string): string
    replacing(from: string, to: string): string
    deletingWord: string
    deletingSentence: string
    clearing: string
    newLine: string
    mark(mark: string): string
    undoing: string
    written: string
    conversationOpen(name: string): string
    sent: string
    notSent(reason: string): string
    /** Section 21.3: what a misheard or inflected command was taken to be, before the usual line. */
    understood(text: string): string
    // M7.
    /** Neither the rules nor the model could tell what was meant. */
    notUnderstood: string
    /** The model is being asked. */
    thinking: string
    /** The free-form understanding is off (no key, no server). */
    modelOff: string
    /** Dictation with no armed box: where the words can go. */
    noPlaceToWrite: string
    // Round 3.
    /** Suffix on the line of an utterance that waited too long in the queue and got the rules alone. */
    catchingUp: string
    /** A verification came back as a command after the box had changed: nothing was touched. */
    lateCommand(say: string): string
  }

  // The interpreter.
  stillWorks: string
  unreachable: string
  tooSlow: string
  unreadable: string
  assistantFailed: string
  assistantRejected: string
  couldNotWork: string
  notSafe: string

  // Interface chrome.
  ui: {
    language: string
    docName: string
    draftName(to: string | null): string
    micTurnOff: string
    micTurnOn: string
    voiceCheck: string
    backToDocument: string
    noticeDemo: string
    noticeRehearsal: string
    noticeServerDown: string
    noticeNoSpeech: string
    noticeFakeBridge: string
    typeInstead: string
    say: string
    yes: string
    no: string
    microphone: string
    micListening: string
    micNotListening: string
    youCanSay: string
    sayList: ReadonlyArray<readonly [string, string]>
    changes: string
    undoHint: string
    startAgain: string
    document: string
    message: string
    recipient: string
    noRecipient: string
    emptyDraft: string
  }

  check: {
    title(language: string): string
    intro: string
    stop: string
    start: string
    continue: string
    startOver: string
    copy: string
    copied: string
    listening: string
    right: string
    wrong(n: number): string
    percentWrong: string
    ofWords(errors: number, words: number, finished: boolean): string
    report(language: string, errors: number, words: number, percent: number): string
    reportLine(n: number, expected: string, heard: string, errors: number): string
    noSpeech: string
  }

  // The extension's strip and its permission page (in-page mode, section 21.2).
  strip: {
    micLabel: string
    listening: string
    notListening: string
    resting: string
    sayPrompt: string
    modelUnreachable: string
    micBlocked: string
    permissionTitle: string
    permissionAsk: string
    permissionDone: string
    permissionRetry: string
    // The new-tab page (21.3), ext lane.
    newTabTitle: string
    newTabHint: string
    // The strip's controls and the pill (M7, ui lane).
    hide: string
    show: string
    settings: string
    thinking: string
    /** Example phrases, shown three at a time under the new tab's tiles. */
    examples: readonly string[]
    examplesLead: string
    // The options page (M7, ui lane). Estonian first, English as the second line.
    optionsTitle: string
    optionsHelp: string
    optionsHelpEn: string
    barHeight: string
    barHeightEn: string
    barSmall: string
    barNormal: string
    barLarge: string
    micSide: string
    micSideEn: string
    micLeft: string
    micRight: string
    startHidden: string
    startHiddenEn: string
    startShown: string
    startFolded: string
    advanced: string
    advancedEn: string
    asrUrl: string
    utleUrl: string
    save: string
    saved: string
    notAnAddress(value: string): string
    savedReload: string
    // Push-to-talk by looking (round 3, ptt lane).
    /** The microphone's label in gaze mode while it is off. */
    gazeOff: string
    /** The thin line under the done line when the speech server is behind by this many seconds. */
    lagLine(seconds: number): string
    listenMode: string
    listenModeEn: string
    listenToggle: string
    listenToggleEn: string
    listenGaze: string
    listenGazeEn: string
    gazeTarget: string
    gazeTargetEn: string
    gazeMic: string
    gazeMicEn: string
    gazeBar: string
    gazeBarEn: string
    speechEngine: string
    speechEngineEn: string
    engineLocal: string
    engineLocalEn: string
    engineSoniox: string
    engineSonioxEn: string
    engineNote: string
    engineNoteEn: string
  }
}

/** The address without scheme and www, or the search words of a Google search. */
function placeOf(url: string): { search: string | null; host: string } {
  const search = /^https:\/\/www\.google\.com\/search\?q=([^&]*)/.exec(url)
  if (search?.[1] !== undefined) {
    let words = search[1]
    try {
      words = decodeURIComponent(words.replace(/\+/g, ' '))
    } catch {
      // A malformed escape is shown as it is.
    }
    return { search: words, host: 'google.com' }
  }
  const host = /^[a-z]+:\/\/(?:www\.)?([^/?#]+)/i.exec(url)?.[1] ?? url
  return { search: null, host }
}

const KEY_ET: Record<PressableKey, string> = {
  Escape: 'Sulgen.',
  Enter: 'Kinnitan.',
  Tab: 'Järgmine väli.',
  Backspace: 'Kustutan tagant.',
  Delete: 'Kustutan eest.',
  ArrowLeft: 'Vasakule.',
  ArrowRight: 'Paremale.',
  ArrowUp: 'Üles.',
  ArrowDown: 'Alla.',
  Home: 'Rea algusesse.',
  End: 'Rea lõppu.',
  Undo: 'Võtan tagasi.',
  Redo: 'Teen uuesti.',
  SelectAll: 'Valin kõik.',
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

const MEDIA_ET: Record<MediaAction, string> = {
  play: 'Mängin.',
  pause: 'Paus.',
  toggle: 'Mängin või peatan.',
  mute: 'Vaigistan.',
  unmute: 'Heli tagasi.',
  volumeUp: 'Heli valjemaks.',
  volumeDown: 'Heli vaiksemaks.',
  fullscreen: 'Täisekraan.',
  exitFullscreen: 'Täisekraanist välja.',
  forward: 'Edasi kümme sekundit.',
  back: 'Tagasi kümme sekundit.',
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

const ET: Strings = {
  promptListening: 'Ütle, mida muuta, või lõigu number.',
  promptThinking: 'Hetk.',
  promptConfirming: 'Ütle jah või ei või ainult parandatud sõna.',
  promptAsleep: 'Jätkamiseks ütle „ärka üles“.',
  promptReading: 'Lugemise lõpetamiseks ütle „stopp“.',
  promptChoosing: (count) => `Ütle number 1 kuni ${count} või ei.`,
  promptDraft: 'Ütle, mida kirjutada. Kui valmis, ütle „saada“.',
  promptConfirmSend: 'Ütle jah või ei.',
  promptSending: 'Saadan.',

  waiting: 'Kuulan.',
  stillWorking: 'Hetk, eelmine on veel pooleli.',
  nothingToConfirm: 'Pole midagi kinnitada.',
  noLongerFits: 'See ei sobi enam dokumenti. Midagi ei muutunud.',
  saved: 'Tehtud. Muudatus on märgitud.',
  asleep: 'Puhkan. Ma ei kuula.',
  listeningAgain: 'Kuulan.',
  alreadyListening: 'Kuulan juba.',
  helpShown: 'Siin on, mida saad öelda.',
  nothingToUndo: 'Pole midagi tagasi võtta.',
  undone: (what) => `Tagasi võetud: ${what}`,
  lastEdit: 'viimane muudatus',
  noParagraph: (n) => `Lõiku ${n} ei ole.`,
  paragraph: (n) => `Lõik ${n}.`,
  readingParagraph: (n) => `Loen lõiku ${n}.`,
  discarded: 'Loobusin. Midagi ei muutunud.',
  dropped: 'Loobusin. Midagi ei muutunud.',
  nothingToChoose: 'Pole midagi valida.',
  countToChoose: (n) => `Valikuid on ${n}.`,
  didNotFit: 'See ei sobinud dokumenti. Midagi ei muutunud.',
  couldNotTell: 'Ma ei saanud aru, millist kohta mõtled. Ütle teisiti.',
  placeNotFound: 'Ma ei leidnud seda kohta.',
  stoppedReading: 'Lõpetasin lugemise.',
  nothingRead: 'Praegu ma midagi ei loe.',

  sayWhichToRead: 'Ütle, millist lõiku lugeda.',
  sayWhichToDelete: 'Ütle, millist lõiku kustutada.',
  noParagraphOf: (n, total) => `Lõiku ${n} ei ole. Dokumendis on ${total} lõiku.`,
  paragraphDeleted: (n) => `Kustutan lõigu ${n}.`,

  browserDoing(command) {
    switch (command.kind) {
      case 'ping':
        return 'Kontrollin laiendust.'
      case 'newTab':
        return 'Avan uue vahelehe.'
      case 'closeTab':
        return 'Sulgen vahelehe.'
      case 'switchTab': {
        const to = command.to
        if (to === 'next') return 'Järgmine vaheleht.'
        if (to === 'previous') return 'Eelmine vaheleht.'
        return 'index' in to ? `Vaheleht ${to.index}.` : `Otsin vahelehte: ${to.query}.`
      }
      case 'goTo': {
        const place = placeOf(command.url)
        return place.search !== null ? `Otsin: ${place.search}` : `Avan: ${place.host}`
      }
      case 'history':
        return command.direction === 'back' ? 'Tagasi.' : 'Edasi.'
      case 'reload':
        return 'Laadin lehe uuesti.'
      case 'scroll':
        if (command.mode === 'stop') return 'Kerimine seis.'
        if (command.mode === 'slow') return command.direction === 'up' ? 'Kerin aeglaselt üles.' : 'Kerin aeglaselt alla.'
        return { down: 'Kerin alla.', up: 'Kerin üles.', top: 'Lehe algusesse.', bottom: 'Lehe lõppu.' }[command.direction]
      case 'showHints':
        return 'Näitan numbreid.'
      case 'hideHints':
        return 'Peidan numbrid.'
      case 'clickHint':
        return `Vajutan ${command.number}.`
      case 'openConversation':
        return `Avan vestluse: ${command.name}.`
      case 'insertText':
        return 'Kirjutan sõnumi.'
      case 'readBox':
        return 'Loen sõnumikasti.'
      case 'setText':
        return 'Kirjutan.'
      case 'pressSend':
        return 'Saadan.'
      case 'readPage':
        return 'Vaatan lehte.'
      case 'clickItem':
        return 'Vajutan.'
      case 'focusItem':
        return 'Valin kasti.'
      case 'siteSearch':
        return `Otsin siit: ${command.query}`
      case 'media':
        return MEDIA_ET[command.action]
      case 'pressKey':
        return KEY_ET[command.key]
      case 'caret':
        return 'Liigutan kursorit.'
      case 'select':
        return 'Valin teksti.'
      case 'typeText':
        return 'Kirjutan siia.'
      case 'clearField':
        return 'Tühjendan kasti.'
      case 'arm':
        return command.on ? 'Kirjutan siia.' : 'Siia enam ei kirjuta.'
      case 'bar':
        return command.show ? 'Näitan riba.' : 'Peidan riba.'
    }
  },
  browserDone(command, title, hints) {
    switch (command.kind) {
      case 'newTab':
        return title ? `Uus vaheleht: ${title}.` : 'Uus vaheleht on avatud.'
      case 'closeTab':
        return 'Vaheleht on suletud.'
      case 'switchTab':
        return title ? `Vaheleht: ${title}.` : ET.browserDoing(command)
      case 'goTo':
        return title ? `Avatud: ${title}.` : ET.browserDoing(command)
      case 'history':
        return title ? `${command.direction === 'back' ? 'Tagasi' : 'Edasi'}: ${title}.` : ET.browserDoing(command)
      case 'reload':
        return 'Leht on uuesti laaditud.'
      case 'showHints':
        return hints === null ? 'Numbrid on näha. Ütle number.' : `Numbrid on näha (${hints}). Ütle number.`
      case 'hideHints':
        return 'Numbrid on peidetud.'
      case 'clickHint':
        return `Vajutasin ${command.number}.`
      case 'clickItem':
        return 'Vajutatud.'
      case 'focusItem':
      case 'arm':
        return command.kind === 'arm' && !command.on ? 'Siia enam ei kirjuta.' : 'Kast on valitud. Räägi.'
      case 'siteSearch':
        return `Otsisin: ${command.query}`
      case 'clearField':
        return 'Kast on tühi.'
      default:
        return ET.browserDoing(command)
    }
  },
  browserFailed(command, code) {
    switch (code) {
      case 'no_extension':
        return 'Brauseri laiendus ei vasta. Paigalda Ütle laiendus ja laadi see leht uuesti.'
      case 'no_target':
        return 'Ei leidnud brauseriakent. Ava Chrome’is tavaline aken.'
      case 'not_found':
        if (command.kind === 'clickHint') return `Numbrit ${command.number} ei ole.`
        if (command.kind === 'switchTab') return 'Sellist vahelehte ei ole.'
        if (command.kind === 'openConversation') return `Vestlust „${command.name}“ ei leitud.`
        if (command.kind === 'insertText') return 'Sõnumikasti ei leitud.'
        if (command.kind === 'clickItem' || command.kind === 'focusItem') return 'Seda ei ole enam lehel. Ütle uuesti.'
        if (command.kind === 'siteSearch') return 'Sellel lehel ei ole otsingut. Ütle „otsi googlest“.'
        if (command.kind === 'media') return 'Siin ei ole videot.'
        if (command.kind === 'clearField' || command.kind === 'arm') return 'Ühtegi kasti ei ole valitud. Ütle „näita numbreid“ ja number.'
        if (command.kind === 'caret' || command.kind === 'select') return 'Seda teksti kastis ei ole.'
        if (command.kind === 'typeText') return 'Ühtegi kasti ei ole valitud, kuhu kirjutada.'
        return 'Seda ei leitud.'
      case 'not_allowed':
        return 'Seda lehte ei saa Ütle juhtida.'
      case 'failed':
        return 'See ei õnnestunud.'
    }
  },

  draftStarted: (to) => (to ? `Uus sõnum. Saaja: ${to}.` : 'Uus sõnum. See läheb brauseris avatud sõnumikasti.'),
  draftAlreadyOpen: 'Üks sõnum on juba pooleli. Ütle „saada“ või „katkesta sõnum“.',
  draftEmpty: 'Sõnum on veel tühi.',
  draftTextSummary: 'Sõnumi tekst.',
  answerFirst: 'Ütle enne jah või ei.',
  confirmSend: (to, text) => (to ? `Saaja: ${to}. „${text}“ Kas saadan?` : `Avatud sõnumikasti: „${text}“ Kas saadan?`),
  sendYesOrNo: 'Kas saadan? Ütle jah või ei.',
  sendCancelled: 'Ei saatnud. Sõnum on alles.',
  sent: (to) => (to ? `Saadetud. Saaja: ${to}. Dokument on tagasi.` : 'Saadetud. Dokument on tagasi.'),
  sendFailed: (reason) => `Ei saatnud. ${reason} Sõnum on alles.`,
  draftDropped: 'Sõnum on katkestatud. Dokument on tagasi.',
  noDraft: 'Pooleli sõnumit ei ole.',
  browserTimedOut: 'Brauser ei vastanud õigel ajal.',
  sendTimedOut: 'Brauser ei vastanud õigel ajal. Sõnum võis minna või mitte: vaata vestlus üle, enne kui uuesti saadad.',

  inpage: {
    sleeping: 'Puhkan. Midagi ei kirjutata.',
    resting: 'Puhkan. Jätkamiseks ütle „ärka üles“.',
    pickField: 'Kuhu kirjutada? Ütle „näita numbreid“ ja siis kasti number või ava vestlus, näiteks „kirjuta Marile“.',
    sayWho: 'Kellele? Ütle näiteks „kirjuta Marile“.',
    nothingToSend: 'Sõnumikast on tühi, pole midagi saata.',
    boxEmpty: 'Sõnumikast on tühi.',
    boxNotFound: 'Sõnumikasti ei leitud.',
    notInText: (text) => `„${text}“ ei ole tekstis.`,
    replacing: (from, to) => `„${from}“ asemel „${to}“.`,
    deletingWord: 'Kustutan viimase sõna.',
    deletingSentence: 'Kustutan viimase lause.',
    clearing: 'Kustutan kõik.',
    newLine: 'Uus rida.',
    mark: (mark) => ({ '.': 'Punkt.', ',': 'Koma.', '?': 'Küsimärk.', '!': 'Hüüumärk.' })[mark] ?? mark,
    undoing: 'Võtan tagasi.',
    written: 'Tehtud.',
    conversationOpen: (name) => `Vestlus avatud: ${name}.`,
    sent: 'Saadetud.',
    notSent: (reason) => `Ei saatnud. ${reason}`,
    understood: (text) => `Sain aru: „${text}“.`,
    notUnderstood: 'Ei saanud aru. Ütle teisiti, näiteks „ava youtube“ või „keri alla“.',
    thinking: 'Mõtlen…',
    modelOff: 'Vaba kõne mõistmine on väljas: serveril pole Anthropicu võtit. Käsud töötavad.',
    noPlaceToWrite: 'Siin pole kuhu kirjutada. Ütle „kirjuta siia“ kasti peal, „näita numbreid“ ja number, või ava vestlus.',
    catchingUp: 'Jõuan järele…',
    lateCommand: (say) => `Hiljem: see oli käsk „${say}“, teksti ei muutnud.`,
  },

  stillWorks: 'Jah, ei ja tagasivõtmine töötavad edasi.',
  unreachable: 'Abiline ei vasta.',
  tooSlow: 'Abiline mõtles liiga kaua.',
  unreadable: 'Abilise vastusest ei saanud aru.',
  assistantFailed: 'Abiline ei saanud hakkama.',
  assistantRejected: 'Abiline keeldus päringust.',
  couldNotWork: 'Ma ei saanud sellest aru. Midagi ei muutunud.',
  notSafe: 'Sellest ei tulnud ohutut muudatust. Midagi ei muutunud.',

  ui: {
    language: 'Keel',
    docName: 'protokoll-5-oktoober.docx',
    draftName: (to) => (to ? `Sõnum: ${to}` : 'Uus sõnum'),
    micTurnOff: 'Lülita mikrofon välja',
    micTurnOn: 'Lülita mikrofon sisse',
    voiceCheck: 'Hääletest',
    backToDocument: 'Tagasi dokumendi juurde',
    noticeDemo: 'See on salvestatud demo. Keegi ei räägi, read mängivad ise.',
    noticeRehearsal: 'Proov: vastused tulevad demo stsenaariumist, mitte mudelilt.',
    noticeServerDown: 'Server ei vasta. Käivita see käsuga npm run dev.',
    noticeNoSpeech: 'Selles brauseris pole kõnetuvastust. Kasuta Chrome’i või kirjuta.',
    noticeFakeBridge: 'Brauseri laiendus on asendatud võltsiga: käsud ei jõua päris brauserisse.',
    typeInstead: 'Kirjuta rääkimise asemel',
    say: 'Ütle',
    yes: 'Jah',
    no: 'Ei',
    microphone: 'Mikrofon',
    micListening: 'Kuulan',
    micNotListening: 'Ei kuula',
    youCanSay: 'Saad öelda',
    sayList: [
      ['Mida muuta', 'Muuda eelarve tähtaeg reedeks'],
      ['Jah, ei või ainult parandatud sõna', 'Mitte kolmapäev. Teisipäev.'],
      ['Lõigu number', 'Kuus'],
      ['Kuhu minna', 'Mine eelarve juurde. Järgmine. Algusesse.'],
      ['Mida ette lugeda', 'Loe lõik neli. Stopp.'],
      ['Viimase muudatuse tagasivõtmiseks', 'Võta tagasi'],
      ['Brauseris', 'Uus vaheleht. Ava messenger. Mine tagasi. Keri alla.'],
      ['Nupud lehel', 'Näita numbreid. Vajuta viis.'],
      ['Sõnum', 'Kirjuta Marile, et jõuan kell kolm. Saada.'],
      ['Rahu saamiseks', 'Ära kuula. Ärka üles.'],
    ],
    changes: 'Muudatused',
    undoHint: 'Viimase võtad tagasi sõnadega „võta tagasi“.',
    startAgain: 'Alusta uuesti näidisdokumendiga',
    document: 'Dokument',
    message: 'Sõnum',
    recipient: 'Saaja',
    noRecipient: 'brauseris avatud sõnumikast',
    emptyDraft: 'Sõnum on tühi. Ütle, mida kirjutada.',
  },

  check: {
    title: (language) => `Hääletest, ${language}`,
    intro: 'Loe iga rida valjult ette. Kui rida on kuuldud, süttib järgmine. Tulemus näitab, kui suure osa sõnadest tuvastaja valesti kirja pani.',
    stop: 'Stopp',
    start: 'Alusta',
    continue: 'Jätka',
    startOver: 'Alusta otsast',
    copy: 'Kopeeri tulemus',
    copied: 'Kopeeritud',
    listening: 'Kuulan.',
    right: 'õige',
    wrong: (n) => `${n} viga`,
    percentWrong: 'protsenti sõnadest valesti',
    ofWords: (errors, words, finished) => `: ${errors} sõna ${words}-st${finished ? '.' : ' seni.'}`,
    report: (language, errors, words, percent) => `Ütle hääletest, ${language}: ${errors} sõna ${words}-st valesti (${percent} protsenti).`,
    reportLine: (n, expected, heard, errors) => `${n}. oodatud „${expected}“, kuuldud „${heard}“, vigu ${errors}`,
    noSpeech: 'Selles brauseris pole kõnetuvastust. Kasuta Chrome’i.',
  },

  strip: {
    micLabel: 'Mikrofon sisse või välja',
    listening: 'Kuulan',
    notListening: 'Ei kuula',
    resting: 'Puhkan',
    sayPrompt: 'Räägi. Sõnad lähevad sõnumikasti.',
    modelUnreachable: 'Kõnemudel ei vasta. Käivita see arvutis käsuga npm run dev.',
    micBlocked: 'Mikrofon on keelatud. Luba see avanenud lehel.',
    permissionTitle: 'Ütle vajab mikrofoni',
    permissionAsk: 'Vajuta brauseri küsimuses „Luba“. See leht sulgub ise.',
    permissionDone: 'Mikrofon on lubatud. Leht sulgub.',
    permissionRetry: 'Proovi uuesti',
    // The new-tab page (21.3), ext lane.
    newTabTitle: 'Uus vaheleht',
    newTabHint: 'Vaata paanile üks sekund, et see avada. Või ütle „näita numbreid“ ja number.',
    hide: 'Peida',
    show: 'Näita',
    settings: 'Seaded',
    thinking: 'Mõtlen',
    examples: ['„ava youtube“', '„kirjuta Marile, et jõuan kell viis“', '„näita numbreid“ ja number', '„otsi kassivideod“', '„uus leht“', '„peida riba“'],
    examplesLead: 'Ütle:',
    optionsTitle: 'Ütle seaded',
    optionsHelp: 'Vaata nupule üks sekund või ütle „näita numbreid“ ja siis numbri. Valik salvestub kohe.',
    optionsHelpEn: 'Rest your eyes on a button for one second, or say “show numbers” and then the number. A choice is saved at once.',
    barHeight: 'Riba kõrgus',
    barHeightEn: 'Bar height',
    barSmall: 'Väike',
    barNormal: 'Tavaline',
    barLarge: 'Suur',
    micSide: 'Mikrofon',
    micSideEn: 'Microphone side',
    micLeft: 'Vasakul',
    micRight: 'Paremal',
    startHidden: 'Riba alguses',
    startHiddenEn: 'Bar at start',
    startShown: 'Nähtav',
    startFolded: 'Peidetud',
    advanced: 'Täpsemalt',
    advancedEn: 'Advanced',
    asrUrl: 'Kõnemudeli aadress',
    utleUrl: 'Ütle arenduslehe aadress',
    save: 'Salvesta',
    saved: 'Salvestatud.',
    notAnAddress: (value) => `See ei ole täielik aadress: ${value}`,
    savedReload: 'Salvestatud. Uus kõnemudeli aadress hakkab kehtima pärast laienduse uuesti laadimist.',
    gazeOff: 'Vaata siia ja räägi',
    lagLine: (seconds) => `Kõne jääb maha ${seconds} s`,
    listenMode: 'Kuulamine',
    listenModeEn: 'Listening',
    listenToggle: 'Lülitiga',
    listenToggleEn: 'Toggle: a click or a one-second look turns it on and off',
    listenGaze: 'Vaatamisega',
    listenGazeEn: 'By looking: it listens while you look at the microphone',
    gazeTarget: 'Vaatamise sihtmärk',
    gazeTargetEn: 'Gaze target',
    gazeMic: 'Mikrofon',
    gazeMicEn: 'The microphone square',
    gazeBar: 'Kogu riba',
    gazeBarEn: 'The whole bar',
    speechEngine: 'Kõnemudel',
    speechEngineEn: 'Speech model',
    engineLocal: 'Arvutis (TalTech)',
    engineLocalEn: 'On this computer (TalTech)',
    engineSoniox: 'Soniox (pilves)',
    engineSonioxEn: 'Soniox (in the cloud)',
    engineNote: 'Soniox vajab võtit arendusserveris (SONIOX_API_KEY). Valik hakkab kehtima järgmisel sisselülitamisel.',
    engineNoteEn: 'Soniox needs a key on the dev server (SONIOX_API_KEY). The choice takes effect the next time listening starts.',
  },
}

const EN: Strings = {
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
      case 'siteSearch':
        return `Searching here: ${command.query}`
      case 'media':
        return MEDIA_EN[command.action]
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
  browserFailed(command, code) {
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
        if (command.kind === 'clickItem' || command.kind === 'focusItem') return 'That is no longer on the page. Say it again.'
        if (command.kind === 'siteSearch') return 'This page has no search. Say "search google for".'
        if (command.kind === 'media') return 'There is no video here.'
        if (command.kind === 'clearField' || command.kind === 'arm') return 'No field is picked. Say "show numbers" and a number.'
        if (command.kind === 'caret' || command.kind === 'select') return 'That text is not in the field.'
        if (command.kind === 'typeText') return 'No field is picked to write in.'
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
    clearing: 'Deleting everything.',
    newLine: 'New line.',
    mark: (mark) => ({ '.': 'Full stop.', ',': 'Comma.', '?': 'Question mark.', '!': 'Exclamation mark.' })[mark] ?? mark,
    undoing: 'Undoing.',
    written: 'Done.',
    conversationOpen: (name) => `Conversation open: ${name}.`,
    sent: 'Sent.',
    notSent: (reason) => `Not sent. ${reason}`,
    understood: (text) => `Understood: "${text}".`,
    notUnderstood: 'I did not understand. Say it another way, for example "open youtube" or "scroll down".',
    thinking: 'Thinking…',
    modelOff: 'Free-form understanding is off: the server has no Anthropic key. Commands still work.',
    noPlaceToWrite: 'There is nowhere to write here. Say "write here" on a field, "show numbers" and a number, or open a conversation.',
    catchingUp: 'Catching up…',
    lateCommand: (say) => `Later: "${say}" was a command, text left as is.`,
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
    examples: ['“open youtube”', '“write to Mari that I arrive at five”', '“show numbers” and a number', '“search cat videos”', '“new page”', '“hide the bar”'],
    examplesLead: 'Say:',
    optionsTitle: 'Ütle settings',
    optionsHelp: 'Rest your eyes on a button for one second, or say “show numbers” and then the number. A choice is saved at once.',
    optionsHelpEn: '',
    barHeight: 'Bar height',
    barHeightEn: '',
    barSmall: 'Small',
    barNormal: 'Normal',
    barLarge: 'Large',
    micSide: 'Microphone',
    micSideEn: '',
    micLeft: 'Left',
    micRight: 'Right',
    startHidden: 'Bar at start',
    startHiddenEn: '',
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
    speechEngine: 'Speech model',
    speechEngineEn: '',
    engineLocal: 'On this computer (TalTech)',
    engineLocalEn: 'On this computer (TalTech)',
    engineSoniox: 'Soniox (in the cloud)',
    engineSonioxEn: 'Soniox (in the cloud)',
    engineNote: 'Soniox needs a key on the dev server (SONIOX_API_KEY). The choice takes effect the next time listening starts.',
    engineNoteEn: '',
  },
}

export const STRINGS: Record<Lang, Strings> = { et: ET, en: EN }

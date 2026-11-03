// The Estonian lines (src/core/strings.ts assembles both languages).

import type { MediaAction, PressableKey, FormatStyle } from '../../browser/protocol.ts'
import { dialogButtons } from '../../browser/protocol.ts'
import { HELP_EXAMPLES, PHRASE_GROUPS } from '../phrases.ts'
import type { Strings } from './types.ts'
import { placeOf } from './placeOf.ts'

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

// ---------- document mode (29.2): what a format command does, for the strip ----------
const FORMAT_ET: Record<FormatStyle, string> = {
  bold: 'Paks kiri.',
  italic: 'Kaldkiri.',
  underline: 'Allajoonitud.',
  heading: 'Pealkiri.',
  normal: 'Tavaline tekst.',
  list: 'Loend.',
  paragraph: 'Uus lõik.',
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

/** An amount of time as the lines say it: "üks minut", "2 minutit", "90 sekundit" (a seek, 29.1; a timed scroll, 33.4). */
function amountEt(seconds: number): string {
  return seconds === 60 ? 'üks minut' : seconds % 60 === 0 ? `${seconds / 60} minutit` : seconds === 1 ? 'üks sekund' : `${seconds} sekundit`
}

/** Round 8 (29.1): the line for a seek by an amount, "Edasi üks minut.", "Tagasi 90 sekundit.". */
function seekEt(action: MediaAction, seconds: number): string {
  return `${action === 'back' ? 'Tagasi' : 'Edasi'} ${amountEt(seconds)}.`
}

export const ET: Strings = {
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
        // Round 10 (33.4): a timed one says how long and the word that stops it, for as long as it runs.
        if (command.mode === 'slow' && command.seconds !== undefined) return `Kerin aeglaselt ${command.direction === 'up' ? 'üles' : 'alla'} ${amountEt(command.seconds)}. „Stopp“ lõpetab.`
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
      case 'hover':
        return 'Näitan valikuid.'
      case 'contextMenu':
        return 'Avan menüü.'
      case 'scrollTo':
        return 'Kerin selle juurde.'
      case 'siteSearch':
        return `Otsin siit: ${command.query}`
      case 'media':
        return command.seconds === undefined ? MEDIA_ET[command.action] : seekEt(command.action, command.seconds)
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
      case 'zoom':
        return command.direction === 'in' ? 'Suurendan.' : command.direction === 'out' ? 'Vähendan.' : 'Tavaline suurus.'
      case 'openSettings':
        return command.section === 'andmed' ? 'Avan minu andmed.' : command.section === 'welcome' ? 'Avan alustamise.' : command.section === 'voice' ? 'Avan hääle õpetamise.' : 'Avan seaded.'
      case 'openHelp': {
        const group = PHRASE_GROUPS.find((g) => g.id === command.group)
        return group ? `Avan abi: ${group.name}.` : 'Avan abi.'
      }
      case 'savedEntry':
        return ''
      case 'format':
        return FORMAT_ET[command.style]
      // ---------- mail (29.3) ----------
      case 'compose':
        return command.to ? `Uus kiri: ${command.to}.` : 'Uus kiri.'
      case 'composeTo':
        return `Uus kiri: ${command.address}.`
      case 'mailField':
        return command.field === 'subject' ? `Teema: ${command.text ?? ''}`.trim() : 'Lisan koopia.'
      // Round 8 (29.4.3): the engine says these itself, with the address.
      case 'savePlace':
        return `Salvestan koha „${command.noun}“.`
      case 'removePlace':
        return `Eemaldan koha „${command.noun}“.`
      // ---------- reading aloud (29.5) ----------
      case 'read':
        return command.what === 'continue' ? ET.read.onward : command.what === 'stop' ? ET.read.stopped : ET.read.now
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
  browserFailed(command, code, message) {
    // ---------- reading aloud (29.5) ----------
    if (command.kind === 'read' && code === 'not_allowed') return ET.read.noVoice
    if (command.kind === 'read' && code === 'not_found') return command.what === 'continue' ? ET.read.ended : ET.read.nothing
    if (command.kind === 'read' && code === 'failed') return ET.read.failed
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
        if (command.kind === 'clickItem' || command.kind === 'focusItem' || command.kind === 'hover' || command.kind === 'contextMenu' || command.kind === 'scrollTo') return 'Seda ei ole enam lehel. Ütle uuesti.'
        if (command.kind === 'siteSearch') {
          // Lane EXIT (finding 5): the field is there, an open dialog (a cookie consent) is in front of it.
          const buttons = dialogButtons(message)
          if (buttons) {
            const say = buttons.slice(0, 2).map((b) => `„${b.toLowerCase()}“`).join(' või ')
            return say === '' ? 'Otsing on lehe akna taga. Vasta enne aknale, siis ütle otsing uuesti.' : `Otsing on lehe akna taga. Vasta enne aknale, näiteks ${say}, siis ütle otsing uuesti.`
          }
          return 'Sellel lehel ei ole otsingut. Ütle „otsi googlest“.'
        }
        if (command.kind === 'media') return 'Siin ei ole videot.'
        if (command.kind === 'clearField' || command.kind === 'arm') return 'Ühtegi kasti ei ole valitud. Ütle „näita numbreid“ ja number.'
        if (command.kind === 'caret' || command.kind === 'select') return 'Seda teksti kastis ei ole.'
        if (command.kind === 'typeText') return 'Ühtegi kasti ei ole valitud, kuhu kirjutada.'
        // mail (29.3)
        if (command.kind === 'compose' || command.kind === 'composeTo') return 'Uut kirja ei saanud avada. Ava Gmail ja ütle uuesti.'
        if (command.kind === 'mailField') return 'Siin ei ole avatud kirja. Ütle „uus meil“.'
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
    deletingNamed: (word) => `Kustutan sõna „${word}“.`,
    clearing: 'Kustutan kõik.',
    newLine: 'Uus rida.',
    mark: (mark) => ({ '.': 'Punkt.', ',': 'Koma.', '?': 'Küsimärk.', '!': 'Hüüumärk.' })[mark] ?? mark,
    undoing: 'Võtan tagasi.',
    written: 'Tehtud.',
    conversationOpen: (name) => `Vestlus avatud: ${name}.`,
    sent: 'Saadetud.',
    notSent: (reason) => `Ei saatnud. ${reason}`,
    understood: (text) => `Sain aru: „${text}“.`,
    notUnderstood: 'Ei saanud aru. Ütle teisiti, näiteks „ava youtube“ või „keri alla“, või ütle „abi“.',
    thinking: 'Mõtlen…',
    modelOff: 'Vaba kõne mõistmine on väljas: serveril pole Anthropicu võtit. Käsud töötavad.',
    noPlaceToWrite: 'Siin pole kuhu kirjutada. Ütle „kirjuta siia“ kasti peal, „näita numbreid“ ja number, või ava vestlus.',
    catchingUp: 'Jõuan järele…',
    lateCommand: (say) => `Hiljem: see oli käsk „${say}“, teksti ei muutnud.`,
    spellDigits: 'Kirjutan numbritena.',
    spellWords: 'Kirjutan tavaliselt.',
    typedInto: (text) => `Kirjutasin: ${text} (ütle „edasi“, „valmis“ või „vale“)`,
    thinkingLong: 'Mõtlen pikemalt…',
    tookTooLong: 'Võttis liiga kaua, katkestasin.',
    cancelled: 'Katkestatud.',
    scrollEnded: 'Kerimine lõppes.',
    keptWords: 'Pikk lause jäi kasti, käsku ei täitnud.',
    fieldUnverified: 'Abiline ei vastanud, välja ei kirjutanud.',
    insertedSaved: (text, name) => `Kirjutasin: ${text} (${name}). Ütle „valmis“, „edasi“ või „vale“.`,
    insertedContact: (name, address) => `Saaja: ${name} (${address}). Ütle „edasi“ või „vale“.`,
    contactMail: (name, address) => `Uus kiri: ${name} (${address}).`,
    wrongCleared: 'Kustutasin. Ütle tähthaaval.',
    whichSaved: (names) => (names.length <= 2 ? `Kumb: ${names.join(' või ')}?` : `Milline: ${names.slice(0, -1).join(', ')} või ${names.at(-1) ?? ''}?`),
    whichItem: (names) => `Kumb: ${names.map((name, i) => `${i + 1} ${name}`).join(', ')}?`,
    beside: 'Uues vahelehes, see leht jääb alles.',
    savedMissing: 'Seda pole enam salvestatud. Ütle „minu andmed“.',
    savedHint: (names) => ` Või ütle ${names.map((n) => `„${n}“`).join(' või ')}.`,
    entryGone: 'Minu andmete leht pole ees. Ütle „minu andmed“.',
    documentNoSend: 'Dokumendis ei saadeta.',
    reading: 'Loen ette.',
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
    // Round 9 (30.2): drawn from src/core/phrases.ts, the phrases marked example.
    examples: HELP_EXAMPLES,
    examplesLead: 'Ütle:',
    optionsTitle: 'Ütle seaded',
    optionsHelp: 'Vaata nupule üks sekund või ütle „näita numbreid“ ja siis numbri. Valik salvestub kohe.',
    optionsHelpEn: 'Rest your eyes on a button for one second, or say “show numbers” and then the number. A choice is saved at once.',
    barHeight: 'Riba kõrgus',
    barSmall: 'Väike',
    barNormal: 'Tavaline',
    barLarge: 'Suur',
    micSide: 'Mikrofon',
    micSideEn: 'Microphone side',
    micLeft: 'Vasakul',
    micRight: 'Paremal',
    startHidden: 'Riba alguses',
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
    myVoice: 'Minu hääl',
    myVoiceEn: 'My voice',
    onlyOwner: 'Kuula ainult mind',
    onlyOwnerEn: 'Listen only to me',
    everyone: 'Kuula kõiki',
    everyoneEn: 'Listen to everyone',
    voiceNote: '„Kuula ainult mind“ vajab õpitud häält ja häälemudelit arendusserveris (npm run model). Ilma mudelita või õpitud hääleta ei kuuletu ma kellelegi. Valik hakkab kehtima järgmisel sisselülitamisel. Server hoiab hääle kohta ainult arve (hääle kirjeldus, lausete arv, nende pikkus ja valjus, piir ja kontroll-lausete tulemus, kuupäevad), mitte heli ega teksti. „Kustuta mu hääl“ kustutab need.',
    voiceNoteEn: '"Listen only to me" needs the learnt voice and the speaker model on the dev server (npm run model). Without the model or a learnt voice nobody is obeyed. The choice takes effect the next time listening starts. The server keeps only numbers about the voice (its description, how many phrases, their length and loudness, the line and the check phrases’ result, dates), never audio or text. "Delete my voice" deletes them.',
    enrolStart: (seconds) => `Räägi ${seconds} sekundit tavalisel häälel…`,
    enrolDone: 'Hääl on õpitud.',
    enrolFailed: 'Hääle õppimine ei õnnestunud.',
    foreign: 'Keegi teine rääkis, jätsin vahele.',
    foreignRetrain: 'Kui see olid sina, õpeta hääl uuesti seadetes.',
    voiceUnverified: 'Häält ei õnnestunud kinnitada.',
    voiceTooShort: 'Liiga lühike, et häält kontrollida. Ütle pikemalt: „saada sõnum“ või „jah, kinnitan“.',
    voiceUnsupported: 'Häält ei saa praegu kontrollida. Vali seadetes kohalik kõnetuvastus või luba kõik hääled.',
    voiceNoProfile: 'Õpeta mulle enne oma hääl.',
    voiceNoProfileHow: 'Vaata riba nupule „Seaded“ ja vali „Õpeta mu hääl lausetega“ või „Kuula kõiki“.',
    voiceMismatch: 'Hääl on õpetatud teise mudeliga. Õpeta hääl uuesti: riba nupp „Seaded“.',
    guardWaiting: 'Jätsin meelde: „Kuula ainult mind“ lülitub sisse, kui hääl on õpitud. Seni kuulan kõiki.',
    phraseProblem: {
      too_short: 'Lause jäi liiga lühikeseks. Loe see uuesti.',
      too_quiet: 'Liiga vaikne. Räägi mikrofonile lähemal ja loe see uuesti.',
      clipped: 'Liiga vali, heli moonutub. Räägi veidi vaiksemalt ja loe see uuesti.',
      model_error: 'Häält ei õnnestunud mõõta. Loe see uuesti.',
      slow: 'Arvuti on praegu aeglane. Oota hetk, loetud lause jõuab kohale.',
    },
    enrolFailedWhy: {
      too_few_phrases: 'Lauseid jäi liiga vähe, vaja on vähemalt kuus. Senine hääl jäi alles.',
      too_little_speech: 'Kõnet jäi liiga vähe. Senine hääl jäi alles.',
      held_out_failed: 'Kahel viimasel lausel ma sind ära ei tundnud. Senine hääl jäi alles. Proovi vaiksemas kohas uuesti.',
      write_failed: 'Häält ei õnnestunud salvestada. Senine hääl jäi alles.',
      model_unavailable: 'Häälemudel ei tööta (npm run model). Senine hääl jäi alles.',
    },
    enrolVerified: (phrases, held) => `Hääl on õpitud ${phrases} lausest ja kontrollitud ${held} uuel lausel.`,
    readiness: {
      ready: 'Kuulan ainult sind: hääl on kontrollitud.',
      no_profile: 'Hääl on õpetamata, nii et „Kuula ainult mind“ ei kuuletu kellelegi. Õpeta hääl või vali „Kuula kõiki“.',
      needs_retraining: 'Hääl on õpetatud vanas vormingus ega kaitse. Õpeta hääl uuesti.',
      model_unavailable: 'Häälemudel ei tööta, häält ei saa kontrollida. Ma ei kuuletu kellelegi.',
      model_mismatch: 'Hääl on õpetatud teise mudeliga ega kaitse. Õpeta hääl uuesti.',
    },
    voiceTest: {
      recognised: 'Tundsin su ära.',
      not_recognised: 'Ei tundnud sind ära. Proovi uuesti või õpeta hääl uuesti.',
      too_short: 'Liiga lühike. Ütle pikem lause.',
      noisy: 'Liiga mürane või vali. Proovi vaiksemas kohas.',
      unavailable: 'Häält ei saa praegu kontrollida.',
    },
    voiceTestSay: 'Ütle tavalisel häälel:',
    voiceDeleted: 'Hääl on kustutatud. „Kuula ainult mind“ ei kuuletu kellelegi, kuni õpetad hääle uuesti.',
    voiceDeleteFailed: 'Häält ei õnnestunud kustutada.',
    deleteVoice: 'Kustuta mu hääl',
    deleteVoiceEn: 'Delete my voice from the server',
    testVoice: 'Proovi minu häält',
    testVoiceEn: 'Check that it knows my voice',
    teachScript: 'Õpeta mu hääl lausetega',
    teachScriptEn: 'Teach it my voice: read 12 short sentences aloud',
    teachFree: 'Õpeta vabalt rääkides',
    teachFreeEn: 'Or speak freely for 8 seconds',
    scriptStart: 'Loe see lause tavalisel häälel. Järgmine tuleb ise.',
    scriptStep: (at, total) => `${at} / ${total}`,
    scriptFinish: 'Valmis',
    scriptFinishEn: 'Done: keep what was read so far',
    enrolPhrasesDone: (phrases) => `Hääl on õpitud ${phrases} lausest.`,
    enrolFew: (phrases, enough) => `Hääl on õpitud ainult ${phrases} lausest. Vähemalt ${enough} on kindlam: õpeta uuesti, kui ma sind ära ei tunne.`,
    // The hosted server (round 6, HOST lane).
    serverTitle: 'Server',
    serverAddress: 'Serveri aadress',
    serverAddressHelp: 'Jäta tühjaks, kui server jookseb samas arvutis.',
    serverToken: 'Serveri võti',
    serverTest: 'Proovi ühendust',
    serverChecking: 'Proovin…',
    serverOk: (speech, understanding) => {
      return `Ühendus töötab: ${speech.local ? 'TalTechi kõnemudel' : 'kõnemudelit pole'}, mõistmine ${understanding ? 'sees' : 'väljas'}.`
    },
    serverUnreachable: 'Ei saa ühendust.',
    serverWrongToken: 'Vale võti.',
    serverProfile: (profile) => `Profiil: ${profile.name}, hääl ${profile.enrolled ? 'õpetatud' : 'õpetamata'}.`,
    badToken: 'Serveri võti on vale.',
    // ---------- the first run (30.1, ONBOARD lane) ----------
    serverDownLocal: 'Kõneserver ei vasta. Palu abilisel see käivitada (npm run dev).',
    serverDownHosted: 'Kõneserver ei vasta. Kontrolli internetiühendust või palu abilisel vaadata serverit.',
    serverBack: 'Server vastab jälle.',
    connConnected: 'Ühendatud',
    connConnecting: 'Ühendan',
    connDown: 'Server ei vasta',
    helpTitle: 'Mida saab öelda',
    helpHint: 'Vaata rühmale üks sekund, et see avada. Või ütle „näita numbreid“ ja number. „loe ette“ loeb avatud rühma ette.',
    askingFold: 'Riba on peidus, kuni leht küsib.',
  },

  andmed: {
    title: 'Minu andmed',
    titleEn: 'My details: an e-mail, a phone number or an ID code, saved once and put into any field by voice.',
    help: 'Salvesta e-post, telefon või isikukood üks kord. Ütle „lisa uus e-post“ või vaata nupule. Pärast ütle vormi väljal „minu e-post“.',
    helpEn: 'Say “add a new email” or rest your eyes on a button. Afterwards say “my email” in a form field.',
    empty: 'Veel pole midagi salvestatud.',
    sayLine: (phrases) => `Ütle: ${phrases.join(', ')}`,
    edit: 'Muuda',
    forget: 'Unusta',
    forgotten: (name) => `Unustasin: ${name}.`,
    add: (kind) => `Lisa ${({ email: 'e-post', tel: 'telefon', code: 'isikukood', number: 'number', text: 'muu', contact: 'kontakt' } as const)[kind]}`,
    kindName: (kind) => ({ email: 'e-post', tel: 'telefon', code: 'isikukood', number: 'number', text: 'muu', contact: 'Kontakt: nimi ja e-posti aadress' } as const)[kind],
    defaultName: (kind) => ({ email: 'minu e-post', tel: 'minu telefon', code: 'minu isikukood', number: 'minu number', text: 'minu tekst', contact: 'kontakt' } as const)[kind],
    formTitle: 'Klaviatuuriga (abiline)',
    formName: 'Nimi',
    formKind: 'Liik',
    formValue: 'Väärtus',
    formSave: 'Salvesta',
    formMissing: 'Nimi ja väärtus on vaja.',
    formSaved: (name) => `Salvestatud: ${name}.`,
    askKind: 'Mida salvestada? Ütle „e-post“, „telefon“, „isikukood“ või „muu“.',
    askName: 'Mis nimega? Ütle näiteks „töö e-post“.',
    nameTaken: (name) => `„${name}“ on juba olemas. Ütle teine nimi.`,
    stepValue: 'Ütle tähthaaval; „punkt“ on ., „ät“ on @; „valmis“ salvestab.',
    suffixHint: 'Lõpu jaoks ütle „gmail“, „hotmail“ või „mail punkt ee“.',
    now: (value, suffix) => `Praegu: ${value}${suffix}`,
    readBack: (spoken, suffix) => `Praegu: ${spoken}${suffix === '' ? '' : `, lõpp ${suffix}`}.`,
    nothingYet: 'Midagi pole veel. Ütle tähthaaval.',
    needAt: 'Aadressis pole @. Ütle „ät“ või „gmail“.',
    needDigit: 'Numbrit pole veel. Ütle numbrid.',
    savedOk: (name) => `Salvestatud: ${name}. Ütle vormi väljal „${name}“.`,
    abandoned: 'Katkestatud, midagi ei salvestatud.',
    stepTitle: 'Lisan häälega',
    suffixLabel: 'lõpp',
    done: 'Valmis',
    cancel: 'Katkesta',
  },
  // ---------- wake word and places (29.4) ----------
  wake: {
    prompt: (word) => `Kuulan. Alusta sõnaga „${word}“.`,
    passive: (word) => `Ootan sõna „${word}“.`,
    active: 'Kuulan sind.',
    notForMe: (count) => (count === 1 ? '1 lause ei olnud mulle' : `${count} lauset ei olnud mulle`),
    uploadsOff: 'Ütle-sõna töötab ainult selle arvuti kõneserveriga: muidu läheks kogu toa heli välja. Vali seadetes kuulamine „Lülitiga“ või kasuta selle arvuti serverit.',
    listenWake: 'Äratussõnaga',
    listenWakeEn: 'Wake word: always listening, acts on what starts with the word',
    wordLabel: 'Äratussõna · Wake word',
    wordHelp: 'Üks või kaks sõna. Kõik, mis ei alga selle sõnaga, jäetakse vahele.',
    wordSave: 'Salvesta sõna',
    wordSaved: (word) => `Äratussõna on nüüd „${word}“.`,
    opening: (label) => `Avan: ${label}.`,
    missing: 'Seda kohta pole enam seadetes.',
    placesTitle: 'Minu kohad',
    placesTitleEn: 'My places: a word opens a site',
    placesHelp: 'Ütle näiteks „vaata uudiseid“, „pane raadio käima“ või „mis ilm on“. Oma koha lisamiseks ava leht ja ütle „lisa koht uudised“; eemaldamiseks „eemalda koht uudised“. Sinu rida asendab vaikimisi rea.',
    placeNoun: 'Sõna (nt uudised)',
    placeUrl: 'Aadress (nt postimees.ee)',
    placeAdd: 'Lisa koht',
    placeRemove: 'Eemalda',
    placeAdded: (noun) => `Koht „${noun}“ salvestatud.`,
    placeRemoved: (noun) => `Koht „${noun}“ eemaldatud.`,
    placeBad: 'Kirjuta sõna ja aadress (https://… või nimi.ee).',
    sayLine: (noun) => `Ütle: ava ${noun}`,
    placeSaved: (noun, host) => `Koht „${noun}“ salvestatud: ${host}`,
    placeAsk: 'Ütle, mis sõnaga seda kohta kutsuda.',
    placeAskRemove: 'Ütle, mis koht eemaldada.',
    placeNotSaved: 'Seda lehte ei saa kohaks salvestada.',
    placeNotThere: (noun) => `Kohta „${noun}“ pole.`,
  },
  // ---------- end of wake word and places ----------
  // ---------- reading aloud (29.5) ----------
  read: {
    now: 'Loen ette…',
    onward: 'Loen edasi…',
    stopped: 'Lugemine seis.',
    noVoice: "Selles brauseris pole eesti häält. Edge'is on.",
    skipped: 'Jätsin ühe lause vahele.',
    ended: 'Lugemine on lõppenud.',
    nothing: 'Siin pole midagi ette lugeda.',
    failed: 'Ette lugeda ei õnnestunud.',
    barTitle: 'Loe riba ette',
    barOn: 'Loe ette',
    barOff: 'Ära loe',
    barNote: "Riba uued read loetakse eesti häälega ette (Edge'is on see hääl). Kui riba räägib, mikrofon ei kuula.",
  },
  // ---------- the first run (30.1, ONBOARD lane) ----------
  welcome: {
    title: 'Alustamine',
    intro: 'Viis sammu. Abiline teeb need üks kord, siis saab Ütlet kasutada ainult häälega.',
    how: 'Vaata nupule üks sekund, et seda vajutada. Või ütle „näita numbreid“ ja number.',
    done: 'Tehtud',
    micTitle: 'Mikrofon',
    micBody: 'Ütle kuulab mikrofoni kogu brauseris. Vajuta brauseri küsimuses „Luba“.',
    micAsk: 'Luba mikrofon',
    micGranted: 'Mikrofon on lubatud.',
    micDenied: 'Mikrofon on keelatud. Luba see aadressiriba lukuikoonist ja vajuta „Proovi uuesti“.',
    serverTitle: 'Kõneserver',
    serverBody: 'Ütle saadab kõne serverisse, mis selle ära tunneb. Vali, kus server jookseb.',
    choiceLocal: 'Samas arvutis',
    choiceLocalNote: 'Server käivitatakse selles arvutis käsuga npm run dev.',
    choiceHosted: 'Teises arvutis',
    choiceHostedNote: 'Aadressi ja võtme annab see, kes serverit haldab.',
    hintLocal: 'Käivita server selles arvutis käsuga npm run dev.',
    hintHosted: 'Kontrolli internetiühendust ning aadressi ja võtit.',
    tryTitle: 'Proovi',
    tryBody: 'Vajuta mikrofoni ja ütle: tere',
    tryArm: 'Kirjuta siia',
    tryWaiting: 'Sõnad tulevad siia kasti.',
    tryWorks: 'Töötab.',
    voiceTitle: 'Õpeta mu hääl',
    voiceBody: 'Loe 12 lühikest lauset tavalisel häälel. Iga lause järel ütlen, kas see sobis. Kaks viimast lauset on kontrolliks: nende peal vaatan, kas tunnen su ära. Heli ei salvestata, ainult hääle kirjeldus.',
    voiceDone: 'Hääl on õpetatud.',
    voiceStart: 'Alusta lugemist',
    voiceFinish: 'Lõpeta nende lausetega',
    voiceStep: (at, of) => `Lause ${at} / ${of}`,
    testTitle: 'Proovi minu häält',
    testBody: 'Ütle üks uus lause. Ütle ei tee midagi, ainult ütleb, kas tundis su ära.',
    testStart: 'Proovi minu häält',
    guardTitle: 'Kuula ainult mind',
    guardBody: 'Kui see on sees, ei tee Ütle midagi, mida keegi teine ütleb. See ei ole turvaline isikutuvastus.',
    guardOn: 'Lülita sisse',
    guardOnSub: 'Kuula ainult mind',
    guardAll: 'Kuula kõiki',
    guardAllSub: 'Kõik hääled, ilma kaitseta',
    guardOnDone: 'Sees: kuulan ainult sind.',
    guardAllDone: 'Kuulan kõiki hääli. Kaitse ei ole sees.',
    readyTitle: 'Valmis',
    readyBody: 'Ütle näiteks:',
    readyDone: 'Kõik on valmis.',
    help: 'Abi',
    menuWelcome: 'Alustamine',
    menuSettings: 'Seaded',
    menuHelp: 'Abi',
  },
}

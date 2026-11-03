import type { BoxState } from '../../browser/protocol.ts'

/**
 * Round 11 (lane WORDS, F4): the owner's own words from his nine-minute demo of 2026-11-03
 * (docs/plans/2026-11-03-round-11-demo-brief.md), every utterance the speaker gate verified as his,
 * in session order, as the recogniser wrote them. Command phrasings, not identity: no recordings,
 * file names, scores or labels. His friend's address is replaced by the stand-in
 * nadim.naide@example.com everywhere it appears (also its spelled parts inside his corrections), and
 * one bystander's first name by "Mari".
 *
 * page: the page in front when he said it, from the brief's timeline (stand-in urls). armed: a text
 * field he armed was in front (only the Gmail "To" field, from the address on). typed: what that
 * field held. The rows after the timeline (settings, then the talk afterwards) have the settings page.
 */
export interface ReplayUtterance {
  said: string
  page: string
  armed: boolean
  typed?: string
}

const SETTINGS = 'chrome-extension://utle/options.html'
const NEW_TAB = 'chrome://newtab/'
const YOUTUBE = 'https://www.youtube.com/'
const TOOTUKASSA = 'https://www.tootukassa.ee/'
const TARA = 'https://tara.ria.ee/auth/mid'
const COMPOSE = 'https://mail.google.com/mail/u/0/#inbox?compose=new'
const ADDRESS = 'nadim.naide@example.com'

export const DEMO_2026_11_03: readonly ReplayUtterance[] = [
  { said: 'Ma pole kindel, miks ta ütleb mulle seda kogu aeg, häält ei õnnestunud kinnitada on ka siin olnud terve aeg', page: SETTINGS, armed: false },
  { said: 'Okei, on Avo, I am going to be activating', page: SETTINGS, armed: false },
  { said: 'putting a youtube video in the background', page: SETTINGS, armed: false },
  { said: ", perhaps to test how well this is going to work for my voice. That's a work right now.", page: SETTINGS, armed: false },
  { said: 'Uus vaheleht', page: SETTINGS, armed: false },
  { said: '. Youtube', page: NEW_TAB, armed: false },
  { said: 'Töötukassa', page: YOUTUBE, armed: false },
  { said: 'Mobiil-ID-ga sisselogimine', page: TOOTUKASSA, armed: false },
  { said: 'Mina tagasi eelmisele lehele.', page: TOOTUKASSA, armed: false },
  { said: 'Mine tagasi eelmisele lehele?', page: TOOTUKASSA, armed: false },
  { said: 'Ei, ma mõtlen sinna, kus ma alguses olin ennem töötukassat', page: TOOTUKASSA, armed: false },
  { said: 'Ei, ma mõtlen sinna lehele, kus ma olin ennem töötukassat', page: TOOTUKASSA, armed: false },
  { said: 'No tubli, okei find, fine fine. Paneme, mis siis saab?', page: YOUTUBE, armed: false },
  { said: 'Mille Töötukassasse.', page: YOUTUBE, armed: false },
  { said: 'Mille Töötukassasse?', page: YOUTUBE, armed: false },
  { said: 'Nüüd tuleb Estonia. Okei, ma tahan mobiilidega sisse logida.', page: TOOTUKASSA, armed: false },
  { said: 'Ma tahan mobiil-ID-ga sisse logida, logi mobiil-ID-ga sisse.', page: TOOTUKASSA, armed: false },
  { said: 'Logi mobiil-ID ka sisse, jah, jah.', page: TOOTUKASSA, armed: false },
  { said: 'Mine uuele vahelehele.', page: TARA, armed: false },
  { said: 'Okei, ma tahan kirjutada enda.', page: NEW_TAB, armed: false },
  { said: 'Sõbrale emaili.', page: NEW_TAB, armed: false },
  { said: 'Ma tahan kirjutada enda sõbrale e-maili.', page: NEW_TAB, armed: false },
  { said: 'Okei, kirjuta meil Natim punktnaide example punkt kom.', page: COMPOSE, armed: true, typed: '' },
  { said: 'Nadim on nõrga teega ja naide on nagu kaks veega.', page: COMPOSE, armed: true, typed: ADDRESS },
  { said: 'Ei, see on Nadim Nõrga tee-ga ja---', page: COMPOSE, armed: true, typed: ADDRESS },
  { said: 'Kuule see nädim nõrga t-ga', page: COMPOSE, armed: true, typed: ADDRESS },
  { said: 'Mitte nad nõrga t-ga ja naide kaksis V-ga.', page: COMPOSE, armed: true, typed: ADDRESS },
  { said: 'Ei kustuta see terve hekimail ära. Sa kirjutasid valesti selle.', page: COMPOSE, armed: true, typed: ADDRESS },
  { said: 'Oh Angeriga,', page: COMPOSE, armed: true, typed: ADDRESS },
  { said: "So I'm going to go to settings and activate", page: COMPOSE, armed: true, typed: ADDRESS },
  { said: 'I want to go with error to sonaugh so', page: COMPOSE, armed: true, typed: ADDRESS },
  { said: 'Ütle, õpeta mu hääl, mis ma rääkima pean', page: SETTINGS, armed: false },
  { said: 'Avamuslehti oma seaded', page: SETTINGS, armed: false },
  { said: 'natuke aeglaselt', page: SETTINGS, armed: false },
  { said: 'Kirjuta siia, öösel jõuan kuni', page: SETTINGS, armed: false },
  { said: 'Ma võin ükskõik mida öelda, on ju', page: SETTINGS, armed: false },
  { said: 'Järgmine vaheleht, eelmine vaheleht, sulge vaheleht. Nende numbrid, siis pigem', page: SETTINGS, armed: false },
  { said: '. Mängib videot, aga ma võin ükskõik veel, mida siia lõppu lisada', page: SETTINGS, armed: false },
  { said: 'lisa uus number salves tegite, on ju', page: SETTINGS, armed: false },
  { said: 'Kogu aeg ütleb, et lause liige lühikeseks, et loe sa uuesti palju või', page: SETTINGS, armed: false },
  { said: 'Praegu just tekib mingi seitse pool minutit testi sellega ja see Wise recognition nüüd töötab vähemalt sellele tasemele, et ma panin selle', page: SETTINGS, armed: false },
  { said: "Ma ma scroll'isin üles, aga ma sain.", page: SETTINGS, armed: false },
  { said: 'Näed on ju seda, mis. Kõige nagu, ei me näeme proovi praegu. Oota, võib-olla ma, Mari, sul vale seda.', page: SETTINGS, armed: false },
  { said: 'See on see seatud algus', page: SETTINGS, armed: false },
  { said: 'Jah, sa valid selle peale, eks ole. Ma pakun, et siin sa tegelikult mõtled nagu niimoodi, et silma nagu silma järgi saab seda vaadata, sa pead aru saatma. See oli see tooby integratsioon, et te saaks enda Tobiga seda kontrollida.', page: SETTINGS, armed: false },
]

/** The box in front for a row: the Gmail "To" field when armed (one line, an e-mail, in a compose window), else none. */
export function replayBox(row: ReplayUtterance): BoxState {
  if (!row.armed) return { present: false, text: '', armed: false }
  return { present: true, text: row.typed ?? '', armed: true, kind: 'field', single: true, fieldKind: 'email', mail: true, label: 'Saajad' }
}

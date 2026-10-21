/**
 * The phrases of scripted enrolment (round 7, SPEECH lane; ARCHITECTURE 24.2). The settings page
 * shows them one at a time; he reads each aloud; the server keeps one voice embedding per phrase and
 * the profile is their mean. Twelve short sentences, together holding the letters that sound most
 * Estonian (õ, ä, ö, ü), vowels of all three lengths, and the words he gives commands with: the
 * profile is then made of the very sounds the gate will judge most often.
 */

export const ENROL_PHRASES: readonly string[] = [
  'Ava uus leht ja ava seaded.',
  'Keri alla, keri üles ja keri natuke aeglaselt.',
  'Kirjuta siia: öösel jõuan kooli juurde.',
  'Saada need sada sõnumit ja mine tagasi.',
  'Kustuta see sõna ja tühjenda väli.',
  'Järgmine vaheleht, eelmine vaheleht, sulge vaheleht.',
  'Näita numbreid, siis peida numbrid ja riba.',
  'Mängi videot, paus, heli kõvemaks ja vaiksemaks.',
  'Suurenda lehte, vähenda lehte, täisekraan.',
  'Lisa uus number, salvesta ja kinnita.',
  'Valmis! Katkesta, lõpeta ja stopp.',
  'Värskenda lehte, mine edasi ja vaigista heli enne tööle minekut.',
]

/**
 * The command words the phrases must hold: the Estonian heads of src/core/browserIntent.ts's tables
 * (browser, scrolling, numbers, the bar, keys, video, zoom, settings) and the engine's own words
 * (saada in message.ts, valmis in savedEntry.ts, katkesta in inpage.ts).
 */
export const ENROL_COMMAND_WORDS: readonly string[] = [
  'ava', 'uus', 'leht', 'seaded', 'mine', 'keri', 'alla', 'üles', 'natuke', 'aeglaselt', 'kirjuta', 'siia',
  'saada', 'tagasi', 'edasi', 'kustuta', 'tühjenda', 'järgmine', 'eelmine', 'vaheleht', 'sulge', 'näita',
  'numbreid', 'peida', 'numbrid', 'riba', 'mängi', 'paus', 'heli', 'kõvemaks', 'vaiksemaks', 'suurenda',
  'vähenda', 'täisekraan', 'lisa', 'salvesta', 'kinnita', 'valmis', 'katkesta', 'lõpeta', 'stopp', 'värskenda',
  'vaigista',
]

/**
 * Estonian's three vowel lengths, one word of each at least: short (sada "hundred", keri, lisa), long
 * (kooli in "kooli juurde", the genitive), overlong (saada "send!", tööle, the illative).
 */
export const ENROL_VOWEL_LENGTHS = {
  short: ['sada', 'keri', 'lisa'],
  long: ['kooli', 'juurde'],
  overlong: ['saada', 'tööle'],
} as const

/** The words of a phrase, lower case, without punctuation. */
export function phraseWords(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '')
}

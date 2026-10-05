import { describe, expect, it } from 'vitest'
import type { BrowserCommand } from '../browser/protocol.ts'
import { browserIntent, SITES } from './browserIntent.ts'

const ROWS: Array<[string, BrowserCommand]> = [
  // New tab
  ['ava uus vaheleht', { kind: 'newTab' }],
  ['Uus vaheleht.', { kind: 'newTab' }],
  ['ava vaheleht', { kind: 'newTab' }],
  ['new tab', { kind: 'newTab' }],
  ['Open a new tab.', { kind: 'newTab' }],
  // Close
  ['sulge vaheleht', { kind: 'closeTab' }],
  ['Sulge see vaheleht.', { kind: 'closeTab' }],
  ['pane vaheleht kinni', { kind: 'closeTab' }],
  ['close tab', { kind: 'closeTab' }],
  ['close this tab', { kind: 'closeTab' }],
  // Next and previous
  ['järgmine vaheleht', { kind: 'switchTab', to: 'next' }],
  ['eelmine vaheleht', { kind: 'switchTab', to: 'previous' }],
  ['next tab', { kind: 'switchTab', to: 'next' }],
  ['previous tab', { kind: 'switchTab', to: 'previous' }],
  // By number
  ['kolmas vaheleht', { kind: 'switchTab', to: { index: 3 } }],
  ['vaheleht kolm', { kind: 'switchTab', to: { index: 3 } }],
  ['vaheleht number 3', { kind: 'switchTab', to: { index: 3 } }],
  ['mine kolmandale vahelehele', { kind: 'switchTab', to: { index: 3 } }],
  ['esimene vaheleht', { kind: 'switchTab', to: { index: 1 } }],
  ['tab three', { kind: 'switchTab', to: { index: 3 } }],
  ['third tab', { kind: 'switchTab', to: { index: 3 } }],
  ['go to tab 3', { kind: 'switchTab', to: { index: 3 } }],
  // Sites by name
  ['Ava WhatsApp.', { kind: 'goTo', url: 'https://web.whatsapp.com/' }],
  ['ava vatsap', { kind: 'goTo', url: 'https://web.whatsapp.com/' }],
  ['ava messenger', { kind: 'goTo', url: SITES.messenger }],
  ['Ava Messenger.', { kind: 'goTo', url: 'https://www.messenger.com/' }],
  ['ava gmail', { kind: 'goTo', url: 'https://mail.google.com/' }],
  ['mine lehele postimees.ee', { kind: 'goTo', url: 'https://postimees.ee' }],
  ['mine lehele postimees', { kind: 'goTo', url: 'https://www.postimees.ee/' }],
  ['ava facebook', { kind: 'goTo', url: 'https://www.facebook.com/' }],
  ['ava google', { kind: 'goTo', url: 'https://www.google.com/' }],
  ['ava youtube', { kind: 'goTo', url: 'https://www.youtube.com/' }],
  ['mine delfi', { kind: 'goTo', url: 'https://www.delfi.ee/' }],
  ['ava err', { kind: 'goTo', url: 'https://www.err.ee/' }],
  ['ava linkedin', { kind: 'goTo', url: 'https://www.linkedin.com/' }],
  ['ava cv.ee', { kind: 'goTo', url: 'https://www.cv.ee/' }],
  ['ava cv punkt ee', { kind: 'goTo', url: 'https://www.cv.ee/' }],
  ['ava cvkeskus', { kind: 'goTo', url: 'https://www.cvkeskus.ee/' }],
  ['ava cv keskus', { kind: 'goTo', url: 'https://www.cvkeskus.ee/' }],
  ['ava töötukassa', { kind: 'goTo', url: 'https://www.tootukassa.ee/' }],
  ['open messenger', { kind: 'goTo', url: 'https://www.messenger.com/' }],
  ['go to gmail', { kind: 'goTo', url: 'https://mail.google.com/' }],
  // Bare addresses
  ['ava ekool.ee', { kind: 'goTo', url: 'https://ekool.ee' }],
  ['go to wikipedia.org', { kind: 'goTo', url: 'https://wikipedia.org' }],
  ['mine lehele www.riigiteataja.ee', { kind: 'goTo', url: 'https://www.riigiteataja.ee' }],
  // Search (M7: the site's own search; Google and YouTube by name)
  ['otsi ilm tallinnas', { kind: 'siteSearch', query: 'ilm tallinnas' }],
  ['search for bus times', { kind: 'siteSearch', query: 'bus times' }],
  ['otsi googlest ilm tallinnas', { kind: 'goTo', url: 'https://www.google.com/search?q=ilm%20tallinnas' }],
  ['guugelda ilm', { kind: 'goTo', url: 'https://www.google.com/search?q=ilm' }],
  ['google bus times', { kind: 'goTo', url: 'https://www.google.com/search?q=bus%20times' }],
  ["otsi youtube'ist kassid", { kind: 'goTo', url: 'https://www.youtube.com/results?search_query=kassid' }],
  ['search youtube for cats', { kind: 'goTo', url: 'https://www.youtube.com/results?search_query=cats' }],
  // M7 phrases
  ['uus leht', { kind: 'newTab' }],
  ['Ava uus aken.', { kind: 'newTab' }],
  ['new window', { kind: 'newTab' }],
  ['sulge', { kind: 'closeTab' }],
  ['close', { kind: 'closeTab' }],
  ['peida riba', { kind: 'bar', show: false }],
  ['show the bar', { kind: 'bar', show: true }],
  ['kirjuta siia', { kind: 'arm', on: true }],
  ['ära kirjuta siia', { kind: 'arm', on: false }],
  ['tühjenda otsing', { kind: 'clearField' }],
  ['clear the field', { kind: 'clearField' }],
  ['pane kinni', { kind: 'pressKey', key: 'Escape' }],
  ['Enter.', { kind: 'pressKey', key: 'Enter' }],
  ['paus', { kind: 'media', action: 'pause' }],
  ['heli valjemaks', { kind: 'media', action: 'volumeUp' }],
  ['keri tagasi', { kind: 'media', action: 'back' }],
  ['täisekraan', { kind: 'media', action: 'fullscreen' }],
  // History
  ['mine tagasi', { kind: 'history', direction: 'back' }],
  ['Tagasi.', { kind: 'history', direction: 'back' }],
  ['eelmine leht', { kind: 'history', direction: 'back' }],
  ['edasi', { kind: 'history', direction: 'forward' }],
  ['mine edasi', { kind: 'history', direction: 'forward' }],
  ['page back', { kind: 'history', direction: 'back' }],
  ['go back a page', { kind: 'history', direction: 'back' }],
  ['go forward', { kind: 'history', direction: 'forward' }],
  // Reload
  ['laadi uuesti', { kind: 'reload' }],
  ['värskenda', { kind: 'reload' }],
  ['reload', { kind: 'reload' }],
  ['refresh the page', { kind: 'reload' }],
  // Scroll
  ['keri alla', { kind: 'scroll', direction: 'down' }],
  ['keri üles', { kind: 'scroll', direction: 'up' }],
  ['lehe algusesse', { kind: 'scroll', direction: 'top' }],
  ['lehe lõppu', { kind: 'scroll', direction: 'bottom' }],
  ['scroll down', { kind: 'scroll', direction: 'down' }],
  ['scroll to the top', { kind: 'scroll', direction: 'top' }],
  // Numbers
  ['näita numbreid', { kind: 'showHints' }],
  ['show numbers', { kind: 'showHints' }],
  ['peida numbrid', { kind: 'hideHints' }],
  ['hide numbers', { kind: 'hideHints' }],
  ['vajuta viis', { kind: 'clickHint', number: 5 }],
  ['Vajuta 12.', { kind: 'clickHint', number: 12 }],
  ['klõpsa kaks', { kind: 'clickHint', number: 2 }],
  ['click five', { kind: 'clickHint', number: 5 }],
  ['press 7', { kind: 'clickHint', number: 7 }],
]

describe('browserIntent: the phrase table', () => {
  it.each(ROWS)('%s', (text, command) => {
    expect(browserIntent(text)).toEqual(command)
  })
})

describe('browserIntent: what is not a browser command', () => {
  it.each([
    // Unknown site names go on to the interpreter.
    'ava eelarve',
    'mine kokkuvõtte juurde',
    'open the budget section',
    // The document's own words.
    'järgmine',
    'eelmine',
    'go back',
    'next',
    'top',
    // Sentences that only start like a command.
    'ava messenger ja kirjuta Marile',
    'vajuta',
    'otsi',
    'google',
    'search',
    'vaheleht',
    'scroll',
    '',
  ])('%s', (text) => {
    expect(browserIntent(text)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { typedFromSpoken } from './spelling.ts'

describe('numbers spoken one digit at a time become digit runs', () => {
  it.each([
    ['kolm üheksa null kaks', '3902'],
    ['viis kolm kaheksa neli', '5384'],
    ['null null seitse', '007'],
    ['üks kaks kolm neli viis kuus seitse kaheksa üheksa null', '1234567890'],
    ['three nine zero two', '3902'],
    ['Kolm üheksa null kaks.', '3902'],
    ['39002 üks null', '3900210'],
    ['kolm, üheksa, null, kaks', '3902'],
  ])('code: "%s" is %s', (spoken, typed) => {
    expect(typedFromSpoken(spoken, 'code')).toBe(typed)
  })
})

describe('numbers spoken as a number become that number', () => {
  it.each([
    ['kakskümmend kolm', '23'],
    ['kaks kümmend kolm', '23'],
    ['sada kaksteist', '112'],
    ['kolm tuhat', '3000'],
    ['kaks tuhat kakskümmend kuus', '2026'],
    ['kakssada viiskümmend', '250'],
    ['kaks sada viis', '205'],
    ['üheksateist', '19'],
    ['kümme', '10'],
    ['nelikümmend', '40'],
    ['twenty three', '23'],
    ['twenty-three', '23'],
    ['one hundred twelve', '112'],
    ['three thousand', '3000'],
    ['tuhat üks', '1001'],
    ['viisteist tuhat', '15000'],
    // A number and digits one by one in the same breath: one run.
    ['kakskümmend kolm neli', '234'],
  ])('code: "%s" is %s', (spoken, typed) => {
    expect(typedFromSpoken(spoken, 'code')).toBe(typed)
  })
})

describe('tel: digits, a leading plus, nothing else', () => {
  it.each([
    ['pluss kolm seitse kaks viis üks kaks kolm neli viis kuus seitse', '+37251234567'],
    ['viis üks kaks kolm neli viis kuus seitse', '51234567'],
    ['pluss 372 5123 4567', '+37251234567'],
    ['+372 51234567', '+37251234567'],
    ['viis üks kaks sidekriips kolm neli viis', '512345'],
    ['viis kolm kaheksa neli punkt', '5384'],
    ['plus three seven two', '+372'],
    ['kolm seitse kaks pluss', '372'],
    ['telefon viis üks kaks', '512'],
  ])('"%s" is %s', (spoken, typed) => {
    expect(typedFromSpoken(spoken, 'tel')).toBe(typed)
  })
})

describe('email: lowercase, no spaces, symbols and letters by name', () => {
  it.each([
    ['ralf punkt sepp ät gmail punkt com', 'ralf.sepp@gmail.com'],
    ['ralf sepp ät gmail punkt com', 'ralfsepp@gmail.com'],
    ['Ralf ätt gmail punkt com.', 'ralf@gmail.com'],
    ['ralf at gmail dot com', 'ralf@gmail.com'],
    ['ralf@gmail.com', 'ralf@gmail.com'],
    ['ärr ess ät taltech punkt ee', 'rs@taltech.ee'],
    ['ralf alakriips sepp ät mail punkt ee', 'ralf_sepp@mail.ee'],
    ['ralf sidekriips sepp ät mail punkt ee', 'ralf-sepp@mail.ee'],
    ['ralf üheksa kaks ät hot punkt ee', 'ralf92@hot.ee'],
    ['info ät firma punkt ee', 'info@firma.ee'],
    ['ralf pluss uudised ät gmail punkt com', 'ralf+uudised@gmail.com'],
    ['a bee tsee ät dee punkt ee', 'abc@d.ee'],
    ['suur ralf ät gmail punkt com', 'ralf@gmail.com'],
    ['ralf koma sepp ät gmail punkt com', 'ralfkomasepp@gmail.com'],
    ['ralf tühik sepp ät gmail punkt com', 'ralfsepp@gmail.com'],
  ])('"%s" is %s', (spoken, typed) => {
    expect(typedFromSpoken(spoken, 'email')).toBe(typed)
  })
})

describe('code: digits and letters, no spaces, "suur" makes a capital', () => {
  it.each([
    ['a bee tsee üks kaks kolm', 'abc123'],
    ['suur a suur bee tsee üks kaks kolm', 'ABc123'],
    ['iks igrek tsett', 'xyz'],
    ['ä ö ü õ', 'äöüõ'],
    ['kaa kaa viis sidekriips kolm', 'kk5-3'],
    ['kolm üheksa null kaks kaheksa üks', '390281'],
    ['A B C 1 2 3', 'abc123'],
    ['suur emm aa', 'Maa'],
    ['kood on 1234', 'koodon1234'],
  ])('"%s" is %s', (spoken, typed) => {
    expect(typedFromSpoken(spoken, 'code')).toBe(typed)
  })
})

describe('number: a number with a decimal point', () => {
  it.each([
    ['viis koma kaks', '5.2'],
    ['viis punkt kaks', '5.2'],
    ['kakskümmend kolm', '23'],
    ['sada', '100'],
    ['miinus kolm', '-3'],
    ['five point two', '5.2'],
    ['12,5', '12.5'],
    ['kolm kilo', '3'],
    ['viis kolm kaheksa', '538'],
    ['kaks koma viis null', '2.50'],
  ])('"%s" is %s', (spoken, typed) => {
    expect(typedFromSpoken(spoken, 'number')).toBe(typed)
  })

  it('keeps the words when there is no number in them', () => {
    expect(typedFromSpoken('palju', 'number')).toBe('palju')
  })
})

describe('password: spelled letters, digits and words, no spaces', () => {
  it.each([
    ['suur ess a l a üks kaks kolm', 'Sala123'],
    ['salasõna üks kaks kolm', 'salasõna123'],
    ['Salasõna üks kaks kolm', 'salasõna123'],
    ['suur salasõna hüüumärk', 'Salasõnahüüumärk'],
    ['pee ii enn üks kaks kolm neli', 'pin1234'],
    ['üks kaks kolm neli', '1234'],
    ['kaa suur tee alakriips kaks', 'kT_2'],
  ])('"%s" is %s', (spoken, typed) => {
    expect(typedFromSpoken(spoken, 'password')).toBe(typed)
  })
})

describe('text: unchanged, except three or more number words in a row', () => {
  it.each([
    ['kell viis', 'kell viis'],
    ['Ma jõuan kell viis.', 'Ma jõuan kell viis.'],
    ['kakskümmend kolm', 'kakskümmend kolm'],
    ['viis kolm kaheksa neli kaks', '53842'],
    ['minu kood on viis kolm kaheksa neli kaks', 'minu kood on 53842'],
    ['Helista viis üks kaks kolm neli viis kuus seitse, palun.', 'Helista 51234567, palun.'],
    ['kaks tuhat kakskümmend kuus aastal', '2026 aastal'],
    ['Tulen kell kolm, mitte neli', 'Tulen kell kolm, mitte neli'],
    ['ralf ät gmail punkt com', 'ralf ät gmail punkt com'],
    ['a bee tsee', 'a bee tsee'],
    ['üks kaks kolm ja neli viis kuus', '123 ja 456'],
    ['Tere!  Kuidas läheb', 'Tere!  Kuidas läheb'],
    ['', ''],
  ])('"%s" is "%s"', (spoken, typed) => {
    expect(typedFromSpoken(spoken, 'text')).toBe(typed)
  })
})

describe('auto: chooses by content', () => {
  it.each([
    ['ralf punkt sepp ät gmail punkt com', 'ralf.sepp@gmail.com'],
    ['kolm üheksa null kaks üks', '39021'],
    ['kakskümmend kolm', '23'],
    ['Ma jõuan kell viis.', 'Ma jõuan kell viis.'],
    ['kolm sõpra tulevad', 'kolm sõpra tulevad'],
    ['tere', 'tere'],
  ])('"%s" is "%s"', (spoken, typed) => {
    expect(typedFromSpoken(spoken, 'auto')).toBe(typed)
  })
})

describe('never reads an inherited name as a word of the tables', () => {
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])('"%s" is a plain word', (word) => {
    expect(typedFromSpoken(word, 'code')).toBe(word.toLocaleLowerCase() === word ? word : word.charAt(0).toLocaleLowerCase() + word.slice(1))
    expect(typedFromSpoken(`${word} kolm`, 'text')).toBe(`${word} kolm`)
  })
})

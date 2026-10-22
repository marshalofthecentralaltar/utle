import { describe, expect, it } from 'vitest'
import { MAX_CONTACTS, collectContacts, contactsLine, emailsIn, isEmailAddress, phonesIn } from './contacts.ts'
import type { ContactSource } from './contacts.ts'

// Round 8 (docs/ARCHITECTURE.md 29.3.3): addresses and phone numbers read off the page.

describe('mail (29.3): e-mail addresses in text', () => {
  it.each([
    ['Kirjuta mari.maasikas@example.ee kui sobib', ['mari.maasikas@example.ee']],
    ['E-post: Info@Firma.EE.', ['info@firma.ee']],
    ['(jaan_tamm+cv@mail.ttu.ee)', ['jaan_tamm+cv@mail.ttu.ee']],
    ['kaks: a@b.ee, c-d@e-f.com', ['a@b.ee', 'c-d@e-f.com']],
  ])('"%s" has %j', (text, found) => {
    expect(emailsIn(text)).toEqual(found)
  })

  it.each([
    'versioon v2.10.3',
    'kasutaja@',
    '@firma.ee',
    'mari..maasikas@example.ee',
    'mari@example',
    'mari@@example.ee',
    'hind 19.99 €',
    '',
  ])('"%s" has none', (text) => {
    expect(emailsIn(text)).toEqual([])
  })

  it('an address as a whole, and nothing else', () => {
    expect(isEmailAddress('mari@example.ee')).toBe(true)
    expect(isEmailAddress('MARI@Example.EE')).toBe(true)
    expect(isEmailAddress('mari@example.ee extra')).toBe(false)
    expect(isEmailAddress('mari@example')).toBe(false)
    expect(isEmailAddress('mari..m@example.ee')).toBe(false)
    expect(isEmailAddress('')).toBe(false)
  })
})

describe('mail (29.3): phone numbers in text, Estonian and international shapes only', () => {
  it.each([
    ['Telefon +372 5123 4567', ['+37251234567']],
    ['tel: +3725123456', ['+3725123456']],
    ['helista 5123 4567 õhtul', ['51234567']],
    ['kontor 612 3456', ['6123456']],
    ['mobiil 51234567.', ['51234567']],
    ['Soome +358 40 123 4567', ['+358401234567']],
  ])('"%s" has %j', (text, found) => {
    expect(phonesIn(text)).toEqual(found)
  })

  it.each([
    ['an ID code', 'Isikukood 39001010000'],
    ['a version', 'versioon v2.10.3'],
    ['a price', 'Hind 19.99 €'],
    ['a price with a comma', 'Hind 1234,50 €'],
    ['a date', 'Sündinud 10.03.2024'],
    ['an address with a street number and a postal code', 'Akadeemia tee 15, 12618 Tallinn'],
    ['a year range', '2019 - 2024'],
    ['a short number', 'tuba 123'],
    ['+372 with too few digits', '+372 512'],
    ['a number glued to letters', 'ABC51234567'],
  ])('%s is not a phone: "%s"', (_name, text) => {
    expect(phonesIn(text)).toEqual([])
  })
})

describe('mail (29.3): collectContacts', () => {
  const text = (t: string, visible = true): ContactSource => ({ text: t, visible })
  const link = (href: string, label: string, visible = true): ContactSource => ({ href, label, visible })

  it('reads mailto: and tel: links with their text as the label, values once', () => {
    const found = collectContacts([
      text('Mari Maasikas, mari.maasikas@example.ee'),
      link('mailto:mari.tookoht@firma.ee?subject=CV', 'Kirjuta mulle'),
      link('tel:+372%205123%204567', '+372 5123 4567'),
      text('+372 5123 4567'),
      text('mari.maasikas@example.ee'),
    ])
    expect(found).toEqual([
      { kind: 'email', value: 'mari.maasikas@example.ee', label: '' },
      { kind: 'email', value: 'mari.tookoht@firma.ee', label: 'Kirjuta mulle' },
      { kind: 'tel', value: '+37251234567', label: '+372 5123 4567' },
    ])
  })

  it('a tel: link that is not a phone shape, and a mailto: that is not an address, give nothing', () => {
    expect(collectContacts([link('tel:39001010000', 'kood'), link('mailto:not-an-address', 'x'), link('https://example.ee/a@b.ee', 'y')])).toEqual([])
  })

  it('the visible ones first, at most 20, the label clipped to 40 characters', () => {
    const hidden = Array.from({ length: 15 }, (_, i) => text(`peidus${i}@example.ee`, false))
    const shown = Array.from({ length: 15 }, (_, i) => text(`naha${i}@example.ee`))
    const found = collectContacts([...hidden, ...shown, link('mailto:pikk@example.ee', 'x'.repeat(80))])
    expect(MAX_CONTACTS).toBe(20)
    expect(found).toHaveLength(20)
    expect(found.slice(0, 16).every((c) => !c.value.startsWith('peidus'))).toBe(true)
    expect(found.find((c) => c.value === 'pikk@example.ee')?.label).toHaveLength(40)
  })

  it('the model line holds the values only', () => {
    expect(contactsLine([{ kind: 'email', value: 'a@b.ee', label: 'Kirjuta mulle' }, { kind: 'tel', value: '+37251234567', label: 'helista' }])).toBe('e-mail a@b.ee, tel +37251234567')
    expect(contactsLine([])).toBe('none')
    expect(contactsLine(undefined)).toBe('none')
  })
})

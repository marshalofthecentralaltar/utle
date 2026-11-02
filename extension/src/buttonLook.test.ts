import { describe, expect, it } from 'vitest'
import { colorName, looksLikeButton } from './buttonLook.ts'
import type { LinkLook } from './buttonLook.ts'

// Round 10 (#5, ARCHITECTURE 34.1): a link styled as a button is listed as a button with its text.

const PAD = { top: 12, right: 24, bottom: 12, left: 24 }
const NO_PAD = { top: 0, right: 0, bottom: 0, left: 0 }
const plain: LinkLook = { role: null, className: '', text: 'Privacy Policy', background: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', padding: NO_PAD }

describe('looksLikeButton', () => {
  it('an ordinary link stays a link', () => {
    expect(looksLikeButton(plain)).toBe(false)
  })

  it('role="button" is a button', () => {
    expect(looksLikeButton({ ...plain, role: 'button' })).toBe(true)
  })

  it('a class name with button or btn is a button', () => {
    expect(looksLikeButton({ ...plain, className: 'mail-btn primary' })).toBe(true)
    expect(looksLikeButton({ ...plain, className: 'm_123CallToActionButton' })).toBe(true)
  })

  it('a boxed link (a filled background and padding) with short text is a button: the verify link of the mail', () => {
    expect(looksLikeButton({ ...plain, text: 'Verify email address', background: 'rgb(0, 0, 0)', padding: PAD })).toBe(true)
  })

  it('a gradient counts as a fill', () => {
    expect(looksLikeButton({ ...plain, text: 'Kinnita', backgroundImage: 'linear-gradient(rgb(0, 0, 0), rgb(40, 40, 40))', padding: PAD })).toBe(true)
  })

  it('no fill, no padding, or long text: a link', () => {
    expect(looksLikeButton({ ...plain, text: 'Verify email address', padding: PAD })).toBe(false)
    expect(looksLikeButton({ ...plain, text: 'Verify email address', background: 'rgb(0, 0, 0)' })).toBe(false)
    expect(looksLikeButton({ ...plain, text: 'Click here to read the whole story about the new building of the university', background: 'rgb(240, 240, 240)', padding: PAD })).toBe(false)
    expect(looksLikeButton({ ...plain, text: 'Verify email address', background: 'rgba(0, 0, 0, 0.1)', padding: PAD })).toBe(false)
  })
})

describe('colorName', () => {
  it('names the fill of a button in one plain word', () => {
    expect(colorName('rgb(0, 0, 0)')).toBe('black')
    expect(colorName('rgb(17, 17, 17)')).toBe('black')
    expect(colorName('rgb(255, 255, 255)')).toBe('white')
    expect(colorName('rgb(136, 136, 136)')).toBe('gray')
    expect(colorName('rgb(11, 87, 208)')).toBe('blue')
    expect(colorName('rgb(194, 231, 255)')).toBe('blue')
    expect(colorName('rgb(217, 48, 37)')).toBe('red')
    expect(colorName('rgb(24, 128, 56)')).toBe('green')
    expect(colorName('rgb(251, 188, 4)')).toBe('yellow')
    expect(colorName('rgb(255, 109, 0)')).toBe('orange')
    expect(colorName('rgb(103, 58, 183)')).toBe('purple')
    expect(colorName('rgb(233, 30, 99)')).toBe('pink')
  })

  it('no colour for a transparent or faint fill, or what it cannot read', () => {
    expect(colorName('rgba(0, 0, 0, 0)')).toBeNull()
    expect(colorName('transparent')).toBeNull()
    expect(colorName('rgba(0, 0, 0, 0.2)')).toBeNull()
    expect(colorName('color(display-p3 1 0 0)')).toBeNull()
  })
})

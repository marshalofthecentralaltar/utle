// Round 10 (#5, ARCHITECTURE 34.1): what readPage calls a link that looks like a button, and the
// one plain word it gives a filled button's colour ("vajuta musta nuppu"). Pure: page.ts reads the
// element and its computed style and hands the values in.

/** What readPage reads of a link (or of the cell that holds only it) to tell a button. */
export interface LinkLook {
  /** The role attribute, or null. */
  role: string | null
  /** The class attribute, '' when none. */
  className: string
  /** Its name as readPage lists it. */
  text: string
  /** Computed background-color: "rgb(0, 0, 0)", "rgba(0, 0, 0, 0)". */
  background: string
  /** Computed background-image: "none", or a gradient or an image. */
  backgroundImage: string
  /** Computed paddings, px. */
  padding: { top: number; right: number; bottom: number; left: number }
}

/** A button says a few words; a link inside a sentence may say many. */
export const BUTTON_TEXT_MAX = 40
export const BUTTON_WORDS_MAX = 6
/** The least padding of a box: a button has room around its words. */
const MIN_PAD_Y = 4
const MIN_PAD_X = 8
/** A fill this opaque or more is a fill. */
const MIN_ALPHA = 0.5
const BUTTON_CLASS = /btn|button/i

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** rgb() or rgba() as getComputedStyle writes it; transparent; null for anything else. */
function rgbaOf(css: string): Rgba | null {
  const value = css.trim().toLowerCase()
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value)
  if (!m) return null
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha }
}

/** A fill: a gradient, or a background colour at least MIN_ALPHA opaque. */
export function isFilled(background: string, backgroundImage: string): boolean {
  if (/gradient\(/i.test(backgroundImage)) return true
  const c = rgbaOf(background)
  return c !== null && c.a >= MIN_ALPHA
}

/**
 * A link that looks like a button: role="button", a class name with button or btn in it, or a
 * box (a filled background and padding on every side) around a short text.
 */
export function looksLikeButton(look: LinkLook): boolean {
  if (look.role === 'button') return true
  if (BUTTON_CLASS.test(look.className)) return true
  const text = look.text.trim()
  const short = text !== '' && text.length <= BUTTON_TEXT_MAX && text.split(/\s+/).length <= BUTTON_WORDS_MAX
  const { top, right, bottom, left } = look.padding
  const padded = top >= MIN_PAD_Y && bottom >= MIN_PAD_Y && left >= MIN_PAD_X && right >= MIN_PAD_X
  return short && padded && isFilled(look.background, look.backgroundImage)
}

/**
 * The fill of a button in one plain English word (the model translates "musta" to black), or null
 * when it is transparent, faint, or not an rgb colour.
 */
export function colorName(background: string): string | null {
  const c = rgbaOf(background)
  if (c === null || c.a < MIN_ALPHA) return null
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2
  if (light < 0.18) return 'black'
  if (light > 0.94) return 'white'
  const delta = max - min
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1))
  if (saturation < 0.18) return 'gray'
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  hue = (hue * 60 + 360) % 360
  if (hue < 15 || hue >= 340) return 'red'
  if (hue < 40) return 'orange'
  if (hue < 70) return 'yellow'
  if (hue < 165) return 'green'
  if (hue < 255) return 'blue'
  if (hue < 290) return 'purple'
  return 'pink'
}

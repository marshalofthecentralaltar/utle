/**
 * Draws the extension's icons (ARCHITECTURE 27.5): a green rounded square with a white dot, like the
 * strip's microphone square while it listens, at 16, 48 and 128 px, into extension/icons/. No
 * external tool: the pixels are computed here (4×4 supersampled for smooth edges) and written as
 * PNG with node:zlib. `npm run icons`; the PNGs are committed, so a build never needs this.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

export const ICON_SIZES = [16, 48, 128] as const

const GREEN: readonly [number, number, number] = [0x3d, 0xdc, 0x84]
const WHITE: readonly [number, number, number] = [0xff, 0xff, 0xff]

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A PNG of 8-bit RGBA pixels, rows top to bottom. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  // Compression, filter and interlace stay 0.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // no filter on this row
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** Inside a rounded square of side 1 with corner radius r, for a point in [0,1]². */
function inRoundedSquare(x: number, y: number, r: number): boolean {
  const dx = Math.max(r - x, 0, x - (1 - r))
  const dy = Math.max(r - y, 0, y - (1 - r))
  return dx * dx + dy * dy <= r * r
}

/** The icon's RGBA pixels at size × size. */
export function drawIcon(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4)
  const samples = 4
  const corner = 0.22
  const dot = 0.2
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let square = 0
      let white = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size
          const y = (py + (sy + 0.5) / samples) / size
          if (!inRoundedSquare(x, y, corner)) continue
          square++
          if ((x - 0.5) ** 2 + (y - 0.5) ** 2 <= dot * dot) white++
        }
      }
      const i = (py * size + px) * 4
      const share = square === 0 ? 0 : white / square
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round((GREEN[c] ?? 0) * (1 - share) + (WHITE[c] ?? 0) * share)
      pixels[i + 3] = Math.round((255 * square) / (samples * samples))
    }
  }
  return pixels
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons')
  mkdirSync(dir, { recursive: true })
  for (const size of ICON_SIZES) {
    writeFileSync(join(dir, `${size}.png`), encodePng(size, size, drawIcon(size)))
    console.log(`extension/icons/${size}.png`)
  }
}

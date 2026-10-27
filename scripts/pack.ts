/**
 * The Chrome Web Store zip (ARCHITECTURE 27.5): builds the extension and writes
 * extension/out/utle-<version>.zip with manifest.json, the html pages, dist/, relay.js and icons/,
 * nothing else. The zip is written here with node:zlib (deflate), no external tool.
 *
 *   npm run ext:pack
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'
import { buildExtension } from './ext.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = join(repoRoot, 'extension')

/** What the store gets: the manifest, the pages, the bundles, the relay and the icons. */
export const PACKED_FILES = ['manifest.json', 'options.html', 'offscreen.html', 'permission.html', 'newtab.html', 'welcome.html', 'help.html', 'relay.js'] as const
export const PACKED_DIRS = ['dist', 'icons'] as const

interface Entry {
  name: string
  data: Buffer
}

/** A zip of entries, deflated, with a fixed timestamp so the same input gives the same bytes. */
export function zip(entries: Entry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  // 2026-10-06 00:00 in DOS time.
  const dosTime = 0
  const dosDate = ((2026 - 1980) << 9) | (10 << 5) | 6
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const deflated = deflateRawSync(entry.data, { level: 9 })
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, deflated)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    // Extra, comment, disk, internal and external attributes stay 0.
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + deflated.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

function filesIn(dir: string, prefix: string): Entry[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((item) => (item.isDirectory() ? filesIn(join(dir, item.name), `${prefix}${item.name}/`) : [{ name: `${prefix}${item.name}`, data: readFileSync(join(dir, item.name)) }]))
}

export async function pack(): Promise<string> {
  // A clean dist/: nothing left over from an older build reaches the store.
  rmSync(join(extensionDir, 'dist'), { recursive: true, force: true })
  await buildExtension()
  const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('manifest.json has no version')
  const entries: Entry[] = PACKED_FILES.map((file) => ({ name: file, data: readFileSync(join(extensionDir, file)) }))
  for (const dir of PACKED_DIRS) {
    const path = join(extensionDir, dir)
    if (!existsSync(path)) throw new Error(`extension/${dir} is missing`)
    entries.push(...filesIn(path, `${dir}/`))
  }
  const out = join(extensionDir, 'out')
  mkdirSync(out, { recursive: true })
  const target = join(out, `utle-${manifest.version}.zip`)
  writeFileSync(target, zip(entries))
  return target
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = await pack()
  console.log(`store zip: ${target}`)
}

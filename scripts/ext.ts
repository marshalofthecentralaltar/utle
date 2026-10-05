/**
 * Builds the extension (docs/ARCHITECTURE.md 21.2): bundles extension/src/*.ts into
 * extension/dist/. `npm run ext`.
 *
 * buildExtension({ outRoot, offscreenEntry }) builds a complete copy elsewhere (manifest, pages and
 * dist/), which the end-to-end test uses with a stand-in for src/core/inpage.ts.
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = join(repoRoot, 'extension')
const STATIC = ['manifest.json', 'options.html', 'offscreen.html', 'permission.html', 'newtab.html', 'relay.js']

export interface BuildOptions {
  /** Folder that gets manifest.json, the pages and dist/. Default: extension/ itself. */
  outRoot?: string
  /** Entry of the offscreen document. Default: extension/src/offscreen.ts. */
  offscreenEntry?: string
}

export async function buildExtension(options: BuildOptions = {}): Promise<string> {
  const outRoot = options.outRoot ?? extensionDir
  const outdir = join(outRoot, 'dist')
  mkdirSync(outdir, { recursive: true })
  if (outRoot !== extensionDir) for (const file of STATIC) copyFileSync(join(extensionDir, file), join(outRoot, file))
  const src = join(extensionDir, 'src')
  await build({
    entryPoints: {
      background: join(src, 'background.ts'),
      content: join(src, 'content.ts'),
      page: join(src, 'page.ts'),
      offscreen: options.offscreenEntry ?? join(src, 'offscreen.ts'),
      permission: join(src, 'permission.ts'),
      options: join(src, 'options.ts'),
      newtab: join(src, 'newtab.ts'),
    },
    outdir,
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    charset: 'utf8',
    logLevel: 'warning',
  })
  copyFileSync(join(repoRoot, 'public', 'asr-worklet.js'), join(outdir, 'asr-worklet.js'))
  return outRoot
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildExtension()
  console.log('extension built into extension/dist/')
}

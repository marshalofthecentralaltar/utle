/**
 * The production entry (ARCHITECTURE 27.1): `npm run serve`. The same API as the dev server, on a
 * plain Node http server, no Vite. PORT (default 8787); UTLE_TOKEN for the token (27.2);
 * ANTHROPIC_API_KEY, SONIOX_API_KEY and UTLE_MODEL as in development. Never logs the token.
 */
import { fileURLToPath } from 'node:url'
import { tokenUsers } from './auth.ts'
import { createUtleServer } from './app.ts'

const DEFAULT_PORT = 8787

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.PORT) || DEFAULT_PORT
const server = createUtleServer({ root })

server.listen(port, () => {
  const users = tokenUsers().length
  const auth = users === 0 ? 'open (UTLE_TOKEN unset)' : `token required, ${users} profile${users === 1 ? '' : 's'}`
  console.info(`[serve] Ütle server on port ${port}, ${auth}; understanding ${process.env.ANTHROPIC_API_KEY ? 'on' : 'off (no ANTHROPIC_API_KEY)'}`)
})

const stop = (): void => {
  server.close()
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

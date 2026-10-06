import type { Plugin } from 'vite'
import { attachUtleApi } from './app.ts'

/**
 * Hosts the API (server/app.ts, ARCHITECTURE 27.1) on the Vite dev server, so `npm run dev` is the
 * whole product. Production runs the same API without Vite: `npm run serve` (server/serve.ts).
 * `vite --mode rehearsal` answers /api/interpret from the demo script instead of the model.
 */
export function utleApi(): Plugin {
  let rehearsal = false
  return {
    name: 'utle-api',
    configResolved(config) {
      rehearsal = config.mode === 'rehearsal'
    },
    configureServer(server) {
      // The local recogniser rides on the dev server's http server; vitest has none to listen on.
      const httpServer = server.httpServer && !process.env.VITEST ? server.httpServer : null
      attachUtleApi(httpServer, (path, handler) => server.middlewares.use(path, handler), { root: server.config.root, rehearsal })
    },
  }
}

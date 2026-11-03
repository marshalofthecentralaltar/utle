import { defineConfig } from 'vitest/config'
import { utleApi } from './server/vitePlugin.ts'

// Round 12: no page is built here any more; `npm run dev` is Vite for the API and the speech socket only.
// https://vite.dev/config/
export default defineConfig({
  plugins: [utleApi()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'extension/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    passWithNoTests: true,
  },
})

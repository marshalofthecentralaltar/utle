// siteSearch: the site's own search field.

import type { Site } from '../sites.ts'
import { searchFieldFor } from '../sites.ts'
import { isTextField, visible } from '../box.ts'
import { behindDialog } from '../../../src/browser/protocol.ts'
import type { PageResult } from './common.ts'
import { fail, leaving, ok, sleep } from './common.ts'
import { openRow } from './conversation.ts'
import { DIALOG, clean } from './items.ts'
import { emptyField, pressEnter, typeAtSelection, waitFor } from './messageBox.ts'

/** siteSearch: how long a search field may take to appear. */
const SEARCH_FIELD_MS = 1000
/** siteSearch: how long Enter gets to navigate before the form is submitted. */
const ENTER_NAVIGATE_MS = 600
/** siteSearch on a chat list: how long the filtered list gets to settle on one row. */
const FILTER_MS = 1500

const GENERIC_SEARCH_FIELDS = [
  'input[type="search"]',
  '[role="searchbox"]',
  'input[name="q"]',
  'textarea[name="q"]',
  'input#search',
  'input[name="search_query"]',
  'input[placeholder*="otsi" i]',
  'input[placeholder*="search" i]',
]

function searchField(site: Site | null): HTMLElement | null {
  const selectors = [searchFieldFor(location.hostname), site?.searchField ?? null, ...GENERIC_SEARCH_FIELDS]
  for (const selector of selectors) {
    if (!selector) continue
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (isTextField(el) && visible(el)) return el
    }
  }
  return null
}

/**
 * Lane EXIT (finding 5): a search field that is on the page but covered by an open dialog (YouTube's cookie
 * consent). The answer names the dialog's buttons, so he hears to answer it first, not that there is no search.
 */
function fieldBehindDialog(site: Site | null): string | null {
  const dialog = [...document.querySelectorAll<HTMLElement>(DIALOG)].find((d) => visible(d))
  if (!dialog) return null
  const selectors = [searchFieldFor(location.hostname), site?.searchField ?? null, ...GENERIC_SEARCH_FIELDS]
  const covered = selectors.some((selector) => selector !== null && [...document.querySelectorAll<HTMLElement>(selector)].some((el) => isTextField(el) && !dialog.contains(el)))
  if (!covered) return null
  const buttons = [...dialog.querySelectorAll<HTMLElement>('button, [role="button"]')]
    .filter((b) => visible(b))
    .map((b) => clean(b.innerText || b.textContent))
    .filter((t) => t !== '' && t.length <= 40)
  return behindDialog([...new Set(buttons)])
}

export async function siteSearch(query: string, site: Site | null): Promise<PageResult> {
  const text = query.trim()
  if (text === '') return fail('not_found', 'Nothing to search for.')
  const field = await waitFor(() => searchField(site), SEARCH_FIELD_MS)
  if (!field) return fail('not_found', fieldBehindDialog(site) ?? 'This page has no search field.')
  await emptyField(field)
  await typeAtSelection(field, text)
  await sleep(60)
  const rows = site?.conversationRows
  if (site && rows) {
    // A chat list: the search filters it. One row left is the one meant.
    const single = await waitFor(() => {
      const shown = [...document.querySelectorAll<HTMLElement>(rows)].filter((row) => visible(row))
      return shown.length === 1 ? shown[0] ?? null : null
    }, FILTER_MS)
    if (single) return openRow(single, site)
    return ok()
  }
  const before = location.href
  pressEnter(field)
  const form = field.closest('form')
  if (form) {
    const navigated = await waitFor(() => (leaving || location.href !== before ? true : null), ENTER_NAVIGATE_MS)
    if (!navigated) form.requestSubmit()
  }
  return ok()
}

// Injected into the page in front (isolated world) by background.ts. Defines globalThis.__utle
// once; background.ts then calls __utle.run(command) and gets a BrowserResult back.
// See docs/ARCHITECTURE.md 20.2 and 21.2, and docs/plans/2026-10-05-m7-understanding.md (M7:
// readPage, clickItem, focusItem, siteSearch, media, pressKey, clearField, arm, the armed box).

import type { BrowserCommand } from '../../src/browser/protocol.ts'
import type { Site, SiteName } from './sites.ts'
import { SITES } from './sites.ts'
import { boxState, findMessageBox, watchTrustedClicks } from './box.ts'
import type { PageResult } from './page/common.ts'
import { fail, markLeaving, ok } from './page/common.ts'
import { openConversation } from './page/conversation.ts'
import { docsBox, docsSetText, format } from './page/document.ts'
import { caret, select, typeText } from './page/edit.ts'
import { arm, clearField, pressKey } from './page/field.ts'
import { hideHints, showHints } from './page/hints.ts'
import { compose, composeOpened, mailField } from './page/mail.ts'
import { media } from './page/media.ts'
import { insertText, pressSend, setText } from './page/messageBox.ts'
import { clickHint, clickItem, contextMenu, focusItem, hover, onNavigation, readPage, scrollToItem } from './page/read.ts'
import { readAloudText } from './page/reading.ts'
import { scroll } from './page/scroll.ts'
import { siteSearch } from './page/siteSearch.ts'

/** What background.ts sends: a command plus which messaging site the page is. */
export type PageCommand = BrowserCommand & { site: SiteName | null }

function siteOf(name: SiteName | null): Site | null {
  return name === null ? null : SITES[name]
}

async function run(command: PageCommand): Promise<PageResult> {
  const site = siteOf(command.site)
  try {
    switch (command.kind) {
      case 'scroll':
        return await scroll(command.direction, command.mode, command.seconds)
      case 'showHints':
        return showHints(site)
      case 'hideHints':
        hideHints()
        return ok()
      case 'clickHint':
        return await clickHint(command.number)
      case 'insertText':
        return await insertText(String(command.text), command.submit === true, site)
      case 'openConversation':
        return await openConversation(command.name, site)
      case 'readBox':
        return ok({ box: docsBox() ?? boxState(findMessageBox(site), site) })
      case 'setText':
        return docsBox() ? docsSetText(String(command.text)) : await setText(String(command.text), site)
      case 'pressSend':
        // Docs is a box the dictation types into, not one that sends: a "saada" there must never press
        // Enter into the document, nor into the title or search input the generic composer rule would find.
        return docsBox() ? fail('failed', 'Google Docs has nothing to send: the words are in the document.') : await pressSend(site)
      case 'readPage':
        return readPage(site)
      case 'clickItem':
        return await clickItem(Number(command.id), site)
      case 'focusItem':
        return await focusItem(Number(command.id), site)
      case 'hover':
        return await hover(Number(command.id))
      case 'contextMenu':
        return await contextMenu(Number(command.id))
      case 'scrollTo':
        return await scrollToItem(Number(command.id))
      case 'siteSearch':
        return await siteSearch(String(command.query), site)
      case 'media':
        return await media(command.action, command.seconds)
      case 'pressKey':
        return await pressKey(command.key, command.times, site)
      case 'caret':
        return await caret(command.to, site)
      case 'select':
        return await select(command.what, site)
      case 'typeText':
        return await typeText(String(command.text), site)
      case 'clearField':
        return await clearField(site)
      case 'arm':
        return arm(command.on === true, site)
      case 'format':
        return await format(command.style, site)
      // ---------- mail (29.3) ----------
      case 'compose':
        return await compose(command.to, command.body)
      case 'composeTo':
        return await composeOpened()
      case 'mailField':
        return await mailField(command.field, command.text)
      // ---------- reading aloud (29.5) ----------
      case 'read':
        return readAloudText(command.what, site)
      default:
        return fail('failed', `The page does not know the command "${command.kind}".`)
    }
  } catch (error) {
    return fail('failed', `Something went wrong on the page: ${error instanceof Error ? error.message : String(error)}`)
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __utle: { run(command: PageCommand): Promise<PageResult> } | undefined
}

if (!globalThis.__utle) {
  globalThis.__utle = { run }
  // A field the user really clicks or tabs into is armed for dictation (box.ts).
  watchTrustedClicks()
  // Same-document navigations do not unload the page, so remove the labels ourselves.
  const nav = (globalThis as { navigation?: EventTarget }).navigation
  nav?.addEventListener('navigate', onNavigation)
  window.addEventListener('popstate', onNavigation)
  window.addEventListener('hashchange', onNavigation)
  window.addEventListener('pagehide', onNavigation)
  window.addEventListener('beforeunload', () => {
    markLeaving()
  })
}

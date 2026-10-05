// Every site-specific selector lives here, one per line, each marked VERIFIED (read from the real
// logged-in site) or UNVERIFIED (a best guess). If something misses at the demo: open DevTools on
// the site, find the element, change the selector below, run `npm run ext`, and reload the
// extension on chrome://extensions. See docs/ARCHITECTURE.md 21.2.

export type SiteName = 'whatsapp' | 'messenger'

export interface Site {
  /** Where openConversation goes when no tab of a messaging site is open. */
  home: string
  isHere(location: { hostname: string; pathname: string }): boolean
  /** Links to conversations in the chat list (clicked; the address changes). */
  conversationLinks?: string
  /** Rows of the chat list that open a conversation without changing the address. */
  conversationRows?: string
  /** Inside a row: the element whose title attribute is the conversation's name. */
  rowName?: string
  /** The chat list itself: seen means the site is logged in. */
  chatList?: string
  /** The search field that filters the chat list. */
  searchField?: string
  /** The open conversation's name, to know the right chat opened. */
  openChatName?: string
  /** The message box. */
  composer: string
  /** Clicked when Enter did not send (the box still holds the text after a moment). */
  sendButton: string
}

export const SITES: Record<SiteName, Site> = {
  whatsapp: {
    home: 'https://web.whatsapp.com/',
    isHere: (location) => location.hostname === 'web.whatsapp.com',

    chatList: [
      '#pane-side [role="grid"][aria-label="Chat list"]', // VERIFIED 2026-10-05
    ].join(', '),
    conversationRows: [
      '#pane-side [role="grid"][aria-label="Chat list"] [role="row"]', // VERIFIED 2026-10-05
    ].join(', '),
    rowName: [
      'span[title]', // VERIFIED 2026-10-05: the first span[title] in a row is the chat's name
    ].join(', '),
    searchField: [
      '#side input[role="textbox"][aria-label="Search or start a new chat"]', // VERIFIED 2026-10-05
      '#side [contenteditable="true"][role="textbox"]', // UNVERIFIED: older builds used a Lexical search box
    ].join(', '),
    openChatName: [
      '#main header span[title]', // UNVERIFIED
    ].join(', '),
    composer: [
      '#main footer div[contenteditable="true"][role="textbox"]', // UNVERIFIED (expected Lexical)
      '#main footer [contenteditable="true"]', // UNVERIFIED fallback
    ].join(', '),
    sendButton: [
      '#main footer button[aria-label="Send"]', // UNVERIFIED
      '#main footer [role="button"][aria-label="Send"]', // UNVERIFIED
      '#main footer button[aria-label="Saada"]', // UNVERIFIED (Estonian interface)
      '#main footer [data-icon="send"]', // UNVERIFIED: page.ts clicks the closest button around it
      '#main footer [data-icon="wa-wds-send"]', // UNVERIFIED
    ].join(', '),
  },

  messenger: {
    home: 'https://www.messenger.com/',
    isHere: (location) =>
      /(^|\.)messenger\.com$/.test(location.hostname) ||
      (/(^|\.)facebook\.com$/.test(location.hostname) && location.pathname.startsWith('/messages')),

    // Messenger links each conversation to /t/<id>. All UNVERIFIED: nobody has tried them logged in.
    conversationLinks: [
      '[role="navigation"] a[href*="/t/"]', // UNVERIFIED
      '[role="grid"] a[href*="/t/"]', // UNVERIFIED
      'a[href^="/t/"]', // UNVERIFIED
      'a[href*="/messages/t/"]', // UNVERIFIED
      'a[href*="/e2ee/t/"]', // UNVERIFIED
    ].join(', '),
    composer: [
      'div[contenteditable="true"][role="textbox"]', // UNVERIFIED (Lexical)
    ].join(', '),
    sendButton: [
      'div[role="button"][aria-label="Press enter to send"]', // UNVERIFIED
      'div[role="button"][aria-label="Press Enter to send"]', // UNVERIFIED
      'div[role="button"][aria-label="Send"]', // UNVERIFIED
      'div[role="button"][aria-label="Saada"]', // UNVERIFIED
      'div[role="button"][aria-label="Vajuta saatmiseks sisestusklahvi"]', // UNVERIFIED
    ].join(', '),
  },
}

/** Settings that change which site a page is (stored in chrome.storage.local). */
export interface SiteSettings {
  /** Address prefix to site name. The tests map fixture pages to whatsapp. */
  siteOverrides: Record<string, SiteName>
  /** Overrides the messaging home; a page on its origin counts as Messenger unless overridden. */
  messagingHome: string | null
}

/** Which messaging site an address is, or null. */
export function siteOf(url: string | undefined, settings: SiteSettings): SiteName | null {
  if (!url) return null
  for (const [prefix, name] of Object.entries(settings.siteOverrides)) {
    if (url.startsWith(prefix)) return name
  }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (SITES.whatsapp.isHere(u)) return 'whatsapp'
  if (SITES.messenger.isHere(u)) return 'messenger'
  if (settings.messagingHome) {
    try {
      if (u.origin === new URL(settings.messagingHome).origin) return 'messenger'
    } catch {
      return null
    }
  }
  return null
}

/**
 * The site's own search field, by hostname without a leading "www." (siteSearch, M7). A site
 * missing here is searched through the generic selectors in page.ts; none at all means Google.
 */
export const SEARCH_FIELDS: Record<string, string> = {
  'youtube.com': 'input[name="search_query"]', // UNVERIFIED: read from the public page, not logged in
  'm.youtube.com': 'input[name="search_query"]', // UNVERIFIED
  'google.com': 'textarea[name="q"], input[name="q"]', // UNVERIFIED
  'google.ee': 'textarea[name="q"], input[name="q"]', // UNVERIFIED
  'web.whatsapp.com': SITES.whatsapp.searchField ?? '',
}

/** The SEARCH_FIELDS selector for a hostname, or null. "www.google.com" finds "google.com". */
export function searchFieldFor(hostname: string): string | null {
  const host = hostname.toLowerCase()
  const bare = host.replace(/^www\./, '')
  return SEARCH_FIELDS[host] ?? SEARCH_FIELDS[bare] ?? null
}

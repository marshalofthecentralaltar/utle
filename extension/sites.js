// Every site-specific selector lives here. UNVERIFIED against the real Messenger: nobody has
// tried them logged in. If something misses at the demo, open DevTools on Messenger, find the
// element, and change the selector below; then reload the extension on chrome://extensions.
//
// Injected into the target tab before page.js, which reads globalThis.__utleSites.

globalThis.__utleSites = {
  messenger: {
    // Where openConversation uses these selectors instead of the generic link search.
    isHere: (location) =>
      /(^|\.)messenger\.com$/.test(location.hostname) ||
      (/(^|\.)facebook\.com$/.test(location.hostname) && location.pathname.startsWith('/messages')),

    // Links to conversations in the chat list. Messenger links each one to /t/<id>.
    conversationLinks: [
      '[role="navigation"] a[href*="/t/"]',
      '[role="grid"] a[href*="/t/"]',
      'a[href^="/t/"]',
      'a[href*="/messages/t/"]',
      'a[href*="/e2ee/t/"]',
    ].join(', '),

    // The composer: a contenteditable div with role="textbox" (Lexical).
    composer: 'div[contenteditable="true"][role="textbox"]',

    // Clicked when Enter did not send (the box still holds the text after a moment).
    sendButton: [
      'div[role="button"][aria-label="Press enter to send"]',
      'div[role="button"][aria-label="Press Enter to send"]',
      'div[role="button"][aria-label="Send"]',
      'div[role="button"][aria-label="Saada"]',
      'div[role="button"][aria-label="Vajuta saatmiseks sisestusklahvi"]',
    ].join(', '),
  },
}

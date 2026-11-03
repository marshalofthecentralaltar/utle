// Shared by et.ts and en.ts: where a tab is, as the lines name it.

/** The address without scheme and www, or the search words of a Google search. */
export function placeOf(url: string): { search: string | null; host: string } {
  const search = /^https:\/\/www\.google\.com\/search\?q=([^&]*)/.exec(url)
  if (search?.[1] !== undefined) {
    let words = search[1]
    try {
      words = decodeURIComponent(words.replace(/\+/g, ' '))
    } catch {
      // A malformed escape is shown as it is.
    }
    return { search: words, host: 'google.com' }
  }
  const host = /^[a-z]+:\/\/(?:www\.)?([^/?#]+)/i.exec(url)?.[1] ?? url
  return { search: null, host }
}

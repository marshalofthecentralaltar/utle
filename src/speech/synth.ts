/** Reading aloud through the browser's speech synthesis. */

function synthesis(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
}

/**
 * Reads text aloud in the given language and calls onEnd exactly once, when the reading
 * finishes, is cut off, fails, or cannot start at all.
 */
export function speak(text: string, lang: string, onEnd: () => void): void {
  const synth = synthesis()
  let ended = false
  const end = (): void => {
    if (ended) return
    ended = true
    onEnd()
  }
  if (!synth || text.trim() === '') {
    setTimeout(end, 0)
    return
  }

  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  const family = lang.slice(0, 2)
  const voices = synth.getVoices()
  const voice = voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(family))
  if (voice) utterance.voice = voice
  utterance.onend = end
  utterance.onerror = end
  synth.speak(utterance)
}

/** Stops any reading in progress. */
export function hush(): void {
  synthesis()?.cancel()
}

// The offscreen document (docs/ARCHITECTURE.md 21.2): owns the microphone, the recogniser client
// and the in-page engine. It can only use chrome.runtime, so everything else goes through the
// service worker.

import type { BrowserCommand, BrowserResult } from '../../src/browser/protocol.ts'
import { browserSocket, createLocalRecognizer } from '../../src/speech/local.ts'
import type { AudioSource } from '../../src/speech/local.ts'
import { createMicrophoneFrames } from '../../src/speech/microphone.ts'
import { createEngine } from './engine.ts'
import type { InpageLogic } from './engine.ts'
import type { RunAnswer, StripState, ToBackground, ToOffscreen } from './messages.ts'

export const DEFAULT_ASR_URL = 'ws://localhost:5173/api/asr'

function tell(message: ToBackground): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => undefined)
}

export function startOffscreen(logic: InpageLogic): void {
  const address = new URLSearchParams(location.search).get('asr') ?? DEFAULT_ASR_URL
  let connects = 0
  let micOpens = 0
  const publish = (patch: Partial<StripState>): void => {
    void tell({ type: 'utle-state', patch })
  }

  const microphone = (): AudioSource => {
    const inner = createMicrophoneFrames(chrome.runtime.getURL('dist/asr-worklet.js'))
    return {
      async start(onFrame) {
        await inner.start(onFrame)
        micOpens += 1
        publish({ micOpens })
      },
      stop: () => inner.stop(),
    }
  }

  const run = async (command: BrowserCommand): Promise<BrowserResult> => {
    const answer = (await tell({ type: 'utle-run', command })) as RunAnswer | undefined
    return answer?.result ?? { ok: false, code: 'failed', message: 'The extension did not answer.' }
  }

  const engine = createEngine({
    logic,
    lang: 'et',
    run,
    publish,
    recognizer: (handlers, isInstant, onUnavailable) =>
      createLocalRecognizer(handlers, isInstant, {
        onUnavailable,
        address,
        connect: (events) => {
          connects += 1
          publish({ connects })
          return browserSocket(events, address)
        },
        audio: microphone,
      }),
    micBlocked: () => {
      void tell({ type: 'utle-mic-blocked' })
    },
  })

  chrome.runtime.onMessage.addListener((message: ToOffscreen) => {
    if (!message || message.target !== 'offscreen') return false
    if (message.type === 'toggle') engine.toggle()
    else if (message.type === 'start') engine.start()
    return false
  })
}

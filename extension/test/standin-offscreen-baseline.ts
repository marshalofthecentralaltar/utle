// The offscreen entry as main b901d29 behaved, for the timing comparison in voice.ts: no live
// previews (the box changes only when the utterance arrives) and the 700 ms hold of the localhost page.
import { LOCAL_HOLD_MS } from '../../src/speech/asrProtocol.ts'
import { startOffscreen } from '../src/offscreenMain.ts'
import { applyIntent, inpageInstant, inpageResult, inpageStep, initialInpage, pageIntentFrom } from './standin.ts'

startOffscreen({ initialInpage, inpageStep, inpageResult, inpageInstant, inpagePreview: () => null, applyIntent, pageIntentFrom }, { holdMs: LOCAL_HOLD_MS })

// Entry of the offscreen document: the engine with the real src/core/inpage.ts.
import { applyIntent, inpageInstant, inpagePreview, inpageResult, inpageStep, initialInpage } from '../../src/core/inpage.ts'
import { pageIntentFrom } from '../../src/core/pageIntent.ts'
import { startOffscreen } from './offscreenMain.ts'

startOffscreen({ initialInpage, inpageStep, inpageResult, inpageInstant, inpagePreview, applyIntent, pageIntentFrom })

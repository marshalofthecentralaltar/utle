// Entry of the offscreen document: the engine with the real src/core/inpage.ts.
import { inpageInstant, inpageResult, inpageStep, initialInpage } from '../../src/core/inpage.ts'
import { startOffscreen } from './offscreenMain.ts'

startOffscreen({ initialInpage, inpageStep, inpageResult, inpageInstant })

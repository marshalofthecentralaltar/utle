// The offscreen document's entry for the end-to-end test: the engine with the stand-in logic.
import { startOffscreen } from '../src/offscreenMain.ts'
import { inpageInstant, inpageResult, inpageStep, initialInpage } from './standin.ts'

startOffscreen({ initialInpage, inpageStep, inpageResult, inpageInstant })

/**
 * Every line a person can read in Ütle, in one table keyed by language, so a native speaker
 * proofreads one file. Estonian is the default (docs/ARCHITECTURE.md section 20.3).
 */
import type { Lang, Strings } from './strings/types.ts'
import { ET } from './strings/et.ts'
import { EN } from './strings/en.ts'

export { LANG_TAG, langOfTag } from './strings/types.ts'
export type { Lang, Strings } from './strings/types.ts'

export const STRINGS: Record<Lang, Strings> = { et: ET, en: EN }

import type { Doc } from './document.ts'
import type { Intent } from './intent.ts'
import { normalise, spokenNumber } from './quickReply.ts'
import { STRINGS } from './strings.ts'
import type { Lang, Strings } from './strings.ts'

/**
 * Commands answered without the model: moving through the document, reading aloud,
 * deleting a paragraph by number. English and Estonian.
 *
 * Only a whole utterance can be a local command. Anything that merely starts like one
 * ("go to the budget and change the deadline") returns null and goes to the interpreter.
 * The result is the same Intent the interpreter would give, so edits still need yes.
 */

type Verb = 'go' | 'read' | 'delete' | 'bare'

const AND_READ = / (and read( it| this| that)?( aloud| out)?|ja loe( see| seda)?( ette)?)$/
const VERBS: Array<[Verb, RegExp]> = [
  ['read', /^(read( out| aloud)?|loe( ette)?)( |$)/],
  ['go', /^(go to|jump to|go|show|open|mine|näita|ava)( |$)/],
  ['delete', /^(delete|remove|kustuta)( |$)/],
]

const FOCUS = new Set(['it', 'this', 'that', 'this one', 'see', 'seda'])
const NEXT = new Set(['next', 'next paragraph', 'next one', 'down', 'järgmine', 'järgmine lõik'])
const PREVIOUS = new Set(['previous', 'previous paragraph', 'previous one', 'back', 'up', 'eelmine', 'eelmine lõik'])
const TOP = new Set(['top', 'beginning', 'start', 'algus', 'algusesse'])
const BOTTOM = new Set(['bottom', 'end', 'lõpp', 'lõppu'])
const PARAGRAPH_WORD = /^(paragraph|number|lõik|lõigu|lõiku|punkt|punkti) /
const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'ja'])

function isHeading(type: string): boolean {
  return type === 'h1' || type === 'h2'
}

function contentWords(text: string): string[] {
  return normalise(text)
    .split(' ')
    .filter((word) => word !== '' && !STOP_WORDS.has(word))
}

/** True when two words are the same up to an ending, so "kokkuvõtte" finds "kokkuvõte". */
function sameStem(a: string, b: string): boolean {
  const shorter = Math.min(a.length, b.length)
  let shared = 0
  while (shared < shorter && a[shared] === b[shared]) shared += 1
  return shared >= Math.max(3, shorter - 2)
}

/** The one heading named by these words, or null when none or several fit. */
function headingNamed(doc: Doc, spoken: string): string | null {
  const said = contentWords(spoken)
  if (said.length === 0) return null
  const matches = doc.filter((block) => {
    if (!isHeading(block.type)) return false
    const title = contentWords(block.text)
    return (
      title.length > 0 &&
      title.every((word) => said.some((s) => sameStem(word, s))) &&
      said.every((s) => title.some((word) => sameStem(word, s)))
    )
  })
  return matches.length === 1 ? (matches[0]?.id ?? null) : null
}

/** The text read aloud for a block: its own text, or the whole section when it is a heading. */
export function sectionText(doc: Doc, blockId: string): string {
  const at = doc.findIndex((block) => block.id === blockId)
  const block = doc[at]
  if (!block) return ''
  if (!isHeading(block.type)) return block.text
  const body: string[] = []
  for (let i = at + 1; i < doc.length; i += 1) {
    const next = doc[i]
    if (!next || isHeading(next.type)) break
    body.push(next.text)
  }
  return body.length === 0 ? block.text : `${block.text}. ${body.join(' ')}`
}

type Target = { blockId: string } | { problem: string } | null

function resolve(rest: string, verb: Verb, doc: Doc, focusId: string | null, t: Strings): Target {
  const last = doc.length - 1
  const focusAt = focusId === null ? -1 : doc.findIndex((b) => b.id === focusId)
  const at = (index: number): Target => {
    const block = doc[Math.min(Math.max(index, 0), last)]
    return block ? { blockId: block.id } : null
  }

  if (rest === '' || FOCUS.has(rest)) {
    if (verb === 'go' || verb === 'bare') return null
    if (focusAt < 0) return { problem: verb === 'read' ? t.sayWhichToRead : t.sayWhichToDelete }
    return at(focusAt)
  }

  if (verb === 'go' || verb === 'bare') {
    const plain = rest.replace(/^the /, '')
    if (NEXT.has(plain)) return at(focusAt < 0 ? 0 : focusAt + 1)
    if (PREVIOUS.has(plain)) return at(focusAt < 0 ? 0 : focusAt - 1)
    if (TOP.has(plain)) return at(0)
    if (BOTTOM.has(plain)) return at(last)
  }

  const named = PARAGRAPH_WORD.test(rest)
  const digits = rest.replace(/^the /, '').replace(PARAGRAPH_WORD, '').replace(/ juurde$/, '')
  const n = spokenNumber(digits)
  if (n !== null && (named || verb === 'go' || verb === 'read')) {
    const block = doc[n - 1]
    if (!block) return { problem: t.noParagraphOf(n, doc.length) }
    return { blockId: block.id }
  }

  if (verb === 'go' || verb === 'read') {
    const title = rest.replace(/ (section|juurde|osa)$/, '')
    const blockId = headingNamed(doc, title)
    if (blockId !== null) return { blockId }
  }
  return null
}

export function localIntent(text: string, doc: Doc, focusId: string | null, lang: Lang = 'en'): Intent | null {
  const t = STRINGS[lang]
  let rest = normalise(text)
  if (rest === '' || doc.length === 0) return null

  let readAloud = false
  if (AND_READ.test(rest)) {
    readAloud = true
    rest = rest.replace(AND_READ, '')
  }

  let verb: Verb = 'bare'
  for (const [name, pattern] of VERBS) {
    if (pattern.test(rest)) {
      verb = name
      rest = rest.replace(pattern, '')
      break
    }
  }
  if (verb === 'read') {
    readAloud = true
    rest = rest.replace(/ ?(aloud|out|ette)$/, '')
  }
  // "and read it" only makes sense after going somewhere.
  if (readAloud && verb !== 'go' && verb !== 'read') return null
  rest = rest.trim()

  const target = resolve(rest, verb, doc, focusId, t)
  if (target === null) return null
  if ('problem' in target) return { kind: 'not_understood', message: target.problem }

  if (verb === 'delete') {
    const number = doc.findIndex((b) => b.id === target.blockId) + 1
    return {
      kind: 'propose_edit',
      summary: t.paragraphDeleted(number),
      ops: [{ op: 'delete_block', blockId: target.blockId }],
    }
  }
  return { kind: 'navigate', blockId: target.blockId, readAloud }
}

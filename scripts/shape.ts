/**
 * The shape gate (round 13): every function in product code measured for length, branches and
 * nesting with the TypeScript compiler. A function over 150 lines or 40 branches fails the gate
 * unless `scripts/shape.allow.json` names it ("file#function": "why, lane that removes it"); each
 * lane that splits one deletes its entry. The same limits are oxlint's `max-lines-per-function`
 * and `complexity`, so a listed function carries one `oxlint-disable-next-line` comment.
 *
 * Lines are counted as oxlint counts them (skipBlankLines, skipComments). Branches are if,
 * else-if, the ternary, case, &&, ||, ??, their assignments, ?., catch and every loop, inside the
 * function itself (a nested function counts for itself). Complexity is branches + 1.
 * Casts: oxlint has no `no-restricted-syntax`, so the `as` casts are counted here per file instead.
 *
 * `npx tsx scripts/shape.ts` (exit 1 on an unlisted offender); `--all` prints every function.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const MAX_LINES = 150
const MAX_COMPLEXITY = 40

const root = resolve(import.meta.dirname, '..')
const ROOTS = ['src', 'extension/src', 'server']

type Shape = { file: string; name: string; line: number; lines: number; branches: number; nesting: number }

function productFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (path === 'extension/test' || path === 'extension/dist' || path === 'scripts') continue
      out.push(...productFiles(path))
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(path)
    }
  }
  return out
}

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.ConstructorDeclaration

function isFunction(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  )
}

function propertyName(name: ts.PropertyName | ts.BindingName, sf: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return name.getText(sf)
}

/** A stable name: its own, its variable's or property's, or "<enclosing>><callee> callback". */
function nameOf(node: FunctionNode, sf: ts.SourceFile, enclosing: string | null): string {
  const own = (n: string): string => (enclosing === null ? n : `${enclosing}>${n}`)
  if (ts.isConstructorDeclaration(node)) return own('constructor')
  if (!ts.isArrowFunction(node) && node.name !== undefined) return own(propertyName(node.name, sf))
  const parent = node.parent
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
    return own(propertyName(parent.name, sf))
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression !== node) {
    const callee = parent.expression.getText(sf)
    return own(`${/^[\w$.]{1,40}$/.test(callee) ? callee : '<call>'} callback`)
  }
  return own(`<anonymous@${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}>`)
}

/** Lines that hold a token other than a comment, between the function's first and last line. */
function codeLines(node: ts.Node, sf: ts.SourceFile): number {
  const start = node.getStart(sf)
  const end = node.getEnd()
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, sf.languageVariant, sf.text, undefined, start, end - start)
  const lines = new Set<number>()
  let kind = scanner.scan()
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    const trivia =
      kind === ts.SyntaxKind.WhitespaceTrivia ||
      kind === ts.SyntaxKind.NewLineTrivia ||
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    if (!trivia) {
      const first = sf.getLineAndCharacterOfPosition(scanner.getTokenStart()).line
      const last = sf.getLineAndCharacterOfPosition(scanner.getTokenEnd()).line
      for (let line = first; line <= last; line++) lines.add(line)
    }
    // A template's middle and tail are scanned as such only when asked; a slash may start a regex.
    if (kind === ts.SyntaxKind.CloseBraceToken && isTemplateContinuation(scanner, sf)) kind = scanner.reScanTemplateToken(false)
    else if (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) kind = rescanRegex(scanner, sf)
    if (kind === ts.SyntaxKind.EndOfFileToken) break
    kind = scanner.scan()
  }
  return lines.size
}

/** True when the AST has a template span ending at the scanner's close brace. */
function isTemplateContinuation(scanner: ts.Scanner, sf: ts.SourceFile): boolean {
  return templateBraces(sf).has(scanner.getTokenStart())
}

function rescanRegex(scanner: ts.Scanner, sf: ts.SourceFile): ts.SyntaxKind {
  return regexStarts(sf).has(scanner.getTokenStart()) ? scanner.reScanSlashToken() : scanner.getToken()
}

const braceCache = new WeakMap<ts.SourceFile, Set<number>>()
const regexCache = new WeakMap<ts.SourceFile, Set<number>>()

function templateBraces(sf: ts.SourceFile): Set<number> {
  const cached = braceCache.get(sf)
  if (cached !== undefined) return cached
  const set = new Set<number>()
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateSpan(node)) set.add(node.literal.getStart(sf))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  braceCache.set(sf, set)
  return set
}

function regexStarts(sf: ts.SourceFile): Set<number> {
  const cached = regexCache.get(sf)
  if (cached !== undefined) return cached
  const set = new Set<number>()
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) set.add(node.getStart(sf))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  regexCache.set(sf, set)
  return set
}

const BRANCH_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
])

function isBranch(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node)) return BRANCH_OPERATORS.has(node.operatorToken.kind)
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) {
    return node.questionDotToken !== undefined
  }
  return (
    ts.isIfStatement(node) ||
    ts.isConditionalExpression(node) ||
    ts.isCaseClause(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  )
}

function isNesting(node: ts.Node): boolean {
  if (ts.isIfStatement(node)) return !ts.isIfStatement(node.parent) || node.parent.elseStatement !== node
  return (
    ts.isSwitchStatement(node) ||
    ts.isTryStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  )
}

/** Branches and the deepest nesting inside one function, not counting the functions within it. */
function measureBody(fn: FunctionNode): { branches: number; nesting: number } {
  let branches = 0
  let nesting = 0
  const visit = (node: ts.Node, depth: number): void => {
    if (node !== fn && isFunction(node)) return
    if (isBranch(node)) branches++
    const here = isNesting(node) ? depth + 1 : depth
    if (here > nesting) nesting = here
    ts.forEachChild(node, (child) => visit(child, here))
  }
  visit(fn, 0)
  return { branches, nesting }
}

function measureFile(file: string): { shapes: Shape[]; casts: number } {
  const text = readFileSync(join(root, file), 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const shapes: Shape[] = []
  let casts = 0
  const visit = (node: ts.Node, enclosing: string | null): void => {
    if (ts.isAsExpression(node) && !(ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === 'const')) casts++
    if (ts.isTypeAssertionExpression(node)) casts++
    let inner = enclosing
    if (isFunction(node)) {
      const name = nameOf(node, sf, enclosing)
      const { branches, nesting } = measureBody(node)
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
      shapes.push({ file, name, line, lines: codeLines(node, sf), branches, nesting })
      inner = name
    } else if (ts.isClassDeclaration(node) && node.name !== undefined) {
      inner = enclosing === null ? node.name.text : `${enclosing}>${node.name.text}`
    }
    ts.forEachChild(node, (child) => visit(child, inner))
  }
  visit(sf, null)
  return { shapes, casts }
}

function over(shape: Shape): boolean {
  return shape.lines > MAX_LINES || shape.branches + 1 > MAX_COMPLEXITY
}

function main(): void {
  const all = process.argv.includes('--all')
  const allowPath = join(root, 'scripts/shape.allow.json')
  const allow: Record<string, string> = JSON.parse(readFileSync(allowPath, 'utf8'))
  const files = ROOTS.flatMap(productFiles).sort()
  const shapes: Shape[] = []
  const casts: { file: string; count: number }[] = []
  for (const file of files) {
    const measured = measureFile(file)
    shapes.push(...measured.shapes)
    if (measured.casts > 0) casts.push({ file, count: measured.casts })
  }
  const offenders = shapes.filter(over).sort((a, b) => b.lines - a.lines)
  const shown = all ? [...shapes].sort((a, b) => b.lines - a.lines) : offenders
  const keyOf = (s: Shape): string => `${s.file}#${s.name}`
  const width = Math.max(40, ...shown.map((s) => keyOf(s).length))
  console.log(`shape: functions over ${MAX_LINES} lines or ${MAX_COMPLEXITY - 1} branches (complexity over ${MAX_COMPLEXITY})`)
  console.log(`${'file#function'.padEnd(width)}  line  lines  branches  nesting  status`)
  for (const s of shown) {
    const status = !over(s) ? '' : allow[keyOf(s)] !== undefined ? 'allowed' : 'NOT ALLOWED'
    console.log(
      `${keyOf(s).padEnd(width)}  ${String(s.line).padStart(4)}  ${String(s.lines).padStart(5)}  ${String(s.branches).padStart(8)}  ${String(s.nesting).padStart(7)}  ${status}`,
    )
  }
  const unlisted = offenders.filter((s) => allow[keyOf(s)] === undefined)
  const offenderKeys = new Set(offenders.map(keyOf))
  const stale = Object.keys(allow).filter((key) => !offenderKeys.has(key))
  const castTotal = casts.reduce((sum, c) => sum + c.count, 0)
  casts.sort((a, b) => b.count - a.count)
  console.log(`shape casts: ${castTotal} \`as\` casts in ${casts.length} files (${casts.map((c) => `${c.file} ${c.count}`).join(', ')})`)
  for (const key of stale) console.log(`shape: stale allowance ${key} (no longer over the limits: delete its entry and its oxlint-disable comment)`)
  for (const s of unlisted) console.log(`shape: NOT ALLOWED ${keyOf(s)} (${s.lines} lines, ${s.branches} branches): split it, or list it in scripts/shape.allow.json`)
  console.log(`shape: ${shapes.length} functions in ${files.length} files, ${offenders.length} over the limits, ${offenders.length - unlisted.length} allowed, ${unlisted.length} not allowed, ${stale.length} stale`)
  if (unlisted.length > 0 || stale.length > 0) process.exitCode = 1
}

main()

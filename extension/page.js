// Injected into the target tab (isolated world) by background.js. Defines globalThis.__utle
// once; background.js then calls __utle.run(command) and gets a BrowserResult back.
// See docs/ARCHITECTURE.md 20.2.

;(() => {
  if (globalThis.__utle) return

  /** openConversation keeps looking this long for the name (lists render after load). */
  const FIND_TIMEOUT_MS = 4000
  /** insertText keeps looking this long for a message box (composers render late). */
  const BOX_TIMEOUT_MS = 3000
  /** How often both searches look again. */
  const POLL_MS = 150

  const ok = (extra) => ({ ok: true, ...extra })
  const fail = (code, message) => ({ ok: false, code, message })
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  // ---------- visibility ----------

  function boxVisible(el) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return null
    if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) return null
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return null
    } else {
      const s = getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return null
    }
    return r
  }

  function hitTest(el, r) {
    const left = Math.max(r.left, 0)
    const right = Math.min(r.right, window.innerWidth)
    const top = Math.max(r.top, 0)
    const bottom = Math.min(r.bottom, window.innerHeight)
    const points = [
      [(left + right) / 2, (top + bottom) / 2],
      [left + 2, top + 2],
      [right - 2, top + 2],
      [left + 2, bottom - 2],
      [right - 2, bottom - 2],
    ]
    for (const [x, y] of points) {
      const hit = document.elementFromPoint(x, y)
      if (hit && (hit === el || el.contains(hit))) return true
    }
    return false
  }

  function visible(el) {
    const r = boxVisible(el)
    return r !== null && hitTest(el, r)
  }

  // ---------- numbered labels ----------

  const ACTIONABLE = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="checkbox"]',
    '[role="textbox"]',
    '[onclick]',
  ].join(', ')

  let hintLayer = null
  let hinted = []

  function sameBox(a, b) {
    return Math.abs(a.left - b.left) < 4 && Math.abs(a.top - b.top) < 4 && Math.abs(a.width - b.width) < 8 && Math.abs(a.height - b.height) < 8
  }

  function collectActionable() {
    const found = []
    for (const el of document.querySelectorAll(ACTIONABLE)) {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue
      if (!visible(el)) continue
      found.push(el)
    }
    // A nested element with nearly the same box as an actionable ancestor is the same target.
    return found.filter((el) => {
      const box = el.getBoundingClientRect()
      for (const other of found) {
        if (other !== el && other.contains(el) && sameBox(other.getBoundingClientRect(), box)) return false
      }
      return true
    })
  }

  function hideHints() {
    if (hintLayer) hintLayer.remove()
    hintLayer = null
    hinted = []
  }

  function showHints() {
    hideHints()
    const elements = collectActionable()
    const host = document.createElement('utle-hints')
    host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;'
    const root = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = `
      .n { position: absolute; font: bold 15px/1 system-ui, sans-serif; color: #000; background: #ffd400;
           border: 2px solid #000; border-radius: 4px; padding: 2px 5px; box-shadow: 0 1px 3px rgba(0,0,0,.5);
           white-space: nowrap; pointer-events: none; }`
    root.append(style)
    elements.forEach((_el, i) => {
      const label = document.createElement('span')
      label.className = 'n'
      label.textContent = String(i + 1)
      root.append(label)
    })
    document.documentElement.append(host)
    placeLabels(root, elements)
    hintLayer = host
    hinted = elements
    return ok({ hints: elements.length })
  }

  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  }

  // Each label goes outside its element so it never hides the element's text. Spots in order:
  // left, above, right, below. The first one that stays in the viewport and covers nothing wins;
  // if every spot covers something, the one covering least. Only when no outside spot fits in the
  // viewport does the label sit on the element's corner.
  function placeLabels(root, elements) {
    const rects = elements.map((el) => el.getBoundingClientRect())
    const taken = []
    const labels = root.querySelectorAll('.n')
    elements.forEach((_el, i) => {
      const label = labels[i]
      const r = rects[i]
      const w = label.offsetWidth
      const h = label.offsetHeight
      const gap = 2
      const spots = [
        [r.left - w - gap, r.top + Math.max((r.height - h) / 2, 0)],
        [r.left, r.top - h - gap],
        [r.right + gap, r.top + Math.max((r.height - h) / 2, 0)],
        [r.left, r.bottom + gap],
      ].map(([x, y]) => ({ left: x, top: y, right: x + w, bottom: y + h }))
      const area = (a, b) => (overlaps(a, b) ? (Math.min(a.right, b.right) - Math.max(a.left, b.left)) * (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0)
      // Cost of a spot: how much it covers other elements and labels. Never its own element.
      const cost = (b) => {
        if (b.left < 0 || b.top < 0 || b.right > window.innerWidth || b.bottom > window.innerHeight || overlaps(b, r)) return Infinity
        return rects.reduce((sum, o) => sum + area(b, o), 0) + taken.reduce((sum, o) => sum + area(b, o) * 4, 0)
      }
      const costs = spots.map(cost)
      const best = costs.indexOf(Math.min(...costs))
      const spot = costs[best] < Infinity ? spots[best] : { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.max(r.left, 0) + w, bottom: Math.max(r.top, 0) + h }
      taken.push(spot)
      label.style.left = `${spot.left + window.scrollX}px`
      label.style.top = `${spot.top + window.scrollY}px`
    })
  }

  // Same-document navigations do not unload the page, so remove the labels ourselves.
  if (globalThis.navigation && typeof globalThis.navigation.addEventListener === 'function') {
    globalThis.navigation.addEventListener('navigate', hideHints)
  }
  window.addEventListener('popstate', hideHints)
  window.addEventListener('hashchange', hideHints)
  window.addEventListener('pagehide', hideHints)

  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', ''])

  function isTextField(el) {
    if (!el) return false
    if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled
    if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.has((el.getAttribute('type') || '').toLowerCase()) && !el.readOnly && !el.disabled
    return el.isContentEditable === true
  }

  function caretToEnd(el) {
    el.focus()
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      try {
        const end = el.value.length
        el.setSelectionRange(end, end)
      } catch {
        // number and email inputs have no selection range
      }
      return
    }
    const selection = window.getSelection()
    if (!selection) return
    if (selection.rangeCount > 0 && el.contains(selection.anchorNode)) return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function activate(el) {
    const r = el.getBoundingClientRect()
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
    el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse', isPrimary: true }))
    el.dispatchEvent(new MouseEvent('mousedown', init))
    el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse', isPrimary: true }))
    el.dispatchEvent(new MouseEvent('mouseup', init))
    el.click()
  }

  function clickHint(number) {
    const el = hinted[number - 1]
    if (!el) {
      return fail('not_found', hinted.length === 0 ? 'No numbers are showing. Say "numbers" first.' : `There is no number ${number}. The numbers go up to ${hinted.length}.`)
    }
    hideHints()
    if (!el.isConnected) return fail('not_found', `Number ${number} is no longer on the page.`)
    if (isTextField(el)) caretToEnd(el)
    else activate(el)
    return ok()
  }

  // ---------- scroll ----------

  function scrollTarget() {
    let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    while (el && el !== document.body && el !== document.documentElement) {
      const s = getComputedStyle(el)
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el
      el = el.parentElement
    }
    return document.scrollingElement || document.documentElement
  }

  function scroll(direction) {
    const el = scrollTarget()
    const page = Math.round(el.clientHeight * 0.8) || Math.round(window.innerHeight * 0.8)
    if (direction === 'down') el.scrollBy({ top: page, behavior: 'instant' })
    else if (direction === 'up') el.scrollBy({ top: -page, behavior: 'instant' })
    else if (direction === 'top') el.scrollTo({ top: 0, behavior: 'instant' })
    else if (direction === 'bottom') el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
    else return fail('failed', `Unknown scroll direction "${direction}".`)
    return ok()
  }

  // ---------- insert text ----------

  function sites() {
    return globalThis.__utleSites || {}
  }

  function lowestVisible(selector) {
    let best = null
    let bestBottom = -Infinity
    for (const el of document.querySelectorAll(selector)) {
      if (!isTextField(el) || !visible(el)) continue
      const bottom = el.getBoundingClientRect().bottom
      if (bottom > bestBottom) {
        best = el
        bestBottom = bottom
      }
    }
    return best
  }

  function messageBox(onMessaging) {
    let active = document.activeElement
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement
    if (isTextField(active)) return active
    const messenger = sites().messenger
    if (messenger && onMessaging) {
      const composer = lowestVisible(messenger.composer)
      if (composer) return composer
    }
    return (
      lowestVisible('[contenteditable="true"][role="textbox"], [contenteditable=""][role="textbox"], [contenteditable="plaintext-only"][role="textbox"]') ||
      lowestVisible('textarea') ||
      lowestVisible('input')
    )
  }

  function currentText(el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.value
    return el.innerText || ''
  }

  function insertInto(el, text) {
    caretToEnd(el)
    const before = currentText(el)
    let done = false
    try {
      done = document.execCommand('insertText', false, text)
    } catch {
      done = false
    }
    if (done && currentText(el) !== before) return
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(el, el.value + text)
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
      return
    }
    // Rich editors (Lexical, Draft, ProseMirror) handle beforeinput themselves.
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: text })
    if (el.dispatchEvent(event)) {
      // Nobody handled it: insert at the caret and tell the page.
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0)
        range.deleteContents()
        range.insertNode(document.createTextNode(text))
        range.collapse(false)
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    }
  }

  function pressEnter(el) {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 0, bubbles: true, cancelable: true, composed: true }
    el.dispatchEvent(new KeyboardEvent('keydown', init))
    el.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: 13 }))
    el.dispatchEvent(new KeyboardEvent('keyup', init))
  }

  async function waitFor(find, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = find()
      if (found || Date.now() >= deadline) return found
      await sleep(POLL_MS)
    }
  }

  async function insertText(text, submit, onMessaging) {
    const el = await waitFor(() => messageBox(onMessaging), BOX_TIMEOUT_MS)
    if (!el) return fail('not_found', 'There is no message box on this page.')
    insertInto(el, text)
    // Let the page's editor commit its state before Enter.
    await sleep(60)
    if (!submit) return ok()
    const target = el.isConnected ? el : messageBox(onMessaging) || el
    pressEnter(target)
    await sleep(400)
    if (!target.isConnected || !currentText(target).includes(text)) return ok()
    // Enter did not send. Try the site's send button, then the form.
    const messenger = sites().messenger
    const button = messenger && onMessaging ? document.querySelector(messenger.sendButton) : null
    if (button) {
      activate(button)
      return ok()
    }
    if (target.form) {
      target.form.requestSubmit()
      return ok()
    }
    return fail('failed', 'The text is in the box, but pressing Enter did not send it.')
  }

  // ---------- open a conversation ----------

  function normalize(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  }

  function score(query, name) {
    if (!query || !name) return 0
    if (name === query) return 100
    const words = name.split(' ')
    const spoken = query.split(' ')
    if (spoken.every((w) => words.includes(w))) return 80
    if (spoken.every((w) => words.some((x) => x.startsWith(w)))) return 60
    if (name.includes(query)) return 40
    // Estonian case endings change the stem (Jaanile -> jaani, Märdile -> mardi, Peetrile ->
    // peetri): a spoken word matches a name word sharing a prefix of at least 3 letters that is
    // at least all but the last two letters of the shorter word.
    if (spoken.every((w) => words.some((x) => stemMatch(w, x)))) return 20
    return 0
  }

  function stemMatch(a, b) {
    const shorter = Math.min(a.length, b.length)
    let p = 0
    while (p < shorter && a[p] === b[p]) p++
    return p >= 3 && p >= shorter - 2
  }

  function nameOf(el) {
    const label = el.getAttribute('aria-label')
    if (label && label.trim()) return label
    const text = (el.innerText || el.textContent || '').trim()
    return text.split('\n')[0]
  }

  const GENERIC_CANDIDATES = 'a[href], [role="link"], li, [role="listitem"], [role="row"], [role="option"]'

  /** One pass: the best visible match, and whether a conversation list is on screen at all. */
  function findConversation(query, onMessaging) {
    const messenger = sites().messenger
    const selectors = onMessaging && messenger ? [messenger.conversationLinks, GENERIC_CANDIDATES] : [GENERIC_CANDIDATES]
    let listSeen = false
    for (const [i, selector] of selectors.entries()) {
      let best = null
      let bestScore = 0
      let bestLength = Infinity
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue
        if (i === 0 && onMessaging) listSeen = true
        const candidate = normalize(nameOf(el))
        const s = score(query, candidate)
        if (s > bestScore || (s === bestScore && s > 0 && candidate.length < bestLength)) {
          best = el
          bestScore = s
          bestLength = candidate.length
        }
      }
      if (best) return { best, listSeen }
    }
    return { best: null, listSeen }
  }

  async function openConversation(name, onMessaging) {
    const query = normalize(name)
    if (!query) return fail('not_found', 'No name was given.')
    let last = { best: null, listSeen: false }
    const best = await waitFor(() => {
      last = findConversation(query, onMessaging)
      return last.best
    }, FIND_TIMEOUT_MS)
    if (!best) {
      if (onMessaging && !last.listSeen) return fail('not_found', 'There is no conversation list on this page. The site may need logging in.')
      return fail('not_found', `No conversation called "${name}" is visible here.`)
    }
    // A list item is not clickable itself; click the link inside it when there is one.
    const clickable = best.matches('a[href], [role="link"], [role="button"]') ? best : best.querySelector('a[href], [role="link"], [role="button"]') || best
    const href = clickable.href || ''
    activate(clickable)
    // background.js waits for the address to change and strips href before answering the page.
    return ok({ href: typeof href === 'string' ? href : '' })
  }

  // ---------- entry ----------

  async function run(command) {
    try {
      switch (command.kind) {
        case 'scroll':
          return scroll(command.direction)
        case 'showHints':
          return showHints()
        case 'hideHints':
          hideHints()
          return ok()
        case 'clickHint':
          return clickHint(command.number)
        case 'insertText':
          return await insertText(String(command.text), command.submit === true, command.onMessaging === true)
        case 'openConversation':
          return await openConversation(command.name, command.onMessaging === true)
        default:
          return fail('failed', `The page does not know the command "${command.kind}".`)
      }
    } catch (error) {
      return fail('failed', `Something went wrong on the page: ${String(error && error.message ? error.message : error)}`)
    }
  }

  globalThis.__utle = { run }
})()

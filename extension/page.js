// Injected into the target tab (isolated world) by background.js. Defines globalThis.__utle
// once; background.js then calls __utle.run(command) and gets a BrowserResult back.
// See docs/ARCHITECTURE.md 20.2.

;(() => {
  if (globalThis.__utle) return

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
    elements.forEach((el, i) => {
      const r = el.getBoundingClientRect()
      const label = document.createElement('span')
      label.className = 'n'
      label.textContent = String(i + 1)
      label.style.left = `${Math.max(r.left + window.scrollX - 4, window.scrollX)}px`
      label.style.top = `${Math.max(r.top + window.scrollY - 4, window.scrollY)}px`
      root.append(label)
    })
    document.documentElement.append(host)
    hintLayer = host
    hinted = elements
    return ok({ hints: elements.length })
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

  function messageBox() {
    let active = document.activeElement
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement
    if (isTextField(active)) return active
    const messenger = sites().messenger
    if (messenger && messenger.isHere(window.location)) {
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

  async function insertText(text, submit) {
    const el = messageBox()
    if (!el) return fail('not_found', 'There is no message box on this page.')
    insertInto(el, text)
    // Let the page's editor commit its state before Enter.
    await sleep(60)
    if (!submit) return ok()
    const target = el.isConnected ? el : messageBox() || el
    pressEnter(target)
    await sleep(400)
    if (!target.isConnected || !currentText(target).includes(text)) return ok()
    // Enter did not send. Try the site's send button, then the form.
    const messenger = sites().messenger
    const button = messenger && messenger.isHere(window.location) ? document.querySelector(messenger.sendButton) : null
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
    return 0
  }

  function nameOf(el) {
    const label = el.getAttribute('aria-label')
    if (label && label.trim()) return label
    const text = (el.innerText || el.textContent || '').trim()
    return text.split('\n')[0]
  }

  async function openConversation(name) {
    const query = normalize(name)
    if (!query) return fail('not_found', 'No name was given.')
    const messenger = sites().messenger
    const onMessenger = messenger && messenger.isHere(window.location)
    const selector = onMessenger ? messenger.conversationLinks : 'a[href], [role="link"], li, [role="listitem"], [role="row"], [role="option"]'
    let best = null
    let bestScore = 0
    let bestLength = Infinity
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el)) continue
      const candidate = normalize(nameOf(el))
      const s = score(query, candidate)
      if (s > bestScore || (s === bestScore && s > 0 && candidate.length < bestLength)) {
        best = el
        bestScore = s
        bestLength = candidate.length
      }
    }
    if (!best) return fail('not_found', `No conversation called "${name}" is visible here.`)
    // A list item is not clickable itself; click the link inside it when there is one.
    const clickable = best.matches('a[href], [role="link"], [role="button"]') ? best : best.querySelector('a[href], [role="link"], [role="button"]') || best
    activate(clickable)
    return ok()
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
          return await insertText(String(command.text), command.submit === true)
        case 'openConversation':
          return await openConversation(command.name)
        default:
          return fail('failed', `The page does not know the command "${command.kind}".`)
      }
    } catch (error) {
      return fail('failed', `Something went wrong on the page: ${String(error && error.message ? error.message : error)}`)
    }
  }

  globalThis.__utle = { run }
})()

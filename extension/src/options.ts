// The options page: the address of the section 20 harness page and of the speech model.
const DEFAULTS = { utleUrl: 'http://localhost:5173', asrUrl: 'ws://localhost:5173/api/asr' } as const
type Key = keyof typeof DEFAULTS

const status = document.getElementById('status')

for (const key of Object.keys(DEFAULTS) as Key[]) {
  const input = document.getElementById(key)
  if (!(input instanceof HTMLInputElement)) continue
  void chrome.storage.local.get(key).then((stored) => {
    const value = stored[key]
    input.value = typeof value === 'string' ? value : ''
  })
}

document.getElementById('save')?.addEventListener('click', async () => {
  for (const key of Object.keys(DEFAULTS) as Key[]) {
    const input = document.getElementById(key)
    if (!(input instanceof HTMLInputElement)) continue
    const value = input.value.trim()
    if (value === '') {
      await chrome.storage.local.remove(key)
      continue
    }
    try {
      new URL(value)
    } catch {
      if (status) status.textContent = `Not a full address: ${value}`
      return
    }
    await chrome.storage.local.set({ [key]: value })
  }
  if (status) status.textContent = 'Saved. Reload the extension for a new speech address to take effect.'
})

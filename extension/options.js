const input = document.getElementById('url')
const status = document.getElementById('status')

chrome.storage.local.get('utleUrl').then(({ utleUrl }) => {
  input.value = typeof utleUrl === 'string' ? utleUrl : ''
})

document.getElementById('save').addEventListener('click', async () => {
  const value = input.value.trim()
  if (value === '') {
    await chrome.storage.local.remove('utleUrl')
    status.textContent = 'Saved. Using http://localhost:5173.'
    return
  }
  try {
    new URL(value)
  } catch {
    status.textContent = 'That is not a full address. Include http://'
    return
  }
  await chrome.storage.local.set({ utleUrl: value })
  status.textContent = `Saved. Ütle is at ${value}.`
})

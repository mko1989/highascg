'use strict'

module.exports = function initRendererGuides() {
  document.querySelectorAll('.cmd-copy').forEach((block) => {
    const pre = block.querySelector('.cmd-copy-pre')
    const btn = block.querySelector('.cmd-copy-btn')
    if (!pre || !btn || btn.dataset.bound === '1') return
    btn.dataset.bound = '1'
    const text = pre.textContent.trim()
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text)
        btn.textContent = 'Copied'
        btn.classList.add('copied')
        setTimeout(() => {
          btn.textContent = 'Copy'
          btn.classList.remove('copied')
        }, 2000)
      } catch (err) {
        btn.textContent = 'Failed'
        console.error('Copy failed:', err)
        setTimeout(() => {
          btn.textContent = 'Copy'
        }, 2000)
      }
    })
  })
}

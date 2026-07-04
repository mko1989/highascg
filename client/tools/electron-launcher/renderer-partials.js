'use strict'

const fs = require('fs')
const path = require('path')

function injectLauncherPartials() {
  document.querySelectorAll('[data-partial]').forEach((el) => {
    const rel = el.getAttribute('data-partial')
    if (!rel) return
    const file = path.join(__dirname, rel)
    el.innerHTML = fs.readFileSync(file, 'utf8')
  })
}

module.exports = { injectLauncherPartials }

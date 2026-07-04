'use strict'

const path = require('path')
const fs = require('fs')

function loadWebuiPort() {
  const candidates = [
    path.join(__dirname, 'lib/webui-port.cjs'),
    path.join(__dirname, '../../lib/webui-port.cjs'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return require(c).WEBUI_PORT
    }
  }
  return 4350
}

module.exports = { loadWebuiPort }

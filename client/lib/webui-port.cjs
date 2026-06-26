const fs = require('node:fs')
const path = require('node:path')

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'webui-port.json'), 'utf8'))
const WEBUI_PORT = Number(cfg.port) || 4350

module.exports = { WEBUI_PORT }

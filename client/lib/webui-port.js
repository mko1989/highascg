import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'webui-port.json'), 'utf8'))
export const WEBUI_PORT = Number(cfg.port) || 4350

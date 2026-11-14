'use strict'

/**
 * WO-1076 — the enabled flag of every external module: `{ "<name>": { "enabled": true } }` in modules.json
 * (module-paths.js: ~/.highascg/modules.json; a temp file under the test runner). A missing entry falls back to the
 * manifest's `defaultEnabled` (false unless the module says otherwise: modules are opt-in). Written atomically
 * (tmp + rename); an unreadable / corrupt file reads as "no entries" and is replaced on the next write.
 */

const fs = require('fs')
const path = require('path')
const { modulesStateFile } = require('./module-paths')
const { isValidModuleName } = require('./module-manifest')

/** @returns {Record<string, { enabled: boolean }>} */
function readModulesState() {
	try {
		const raw = JSON.parse(fs.readFileSync(modulesStateFile(), 'utf8'))
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
		/** @type {Record<string, { enabled: boolean }>} */
		const out = {}
		for (const [name, v] of Object.entries(raw)) {
			if (isValidModuleName(name) && v && typeof v === 'object' && typeof v.enabled === 'boolean') out[name] = { enabled: v.enabled }
		}
		return out
	} catch {
		return {}
	}
}

/**
 * @param {string} name
 * @param {boolean} enabled
 */
function setModuleEnabled(name, enabled) {
	if (!isValidModuleName(name)) throw new Error('invalid module name')
	const file = modulesStateFile()
	const next = { ...readModulesState(), [name]: { enabled: enabled === true } }
	fs.mkdirSync(path.dirname(file), { recursive: true })
	const tmp = `${file}.tmp-${process.pid}`
	fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o644 })
	fs.renameSync(tmp, file)
	return next
}

/** @param {string} name — drop the entry (uninstall) */
function forgetModule(name) {
	const cur = readModulesState()
	if (!(name in cur)) return
	delete cur[name]
	const file = modulesStateFile()
	const tmp = `${file}.tmp-${process.pid}`
	fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n', { mode: 0o644 })
	fs.renameSync(tmp, file)
}

module.exports = { readModulesState, setModuleEnabled, forgetModule }

'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'tailscale.json')

const DEFAULTS = {
	enabled: true,
	autoLoginOnBoot: false,
	hostname: '',
	acceptRoutes: false,
	operatorLoginAssist: true,
}

/**
 * @param {unknown} raw
 * @returns {typeof DEFAULTS}
 */
function normalizeTailscaleConfig(raw) {
	const src = raw && typeof raw === 'object' ? raw : {}
	return {
		enabled: src.enabled !== false,
		autoLoginOnBoot: src.autoLoginOnBoot === true,
		hostname: String(src.hostname || '').trim(),
		acceptRoutes: src.acceptRoutes === true,
		operatorLoginAssist: src.operatorLoginAssist !== false,
	}
}

/**
 * @returns {typeof DEFAULTS}
 */
function loadTailscaleConfig() {
	try {
		if (fs.existsSync(CONFIG_PATH)) {
			return normalizeTailscaleConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')))
		}
	} catch {
		/* fall through */
	}
	return { ...DEFAULTS }
}

/**
 * @param {Partial<typeof DEFAULTS>} patch
 * @returns {typeof DEFAULTS}
 */
function saveTailscaleConfig(patch) {
	const next = normalizeTailscaleConfig({ ...loadTailscaleConfig(), ...patch })
	fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
	fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
	return next
}

module.exports = {
	CONFIG_PATH,
	DEFAULTS,
	normalizeTailscaleConfig,
	loadTailscaleConfig,
	saveTailscaleConfig,
}

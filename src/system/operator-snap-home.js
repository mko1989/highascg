/**
 * Snap Firefox needs a writable ~/snap. Some images create /home/casparcg/snap as root.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

/** @readonly */
const HELPER_PATHS = [
	'/usr/local/lib/highascg/highascg-operator-snap-home.sh',
	path.join(__dirname, '../../tools/runtime/highascg-operator-snap-home.sh'),
]

/**
 * @returns {string}
 */
function operatorHomeDir() {
	return process.env.HOME || '/home/casparcg'
}

/**
 * @param {string} [home]
 */
function isSnapHomeWritable(home = operatorHomeDir()) {
	const snapDir = path.join(home, 'snap')
	if (!fs.existsSync(snapDir)) return true
	try {
		fs.accessSync(snapDir, fs.constants.W_OK)
		return true
	} catch {
		return false
	}
}

/**
 * @param {{ log?: Function, home?: string }} [opts]
 */
function ensureOperatorSnapHome(opts = {}) {
	const home = opts.home || operatorHomeDir()
	if (isSnapHomeWritable(home)) return { ok: true }

	for (const helper of HELPER_PATHS) {
		if (!fs.existsSync(helper)) continue
		try {
			execFileSync('sudo', ['-n', helper, home], { timeout: 8000, stdio: 'ignore' })
			if (isSnapHomeWritable(home)) {
				opts.log?.('info', `[Firefox] Fixed snap home via ${helper}`)
				return { ok: true }
			}
		} catch (e) {
			opts.log?.('warn', `[Firefox] snap home fix failed (${helper}): ${e?.message || e}`)
		}
	}

	const snapDir = path.join(home, 'snap')
	const user = path.basename(home)
	return {
		ok: false,
		error:
			`Snap Firefox cannot write to ${snapDir} (wrong owner). ` +
			`Run on the playout box: sudo chown -R ${user}:${user} ${snapDir}`,
	}
}

module.exports = {
	ensureOperatorSnapHome,
	isSnapHomeWritable,
}

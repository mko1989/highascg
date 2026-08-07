'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { getXAuthority } = require('./hardware-info')

function displaySessionEnv() {
	return {
		...process.env,
		DISPLAY: ':0',
		XAUTHORITY: getXAuthority(),
	}
}

/*
 * lookupCommandPath / FALLBACK_PATH moved to ./which.js (shared home; full WO-283 root-cause
 * story lives there): resolving on PATH with fs instead of shelling out to /usr/bin/command,
 * which is a shell builtin and does not exist as a file.
 */
const { lookupCommandPath, FALLBACK_PATH } = require('./which')

/** @param {string} bin @returns {Promise<boolean>} */
async function commandExists(bin) {
	return lookupCommandPath(bin) !== null
}

/**
 * @returns {string|null}
 */
function resolveConfineCursorScript() {
	const candidates = [
		path.join(REPO_ROOT, 'tools/runtime/confine-cursor.py'),
		'/usr/local/bin/confine-cursor.py',
	]
	for (const p of candidates) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * XFixes pointer barriers — confines cursor without XGrabPointer (Caspar-safe).
 * @returns {string|null}
 */
function resolveConfineBarriersScript() {
	const candidates = [
		path.join(REPO_ROOT, 'tools/runtime/confine-pointer-barriers.py'),
		'/usr/local/bin/confine-pointer-barriers.py',
	]
	for (const p of candidates) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/** @returns {Promise<string|null>} */
async function resolveXdotoolBin(_env) {
	const candidates = ['/usr/bin/xdotool', '/usr/local/bin/xdotool']
	for (const p of candidates) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	if (await commandExists('xdotool')) return 'xdotool'
	return null
}

module.exports = {
	displaySessionEnv,
	FALLBACK_PATH,
	lookupCommandPath,
	commandExists,
	resolveConfineCursorScript,
	resolveConfineBarriersScript,
	resolveXdotoolBin,
}

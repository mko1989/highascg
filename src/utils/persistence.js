/**
 * Local disk-backed persistence for HighAsCG runtime state.
 * Writes are debounced (see HIGHASCG_PERSISTENCE_FLUSH_MS); call flushSync() on shutdown
 * or when another process must read the file immediately.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

const STATE_FILE = path.join(REPO_ROOT, '.highascg-state.json')
const STATE_FILE_TMP = STATE_FILE + '.tmp'
let _cache = null

const PRETTY =
	process.env.HIGHASCG_PERSISTENCE_PRETTY === undefined || process.env.HIGHASCG_PERSISTENCE_PRETTY === ''
		? true
		: !/^0|false$/i.test(String(process.env.HIGHASCG_PERSISTENCE_PRETTY))

const FLUSH_DEBOUNCE_MS = Math.max(
	0,
	Math.min(60_000, parseInt(process.env.HIGHASCG_PERSISTENCE_FLUSH_MS || '200', 10) || 200),
)

/** @type {ReturnType<typeof setTimeout> | null} */
let _saveTimer = null

function _load() {
	if (_cache !== null) return _cache
	try {
		const raw = fs.readFileSync(STATE_FILE, 'utf8')
		_cache = JSON.parse(raw) || {}
	} catch {
		_cache = {}
	}
	return _cache
}

function _writeToDisk() {
	if (_cache === null) return
	try {
		const json = PRETTY ? JSON.stringify(_cache, null, 2) : JSON.stringify(_cache)
		fs.writeFileSync(STATE_FILE_TMP, json, 'utf8')
		fs.renameSync(STATE_FILE_TMP, STATE_FILE)
	} catch (e) {
		console.warn('[persistence] Failed to save state:', e.message)
	}
}

function _scheduleSave() {
	if (FLUSH_DEBOUNCE_MS <= 0) {
		_writeToDisk()
		return
	}
	if (_saveTimer) clearTimeout(_saveTimer)
	_saveTimer = setTimeout(() => {
		_saveTimer = null
		_writeToDisk()
	}, FLUSH_DEBOUNCE_MS)
}

/**
 * Wait until any pending debounced write completes (queued immediately).
 * @returns {Promise<void>}
 */
function flush() {
	return new Promise((resolve) => {
		if (_saveTimer) {
			clearTimeout(_saveTimer)
			_saveTimer = null
		}
		try {
			_writeToDisk()
		} finally {
			resolve()
		}
	})
}

/** Same as flush but synchronous — use from signal handlers / process exit paths. */
function flushSync() {
	if (_saveTimer) {
		clearTimeout(_saveTimer)
		_saveTimer = null
	}
	_writeToDisk()
}

async function hydrateFromAmcp() { return _load() }
function bindAmcp() {}

function get(key) {
	const state = _load()
	return state[key] !== undefined ? state[key] : null
}

function set(key, value) {
	_load()
	if (value == null) {
		delete _cache[key]
	} else {
		_cache[key] = value
	}
	_scheduleSave()
}

function remove(key) {
	set(key, null)
}

function getAll() {
	return { ..._load() }
}

module.exports = {
	get,
	set,
	remove,
	getAll,
	bindAmcp,
	hydrateFromAmcp,
	flush,
	flushSync,
}

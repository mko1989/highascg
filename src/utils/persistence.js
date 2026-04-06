/**
 * File-based persistence for HighAsCG runtime state (replaces companion .module-state.json).
 * @see companion-module-casparcg-server/src/persistence.js
 */

'use strict'

const fs = require('fs')
const path = require('path')

const STATE_FILE = path.join(__dirname, '..', '..', '.highascg-state.json')
const STATE_FILE_TMP = STATE_FILE + '.tmp'

let _cache = null

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

function _save() {
	try {
		const json = JSON.stringify(_cache, null, 2)
		fs.writeFileSync(STATE_FILE_TMP, json, 'utf8')
		fs.renameSync(STATE_FILE_TMP, STATE_FILE)
	} catch (e) {
		console.warn('[persistence] Failed to save state:', e.message)
	}
}

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
	_save()
}

function remove(key) {
	set(key, null)
}

function getAll() {
	return { ..._load() }
}

module.exports = { get, set, remove, getAll }

'use strict'

/**
 * WO-731 — the audio operator's desk settings: which desk, its address, the fader floor on accept and which desk
 * input each mic number is on. Kept in ~/.highascg/audio-desk.json (outside the repo, so Syncthing never fights it;
 * auto-store.js pattern). HIGHASCG_AUDIO_DESK_FILE overrides the path; under the Node test runner the default is a
 * private temp dir per process.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { underTestRunner } = require('../engine/projects-root')
const { MODELS } = require('./desk-models')

const THRESHOLD_DB = { dflt: 0, min: -60, max: 10 }
const MIC_RE = /^[A-Za-z0-9 ._#-]{1,16}$/
const HOST_RE = /^[A-Za-z0-9.:-]{1,253}$/

let _testDir = null

function deskFile() {
	if (process.env.HIGHASCG_AUDIO_DESK_FILE) return path.resolve(process.env.HIGHASCG_AUDIO_DESK_FILE)
	if (underTestRunner()) {
		if (!_testDir) _testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-test-audio-desk-'))
		return path.join(_testDir, 'audio-desk.json')
	}
	return path.join(os.homedir(), '.highascg', 'audio-desk.json')
}

/** Settings shape, every field valid: { model, host, port, midi_channel, threshold_db, mics: { "<mic>": channel } }. */
function normalizeSettings(src) {
	const s = src && typeof src === 'object' ? src : {}
	const model = MODELS[s.model] ? s.model : ''
	const host = typeof s.host === 'string' && HOST_RE.test(s.host.trim()) ? s.host.trim() : ''
	const port = Number.isInteger(s.port) && s.port > 0 && s.port < 65536 ? s.port : 0 // 0 = the model's own
	const midi_channel =
		Number.isInteger(s.midi_channel) && s.midi_channel >= 1 && s.midi_channel <= 16 ? s.midi_channel : 1 // A&H base channel
	const t = Number(s.threshold_db)
	const threshold_db = Number.isFinite(t)
		? Math.min(THRESHOLD_DB.max, Math.max(THRESHOLD_DB.min, Math.round(t * 10) / 10))
		: THRESHOLD_DB.dflt
	const max = model ? MODELS[model].inputs : 999
	const mics = {}
	for (const [mic, ch] of Object.entries(s.mics && typeof s.mics === 'object' ? s.mics : {})) {
		const key = String(mic).trim()
		if (MIC_RE.test(key) && Number.isInteger(ch) && ch >= 1 && ch <= max) mics[key] = ch
	}
	return { model, host, port, midi_channel, threshold_db, mics }
}

function loadSettings(file = deskFile()) {
	try {
		return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')))
	} catch {
		return normalizeSettings(null)
	}
}

/** Atomic write (tmp + rename). → true, or false when the disk refused it. */
function saveSettings(settings, file = deskFile()) {
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true })
		const tmp = `${file}.${process.pid}.tmp`
		fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...normalizeSettings(settings) }, null, '\t') + '\n')
		fs.renameSync(tmp, file)
		return true
	} catch {
		return false
	}
}

module.exports = { deskFile, normalizeSettings, loadSettings, saveSettings, THRESHOLD_DB }

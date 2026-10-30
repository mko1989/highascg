'use strict'

/**
 * WO-836 Part 3c — the driver's state file: which Xvfb display, which remote port, which target (sandbox | live),
 * the pids to stop. One driver at a time; `ui start` writes it, `ui stop` removes it, every other command reads it.
 * Holds NO secrets (the live token is read by the Godot client itself from .private/api-token, and by tools/test-agent/caspar
 * from the same file when it needs it — never written here, never printed).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

function stateFile() {
	return process.env.HIGHASCG_TEST_STATE || path.join(os.homedir(), '.highascg', 'test-agent', 'state.json')
}

function readState() {
	try {
		return JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
	} catch {
		return null
	}
}

function requireState() {
	const s = readState()
	if (!s) throw new Error('no driver running — start one first: tools/test-agent/ui start --live   (or --sandbox)')
	return s
}

function writeState(s) {
	fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
	fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2))
}

function clearState() {
	try {
		fs.unlinkSync(stateFile())
	} catch {
		/* none */
	}
}

/** True when the pid is alive (signal 0). */
function alive(pid) {
	if (!pid) return false
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

module.exports = { stateFile, readState, requireState, writeState, clearState, alive }

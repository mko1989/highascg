'use strict'

/**
 * WO-941 — after a DeckLink driver install the client said the server did not respond, although the install
 * succeeded. `handleDecklinkInstallPost` ran the script with spawnSync: the dpkg + DKMS build froze the whole
 * server (every request, WS, timeline tick) and the Godot client gave up after its 15 s default. The script now
 * runs async, and the Godot install POST carries a long timeout (api_timeouts.gd INSTALL_TIMEOUT_S).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const childProcess = require('child_process')

const ROOT = path.join(__dirname, '../..')
const HANDLER = 'src/api/system-hardware-decklink-install.js'
const { handleDecklinkInstallPost } = require(path.join(ROOT, HANDLER))

/** A child that prints `lines` on stderr (the script logs there) and exits `code` after `ms`. */
function fakeChild(lines, code, ms) {
	const child = new EventEmitter()
	child.stdout = new EventEmitter()
	child.stderr = new EventEmitter()
	child.stdout.setEncoding = () => child.stdout
	child.stderr.setEncoding = () => child.stderr
	child.kill = () => {}
	setTimeout(() => {
		for (const l of lines) child.stderr.emit('data', l + '\n')
		child.emit('close', code)
	}, ms)
	return child
}

describe('WO-941 DeckLink install does not block the server', () => {
	it('the event loop keeps running while the install script runs', async (t) => {
		t.mock.method(childProcess, 'spawn', () => fakeChild(['[t] ok: installed 16.4a1'], 0, 150))
		let ticks = 0
		const iv = setInterval(() => ticks++, 10)
		try {
			const res = await handleDecklinkInstallPost('{}', { config: { ui: {} } })
			assert.equal(res.status, 200)
			assert.deepEqual(JSON.parse(res.body), { ok: true, action: 'installed', reason: 'installed 16.4a1' })
			assert.ok(ticks >= 5, `timers fired during the install (${ticks})`)
		} finally {
			clearInterval(iv)
		}
	})

	it('a failing script still reports its output as the error', async (t) => {
		t.mock.method(childProcess, 'spawn', () => fakeChild(['ERROR: dpkg install failed for 16.4a1'], 1, 5))
		const res = await handleDecklinkInstallPost('{}', { config: { ui: {} } })
		assert.equal(res.status, 409)
		assert.match(JSON.parse(res.body).error, /dpkg install failed/)
	})

	it('no spawnSync left in the handler; the Godot install POST uses the long timeout', () => {
		assert.doesNotMatch(fs.readFileSync(path.join(ROOT, HANDLER), 'utf8'), /spawnSync/)
		// an up-to-date driver is not a stale-scripts problem (the hint showed on every 'already installed' skip)
		assert.match(fs.readFileSync(path.join(ROOT, HANDLER), 'utf8'), /!\/already installed\/\.test\(reason\)/)
		const pane = fs.readFileSync(path.join(ROOT, 'godot/client/features/settings/decklink_pane.gd'), 'utf8')
		assert.ok(pane.includes('NuclearGate.post(self, "/api/system/decklink/install", {}, null, Timeouts.INSTALL_TIMEOUT_S)'))
		const gate = fs.readFileSync(path.join(ROOT, 'godot/client/app/nuclear_gate.gd'), 'utf8')
		assert.equal(gate.split('await to.post_json(path, b, timeout_s)').length - 1, 2, 'both gate POSTs pass timeout_s')
		const t = fs.readFileSync(path.join(ROOT, 'godot/client/core/api_timeouts.gd'), 'utf8')
		const s = Number(/const INSTALL_TIMEOUT_S := ([\d.]+)/.exec(t)?.[1])
		assert.ok(s * 1000 > 300000, `client waits longer than the server's 300 s script cap (${s} s)`)
	})
})

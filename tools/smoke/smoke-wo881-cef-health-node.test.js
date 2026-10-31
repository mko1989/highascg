'use strict'

/**
 * WO-881 — node side: the supervisor's health file reaches the GUI as `caspar.connection.cefFailed` (set, then cleared
 * by a clean start), and the startup LED test card backs off instead of retrying every 2.5 s forever.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { startCasparCefHealthWatch, readCefFailed } = require('../../src/system/caspar-cef-health')

const ROOT = path.join(__dirname, '..', '..')

describe('WO-881: CEF health in caspar.connection', () => {
	it('the health file → cefFailed broadcast once per change; removed → cleared', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo881-node-'))
		const file = path.join(dir, 'caspar-cef-failed')
		const sent = []
		const ctx = { _casparStatus: { connected: true }, _wsBroadcast: (t, d) => sent.push(d), log: () => {} }
		const stop = startCasparCefHealthWatch(ctx, { file, pollMs: 20 })
		try {
			assert.equal(readCefFailed(file), '')
			assert.deepEqual(sent.map((d) => d.value.cefFailed), [''], 'the first tick states it')
			fs.writeFileSync(file, '2026-10-31 Caspar HTML (CEF) failed to start twice\n')
			await new Promise((r) => setTimeout(r, 80))
			assert.equal(ctx._casparStatus.cefFailed, '2026-10-31 Caspar HTML (CEF) failed to start twice')
			assert.equal(ctx._casparStatus.connected, true, 'the AMCP state is kept')
			assert.equal(sent.at(-1).path, 'caspar.connection')
			const n = sent.length
			await new Promise((r) => setTimeout(r, 80))
			assert.equal(sent.length, n, 'no repeat while unchanged')
			fs.rmSync(file)
			await new Promise((r) => setTimeout(r, 80))
			assert.equal(ctx._casparStatus.cefFailed, '')
		} finally {
			stop()
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('the GUI eye turns red with the reason; the LED card backs off and gives up', () => {
		const shell = fs.readFileSync(path.join(ROOT, 'godot/client/app/shell.gd'), 'utf8')
		assert.match(shell, /cef_failed = str\(\(caspar as Dictionary\)\.get\("cefFailed", ""\)\)/)
		assert.match(shell, /if caspar_ok and cef_failed != "":\n\t\tcaspar_ok = false/)
		const led = fs.readFileSync(path.join(ROOT, 'src/bootstrap/startup-led-test-pattern.js'), 'utf8')
		assert.match(led, /Math\.min\(LED_RETRY_CAP_MS, \(startupLedTestFastMode\(\) \? 2500 : 5000\) \* 2 \*\* \(amcpFails - 1\)\)/)
		assert.match(led, /if \(amcpFails >= LED_RETRY_MAX\) \{[\s\S]*?gave up after/)
		assert.doesNotMatch(led, /scheduleRetry\(appCtx, startupLedTestFastMode\(\) \? 2500 : 5000\)/, 'the fixed retry stays gone')
		const index = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')
		assert.match(index, /startCasparCefHealthWatch\(appCtx\)/)
	})
})

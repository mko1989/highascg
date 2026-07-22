'use strict'

/**
 * WO-319 — a remote operator client (LAN, via the HTTPS proxy) participates in the ONE shared
 * compose layout: it reports/edits like the host. The only per-client concern is hole-suppression,
 * which is HOST-ONLY — a remote client's live-preview state must never blank the operator monitor's
 * physical punch-holes. This pins remote detection and that concept split.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

globalThis.localStorage = { getItem: () => null, setItem: () => {} }
globalThis.location = { search: '', protocol: 'https:', port: '4200', host: 'x' }

test('remote operator view detection', async (t) => {
	const mod = await import('../../client/lib/operator-gui-mode.js')

	await t.test('explicit ?operatorView param → remote (port aside)', () => {
		globalThis.location.port = '4200'
		assert.equal(mod.isRemoteOperatorView('?operatorView=1'), true)
		assert.equal(mod.isRemoteOperatorView('?foo=1'), false)
	})

	await t.test('the HTTPS proxy port (4443) → remote even with no param', () => {
		globalThis.location.port = '4443'
		assert.equal(mod.isRemoteOperatorView(''), true)
	})

	await t.test('operator mode stays host-only (a remote view is not operator mode by itself)', () => {
		assert.equal(mod.isOperatorGuiModeActive('?operatorView=1'), false)
		assert.equal(mod.isOperatorGuiModeActive('?operatorGui=1'), true)
	})
})

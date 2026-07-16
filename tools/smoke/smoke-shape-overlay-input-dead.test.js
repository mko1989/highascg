'use strict'

/**
 * Smoke — operator shape helper stacking locks (2026-07-16, commits 596c381 + 8cf5fc4).
 *
 * Locks down the settled operator-GUI stacking model after two failed designs:
 *   - X SHAPE intersects a window's INPUT region with its BOUNDING region, so "drawn with holes
 *     but clickable everywhere" (7dade2f's input=full idea) is IMPOSSIBLE on one window — a
 *     click inside a hole always reaches the window below, and Openbox executes the focused
 *     client's restack ABOVE the FULLSCREEN+ABOVE Firefox even with _NET_WM_STATE_BELOW set
 *     (synthetic-click proven live).
 *   - Therefore the consumer must be INPUT-DEAD (empty input shape, frame+client) + pinned
 *     BELOW, Firefox CLIENT (not the WM frame — Openbox drops frame-targeted EWMH) locked
 *     ABOVE, all re-asserted on the 2s poll with a stacking watchdog (_NET_ACTIVE_WINDOW).
 *
 * Two layers of lock:
 *   1. grep-level invariants on the helper source (cheap, always run);
 *   2. a REAL behavioral run on a throwaway Xvfb (xvfb-shape-overlay-harness.py): fabricated
 *      firefox/caspar windows, the actual helper spawned against them, SHAPE regions and
 *      stacking asserted before and after SIGTERM. Skipped when Xvfb is unavailable.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { REPO_ROOT } = require('../../src/repo-paths')
const PY_PATH = path.join(REPO_ROOT, 'tools/runtime/operator-shape-overlay.py')
const pySrc = fs.readFileSync(PY_PATH, 'utf8')

describe('shape helper: consumer input-dead + BELOW, firefox CLIENT above, watchdog (grep locks)', () => {
	it('apply_holes locks the firefox CLIENT above — never the WM frame (Openbox silently drops frame-targeted EWMH)', () => {
		assert.match(pySrc, /lock_window_above\(client\)/, 'ABOVE goes to the client')
		assert.doesNotMatch(pySrc, /lock_window_above\(toplevel\)/, 'the 4c3c83c frame-targeted regression must not come back')
	})
	it('enforce_caspar_under: strips ABOVE, pins BELOW, and makes the consumer INPUT-DEAD (frame+client)', () => {
		assert.match(pySrc, /def enforce_caspar_under/, 'the enforcement fn exists')
		assert.match(pySrc, /set_net_wm_state\(client, _ATOM_NET_WM_STATE_ABOVE, add=False\)/, 'stale always-on-top stripped')
		assert.match(pySrc, /set_net_wm_state\(client, _ATOM_NET_WM_STATE_BELOW, add=True\)/, 'BELOW pinned on the CLIENT')
		assert.match(pySrc, /def set_input_empty/, 'input-dead helper exists')
		assert.match(pySrc, /shape\.SO\.Set, shape\.SK\.Input, 0, 0, 0, \[\]\)/, 'input shape SET to the EMPTY region — the only click-proofing that works (input is intersected with bounding)')
		assert.match(pySrc, /set_input_empty\(pair\)/, 'enforcement actually calls it')
	})
	it('stacking watchdog: inversion detected against the firefox toplevel and healed via _NET_ACTIVE_WINDOW', () => {
		assert.match(pySrc, /def stacking_inverted/, 'inversion check exists')
		assert.match(pySrc, /_NET_ACTIVE_WINDOW/, 'reactivation atom interned')
		assert.match(pySrc, /def activate_window/, 'reactivation fn exists')
		assert.match(pySrc, /stacking_inverted\(root, top\.id, firefox_pair\[0\]\.id\)/, 'watchdog compares toplevels (what the X server stacks)')
	})
	it('enforce_caspar_under runs on EVERY poll tick (a restarted consumer must be re-neutralized <=2s) and input is restored on exit', () => {
		assert.match(pySrc, /caspar_pair = enforce_caspar_under\(/, 'poll loop re-asserts the lock')
		assert.match(pySrc, /def restore_input/, 'exit cleanup fn exists')
		assert.match(pySrc, /restore_input\(caspar_pair\)/, 'finally block restores the consumer input region (never left unclickable outside operator mode)')
	})
	it('py_compile still passes', () => {
		execFileSync('python3', ['-m', 'py_compile', PY_PATH], { stdio: 'pipe' })
	})
})

describe('shape helper: behavioral run on Xvfb (real helper, real SHAPE regions, real stacking)', () => {
	const hasXvfb = fs.existsSync('/usr/bin/Xvfb')
	it('holes punched + consumer input-dead + inverted stacking healed + full restore on SIGTERM', { skip: !hasXvfb && 'Xvfb not installed' }, () => {
		const out = execFileSync('python3', [path.join(__dirname, 'xvfb-shape-overlay-harness.py')], {
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 30000,
		})
		const v = JSON.parse(String(out).trim().split('\n').pop())
		assert.equal(v.holes_punched, true, 'firefox bounding shape carries the preview-rect holes')
		assert.equal(v.caspar_input_empty, true, 'consumer INPUT region is empty — hole clicks can never reach it')
		assert.equal(v.stack_fixed, true, 'watchdog raised firefox above a consumer that started stacked on top')
		assert.equal(v.input_restored, true, 'SIGTERM restores the consumer input region')
		assert.equal(v.bounding_restored, true, 'SIGTERM restores firefox unshaped (no permanent dead regions)')
	})
})

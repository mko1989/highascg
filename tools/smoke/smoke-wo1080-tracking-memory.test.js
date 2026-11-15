'use strict'

/**
 * WO-1080 — tracked people keep their id (owner 15.11: "it seems to create new persons ids all the time without any
 * memory"). The tracker itself is Python (tools/tracking-detect/bytetrack.py); its self-test runs when the box's
 * tracking venv exists (CI has none: skipped there). Here, always:
 *  - `memory_ms` is a detection setting (default 30 s, clamped, whole ms), sent to the sidecar and offered in the GUI;
 *  - the sidecar passes it to the tracker and reports confirmed tracks only;
 *  - the tracker parks, revives and lets measured tracks choose first (source pins).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const VENV_PY = path.join(os.homedir(), '.local/share/highascg/tracking-venv/bin/python')
const { normalizeDetection } = require(path.join(ROOT, 'src', 'tracking', 'detect-model'))

describe('WO-1080 tracking memory', () => {
	it('bytetrack.py self-test (sidecar venv only)', (t) => {
		if (!fs.existsSync(VENV_PY)) return t.skip('no tracking venv on this machine')
		const r = spawnSync(VENV_PY, [path.join(ROOT, 'tools/tracking-detect/test_bytetrack.py')], { encoding: 'utf8' })
		assert.equal(r.status, 0, r.stdout + r.stderr)
		assert.match(r.stdout, /PASS/)
	})

	it('memory_ms: default 30 s, clamped to 0–10 min, whole milliseconds', () => {
		assert.equal(normalizeDetection(null).memory_ms, 30000)
		assert.equal(normalizeDetection({ memory_ms: 0 }).memory_ms, 0)
		assert.equal(normalizeDetection({ memory_ms: 1e9 }).memory_ms, 600000)
		assert.equal(normalizeDetection({ memory_ms: 1234.6 }).memory_ms, 1235)
		assert.equal(normalizeDetection({ memory_ms: 'x' }).memory_ms, 30000)
	})

	it('wired: server → sidecar → tracker, and the GUI field', () => {
		assert.match(read('src/tracking/detect-service.js'), /grace_ms: det\.grace_ms, memory_ms: det\.memory_ms,/)
		assert.match(read('tools/tracking-detect/sidecar.py'), /"grace_ms": 500, "memory_ms": 30000,/)
		const det = read('tools/tracking-detect/detector.py')
		assert.match(det, /allowance \+ coast, dt, cfg\.get\("memory_ms", 0\) \/ 1000\.0\)/)
		assert.match(det, /if not t\.confirmed:/)
		const gd = read('godot/client/features/previs/tracking/detect_model.gd')
		assert.match(gd, /"grace_ms": 500, "memory_ms": 30000,/)
		assert.match(gd, /"memory_ms": \[0, 600000\],/)
		assert.match(gd, /const INTS := \[[^\]]*"memory_ms"/)
		assert.match(read('godot/client/features/previs/tracking/detect_section.gd'), /_num\(g, "Remember", "memory_ms", 1000, "ms"\)/)
	})

	it('tracker: measured tracks choose first, then coasting, then remembered; parked tracks are not returned', () => {
		const bt = read('tools/tracking-detect/bytetrack.py')
		const up = bt.slice(bt.indexOf('    def update(self, high, low, now, max_lost_s, dt=1.0, memory_s=0.0):'))
		const order = ['_associate(seen, high,', '_associate(coasting, new_high,', '_associate(un_seen + un_coast, low,', '_associate(parked, new_high,']
		const at = order.map((s) => up.indexOf(s))
		assert.ok(at.every((p, i) => p > 0 && (i === 0 || p > at[i - 1])), 'association order: ' + at)
		assert.match(up, /return \[t for t in self\.tracks if t\.state != "remembered"\]/)
	})
})

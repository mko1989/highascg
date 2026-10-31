'use strict'
/**
 * WO-903: two operator GUI monitors side by side (DP-4 + DP-6) — the pointer fence goes round both, not only the
 * primary head; only touching heads of the same y / height are joined (no off-screen gap inside the fence).
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { spanOperatorHeads } = require('../../src/system/pointer-confine-span')

const head = (sysId, x, y = 0, width = 1920, height = 1080) => ({ sysId, x, y, width, height })
const primary = { ...head('DP-4', 0), kind: 'operator_gui' }

describe('WO-903 pointer confine spans the operator heads', () => {
	it('joins touching heads left to right', () => {
		const r = spanOperatorHeads(primary, { operatorGui: { 1: head('DP-4', 0), 2: head('DP-6', 1920) } })
		assert.deepEqual([r.sysId, r.x, r.y, r.width, r.height], ['DP-4,DP-6', 0, 0, 3840, 1080])
	})
	it('grows left of the primary too', () => {
		const p = { ...head('DP-6', 1920) }
		const r = spanOperatorHeads(p, { operatorGui: { 1: head('DP-4', 0), 2: head('DP-6', 1920) } })
		assert.deepEqual([r.sysId, r.x, r.width], ['DP-4,DP-6', 0, 3840])
	})
	it('keeps one head when the other has a gap, another height or another y', () => {
		for (const other of [head('DP-6', 2000), head('DP-6', 1920, 0, 1920, 1200), head('DP-6', 1920, 100)]) {
			assert.equal(spanOperatorHeads(primary, { operatorGui: { 1: head('DP-4', 0), 2: other } }), primary)
		}
	})
	it('leaves a single head and the multiview fence alone', () => {
		assert.equal(spanOperatorHeads(primary, { operatorGui: { 1: head('DP-4', 0) } }), primary)
		const mv = { ...head('DP-2', 0), kind: 'multiview' }
		assert.equal(spanOperatorHeads(mv, { operatorGui: { 1: head('DP-2', 0), 2: head('DP-6', 1920) } }), mv)
		assert.equal(spanOperatorHeads(null, {}), null)
	})
	it('the server passes the list; the daemon unions it; the running check matches the exact argument', () => {
		const js = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'system', 'pointer-confine.js'), 'utf8')
		assert.match(js, /const rect = spanOperatorHeads\(resolveOperatorMonitorRect\(config, layout\), layout\)/)
		assert.match(js, /\/\^\[A-Za-z0-9\._-\]\+\(,\[A-Za-z0-9\._-\]\+\)\*\$\/\.test\(rect\.sysId\)/)
		assert.match(js, /line\.trim\(\)\.split\(\/\\s\+\/\)\.pop\(\) === sysId/)
		const py = fs.readFileSync(
			path.join(__dirname, '..', '..', 'tools', 'runtime', 'confine-pointer-barriers.py'),
			'utf8'
		)
		assert.match(
			py,
			/if output_name and "," in output_name:\n\s+boxes = \[get_monitor_geometry\(n, dpy, root\)\[1\] for n in output_name\.split\(","\)\]/
		)
	})
})

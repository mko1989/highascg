'use strict'

/**
 * WO-369 smoke — checklist27 items 8 + 29.
 *
 * Item 8: the "Back to GUI" button is redundant WHERE 98c80e3's pointerdown auto-park runs —
 * that handler is gated on the multi-helper taskbar flag, so the button must survive for the
 * flag-off WO-283 single-helper configuration where auto-park is inert and it is the only way
 * back. Both halves are pinned here: the button is gated, and the auto-park path that replaces
 * it is intact (98c80e3 shipped no test of its own — this is the first).
 *
 * Item 29: the wall clock is bigger and tighter to the eyes, and has NOT moved (the placement
 * from 1d1dca0 is signed off; a fourth position would be a regression).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

test('WO-369 item 8 — Back to GUI is gated on the taskbar being off', () => {
	const src = read('client/components/header-bar-operator-helper.js')

	assert.ok(
		/backBtn\.style\.display = busy && !_taskbarOn \? '' : 'none'/.test(src),
		'the button must be hidden whenever the taskbar (and therefore auto-park) is on',
	)
	// The gate reads _taskbarOn, so refresh() must set it BEFORE calling render().
	const refresh = src.slice(src.indexOf('async function refresh()'))
	const taskbarAssign = refresh.indexOf('_taskbarOn = tb.enabled')
	const renderCall = refresh.indexOf('render(s.state, s.action)')
	assert.ok(taskbarAssign > -1 && renderCall > -1)
	assert.ok(taskbarAssign < renderCall, 'render() must not decide the gate on a stale _taskbarOn')
})

test('WO-369 item 8 — the auto-park path that makes the button redundant is intact', () => {
	const src = read('client/components/header-bar-operator-helper.js')

	// Clicking anywhere on the GUI parks every raised helper (98c80e3).
	assert.ok(/addEventListener\(\s*'pointerdown'/.test(src), 'auto-park listener must survive')
	assert.ok(/\{ capture: true \}/.test(src), 'it must stay a capture-phase listener')
	assert.ok(
		/if \(wrap\.contains\(\/\*\* @type \{Node\} \*\/ \(e\.target\)\)\) return/.test(src),
		"the control's own chrome must stay exempt (clicking a chip must not park it again)",
	)
	assert.ok(
		/const raised = _lastHelpers\.filter\(\(h\) => h\.state === 'open' && h\.parked !== true\)/.test(src),
		'only raised helpers get parked',
	)
	// Server-side park action still reachable (Companion/API callers, WO-369 §1 check).
	assert.ok(/parkAllOpen\(\)/.test(read('src/system/operator-helper-live.js')))
})

test('WO-369 item 29 — wall clock typography', () => {
	const css = read('client/styles/01a2-header-bar.css')
	const block = css.slice(css.indexOf('.header-wall-clock {'))
	const rule = block.slice(0, block.indexOf('}'))

	const fontSize = Number(/font-size:\s*(\d+)px/.exec(rule)?.[1])
	assert.ok(fontSize >= 16, `clock font must be legible from the operator position (got ${fontSize}px, was 12px)`)

	const marginRight = Number(/margin-right:\s*(-?\d+)px/.exec(rule)?.[1])
	// .header__status has `gap: 0.5rem` (8px); the effective gap to the eyes is gap + margin.
	assert.ok(marginRight + 8 <= 8, `gap to the eyes must be tighter than the row rhythm (got ${marginRight + 8}px, was 18px)`)
	assert.ok(marginRight + 8 > 0, 'the clock must not overlap the eyes')

	assert.ok(/font-variant-numeric:\s*tabular-nums/.test(rule), 'digits must not jitter as they tick')
})

test('WO-369 item 29 — the clock did NOT move (placement 1d1dca0 is signed off)', () => {
	const src = read('client/components/header-bar.js')
	assert.ok(
		/statusEl\.insertBefore\(wallClock, eyeContainerEl\)/.test(src),
		'clock stays between the PGM progress block and the eyes',
	)
})

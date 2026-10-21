'use strict'

/**
 * WO-382 — `operatorTools.multiHelperTaskbar` must be settable through POST /api/settings.
 *
 * The flag turns WO-317's helper taskbar (and, with it, the coordinator that owns operator-GUI
 * window stacking) on. It was writable ONLY by hand-editing config/general.json: no UI, no API
 * key. It is also absent from `defaults.operatorTools`, so anything that rebuilds that block from
 * defaults drops it — and there was then no supported way to put it back. That is how the box lost
 * its taskbar (owner 2026-07-29: "the app taskbar is gone" + operator-GUI stacking changed).
 *
 * Also pins WO-268's rule that a narrow patch never wipes the other operatorTools keys.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

test('a narrow patch can turn the taskbar flag on and off', () => {
	const src = fs.readFileSync(path.join(ROOT, 'src/api/settings-post.js'), 'utf8')
	assert.match(
		src,
		/if \(settings\.operatorTools\.multiHelperTaskbar !== undefined\) \{[\s\S]*?cfg\.operatorTools\.multiHelperTaskbar = settings\.operatorTools\.multiHelperTaskbar === true/,
		'settings-post must apply the flag from a patch',
	)
	// Strictly boolean — the gate itself only accepts `true` (smoke-wo317-helper-taskbar-routes).
	assert.match(src, /multiHelperTaskbar === true/)
})

test('the operatorTools patch block still preserves keys it does not know', () => {
	const src = fs.readFileSync(path.join(ROOT, 'src/api/settings-post.js'), 'utf8')
	const block = src.slice(src.indexOf('if (settings.operatorTools) {'))
	const body = block.slice(0, block.indexOf('\n\tif (settings.projectScopedMedia)'))
	// WO-268: defaults first, THEN the saved config — never defaults + patch, which drops
	// everything the operator set that the patch did not mention.
	assert.match(body, /\.\.\.defaults\.operatorTools,\s*\n\s*\.\.\.\(cfg\.operatorTools \|\| \{\}\),/)
	// Every key is applied only when present in the patch.
	for (const key of ['pointerConfineMultiview', 'pointerConfine', 'cefEnableGpu', 'multiHelperTaskbar']) {
		assert.match(
			body,
			new RegExp(`settings\\.operatorTools\\.${key} !== undefined`),
			`${key} must be guarded by an !== undefined check`,
		)
	}
})

'use strict'

/**
 * WO-382 / WO-268 — a narrow POST /api/settings patch never wipes the other operatorTools keys, and every key is
 * applied only when present. (WO-382's own flag, operatorTools.multiHelperTaskbar, went with the kiosk taskbar: WO-995.)
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

test('the operatorTools patch block still preserves keys it does not know', () => {
	const src = fs.readFileSync(path.join(ROOT, 'src/api/settings-post.js'), 'utf8')
	const block = src.slice(src.indexOf('if (settings.operatorTools) {'))
	const body = block.slice(0, block.indexOf('\n\tif (settings.projectScopedMedia)'))
	// WO-268: defaults first, THEN the saved config — never defaults + patch, which drops
	// everything the operator set that the patch did not mention.
	assert.match(body, /\.\.\.defaults\.operatorTools,\s*\n\s*\.\.\.\(cfg\.operatorTools \|\| \{\}\),/)
	// Every key is applied only when present in the patch.
	for (const key of ['pointerConfineMultiview', 'pointerConfine', 'cefEnableGpu']) {
		assert.match(
			body,
			new RegExp(`settings\\.operatorTools\\.${key} !== undefined`),
			`${key} must be guarded by an !== undefined check`,
		)
	}
})

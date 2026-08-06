'use strict'

/**
 * WO-440 (todos06.08 item 3): the Apply button hit WO-337's unchanged-gate ("no changes —
 * Caspar left running"), so an operator could NOT force the restart that makes caspar-env
 * changes take (WO-407/439 GL sync lives OUTSIDE the XML the gate compares). Owner ruling:
 * the button ALWAYS restarts Caspar. Background appliers (project-hardware-apply) still post
 * without force and keep the fast path.
 *
 * WO-441 (todos06.08 items 1-2): GPU inspector display — "Native mode" wrapped mid-word
 * (word-break: break-all split "Hz"), and the three custom W/H/FPS number inputs kept their
 * natural ~150px width, overflowing the sidebar (Height box cut off).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** Strip comments so an explanatory sentence can never satisfy an assertion. */
function code(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('WO-440: the Apply button action always sends force', () => {
	const src = code(read('client/components/device-view-actions.js'))
	const m = /export async function applyCasparConfig\([\s\S]*?\n\}/.exec(src)
	assert.ok(m, 'applyCasparConfig still exists')
	assert.match(m[0], /force:\s*true/, 'the button must always restart Caspar (owner, todos06.08)')
})

test('WO-440: the server gate still honours force end-to-end', () => {
	const gate = code(read('src/utils/full-config-apply.js'))
	assert.match(
		gate,
		/writeResult\.changed === false && !needsNodm && opts\.force !== true/,
		'the unchanged-gate must keep its force bypass — without it the button flag does nothing',
	)
	const route = code(read('src/api/routes-caspar-config.js'))
	assert.match(route, /b\.force === true \|\| b\.force === 'true'/, 'route parses body.force')
})

test('WO-440: background project-hardware apply still uses the fast path (no force)', () => {
	const src = code(read('client/lib/project-hardware-apply.js'))
	const m = /caspar-config\/apply'\s*,\s*\{([^}]*)\}/.exec(src)
	assert.ok(m, 'project-hardware apply still posts to the apply endpoint')
	assert.doesNotMatch(
		m[1],
		/force/,
		'loading a project whose hardware matches must NOT restart Caspar mid-show',
	)
})

test('WO-441: inspector summary values wrap at word boundaries, not mid-word', () => {
	const css = read('client/styles/09b3-device-view-inspector-sidebar.css')
	const m = /\.device-view__kv-val\s*\{([\s\S]*?)\}/.exec(css)
	assert.ok(m, 'kv-val rule still exists')
	assert.doesNotMatch(m[1], /word-break:\s*break-all/, '"3840x2160 @ 50 Hz" must not split inside "Hz"')
	assert.match(m[1], /overflow-wrap:\s*anywhere/, 'long unbroken tokens (EDID serials) still break')
})

test('WO-441: Native mode string is non-breaking; custom W/H/FPS inputs share the row', () => {
	const src = code(read('client/components/device-view-inspector-gpu.js'))
	assert.match(src, /nativeModeRaw\.replace\(\/ \/g, ' '\)/, 'NBSP join keeps the mode on one line')
	assert.match(src, /flex = '1 1 0'/, 'number inputs must not keep natural width in the sidebar row')
	assert.match(src, /minWidth = '0'/, 'flex children need min-width:0 to actually shrink')
})

'use strict'

/**
 * WO-436: mapping-node inspector values (Src X/Y, Width, Height, mode, label) "did not take
 * the first time and reverted to defaults". Two stacked caches caused it:
 *
 *  1. Every post-save reload called BARE ctx.load(), served from the 5s payload cache — the
 *     inspector re-rendered the pre-edit snapshot, visually reverting the field.
 *  2. fetchDeviceView() is the read half of a read-modify-write (fetch graph → mutate →
 *     save WHOLE graph), and /api/device-view is browser-cacheable (max-age=3). A retype
 *     within 3s fetched the pre-first-save graph from the HTTP cache and saved it back,
 *     reverting the first edit SERVER-side.
 *
 * This extends the standing rule already pinned for device-view-events.js
 * (smoke-device-view-reload-forces-refresh.test.js): a change-driven reload must never be
 * answered from a cache.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const INSPECTOR = fs.readFileSync(
	path.join(ROOT, 'client', 'components', 'device-view-inspector-mapping.js'),
	'utf8',
)
const SERVICE = fs.readFileSync(path.join(ROOT, 'client', 'lib', 'mapping-node-service.js'), 'utf8')

/** Strip comments so an explanatory sentence can never satisfy an assertion. */
function code(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('WO-436: every reload in the mapping inspector bypasses the payload cache', () => {
	const src = code(INSPECTOR)
	const bare = [...src.matchAll(/\bload\(\s*\)/g)]
	assert.deepEqual(
		bare.map((m) => src.slice(Math.max(0, m.index - 60), m.index + 8).trim().split('\n').pop()),
		[],
		'every load() here runs right after a mutation was saved — a bare load() re-renders the ' +
			'5s-cached pre-edit snapshot and the just-typed value visually reverts',
	)
	assert.match(src, /load\(\{\s*forceRefresh:\s*true\s*\}\)/, 'the forced form is actually in use')
})

test('WO-436: fetchDeviceView busts the browser HTTP cache (read-modify-write read half)', () => {
	const src = code(SERVICE)
	const m = /export async function fetchDeviceView\(\)\s*\{([\s\S]*?)\n\}/.exec(src)
	assert.ok(m, 'fetchDeviceView still exists in mapping-node-service.js')
	assert.match(
		m[1],
		/_ts=\$\{Date\.now\(\)\}/,
		'the route sends Cache-Control: max-age=3; an un-busted GET within 3s returns a pre-edit ' +
			'graph that the subsequent whole-graph save writes back, reverting the previous edit',
	)
})

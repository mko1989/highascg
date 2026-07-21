'use strict'

/**
 * ctx.load() consults a 5s payload cache and, on a hit, re-renders the cached snapshot WITHOUT
 * fetching (device-view-render.js). Both 'highascg-settings-applied' and
 * 'highascg-device-view-reload' fire precisely because the config just changed — loading a project
 * applies its hardware slice and then dispatches settings-applied — so answering them from cache
 * renders the pre-apply state and the loaded Device View settings never appear.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const EVENTS = fs.readFileSync(path.join(ROOT, 'client', 'components', 'device-view-events.js'), 'utf8')
const RENDER = fs.readFileSync(path.join(ROOT, 'client', 'components', 'device-view-render.js'), 'utf8')
const ACTIONS = fs.readFileSync(path.join(ROOT, 'client', 'components', 'device-view-actions.js'), 'utf8')
const ROUTE = fs.readFileSync(path.join(ROOT, 'src', 'api', 'routes-device-view.js'), 'utf8')

/** Strip comments so an explanatory sentence can never satisfy an assertion. */
function code(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('the cache that makes this matter still exists', () => {
	/* If this ever stops being true the assertions below are guarding nothing, and this test should
	 * be revisited rather than silently passing. */
	assert.match(
		code(RENDER),
		/forceRefresh\s*=\s*opts\.forceRefresh\s*===\s*true/,
		'ctx.load still takes a forceRefresh opt',
	)
	assert.match(code(RENDER), /shouldUseCache/, 'ctx.load still short-circuits on a cache hit')
})

test('config-changed events bypass the payload cache', () => {
	const src = code(EVENTS)
	for (const evt of ['highascg-settings-applied', 'highascg-device-view-reload']) {
		const m = new RegExp(`addEventListener\\(\\s*'${evt}'\\s*,\\s*\\(\\)\\s*=>\\s*ctx\\.load\\(([^)]*)\\)`).exec(src)
		assert.ok(m, `${evt} still reloads the device view`)
		assert.match(
			m[1],
			/forceRefresh:\s*true/,
			`${evt} fires because the config just changed, so it must not be served from the 5s ` +
				'payload cache — otherwise the pre-apply snapshot is re-rendered',
		)
	}
})

test('every reload in device-view-events.js bypasses the cache', () => {
	/* Every ctx.load() in this file runs either from an explicit operator action (Refresh, Add
	 * destination) or from an onApplied/settings-changed callback — i.e. always at a moment when
	 * the server state has just moved or the operator has just asked to see current truth. None of
	 * them may be answered from the 5s payload cache. The plain-load path that legitimately uses
	 * the cache is tab activation, which lives in device-view.js, not here.
	 *
	 * The reported symptom this guards: "adding a screen destination does not always show the
	 * destination straight away and needs a manual refresh" — addDestination().then(() => ctx.load())
	 * re-rendered a cached snapshot taken before the destination existed. */
	const src = code(EVENTS)
	const bare = [...src.matchAll(/ctx\.load\(\s*\)/g)]
	assert.deepEqual(
		bare.map((m) => src.slice(Math.max(0, m.index - 60), m.index + 12).trim().split('\n').pop()),
		[],
		'these ctx.load() calls take no forceRefresh, so a snapshot fetched in the preceding 5s is ' +
			're-rendered instead of the change that just happened',
	)
})

test('a forced refresh also bypasses the BROWSER http cache', () => {
	/* The server sends Cache-Control: max-age=3 on this endpoint, so for 3s the browser answers the
	 * request itself. Bypassing only our own 5s payload cache still let a reload right after a
	 * mutation be handed a pre-change response. */
	assert.match(
		code(ROUTE),
		/'Cache-Control':\s*'private,\s*max-age=\d+'/,
		'this guard is only meaningful while the endpoint is still browser-cacheable',
	)
	assert.match(
		code(RENDER),
		/loadDeviceView\(\{[^}]*bustCache:\s*forceRefresh/,
		'the forced-refresh fetch must ask loadDeviceView to bust the HTTP cache',
	)
	assert.match(
		code(ACTIONS),
		/bustCache[\s\S]{0,300}?_ts=\$\{Date\.now\(\)\}/,
		'loadDeviceView must add a cache-busting param when bustCache is set',
	)
})

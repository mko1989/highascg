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

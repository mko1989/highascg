'use strict'

/**
 * WO-825 — source pins for the GDTF Share library wiring: the follow-patch hook, the route registration, the Settings
 * pane (registered + endpoints the server really serves), and that the library directory is under the cache the eggs
 * excludes drop (GDTF Share's terms do not allow shipping the files in the ISO).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('the patch adopts library types (import missing, upgrade stubs) on every project change', () => {
	const s = read('src/fixtures/follow-service.js')
	assert.match(s, /gdtfFull\.adoptPatch\(engine\.fixtures\.map\(\(f\) => f\.typeId\)\.filter\(Boolean\)/)
	assert.match(s, /\n\treturn service\n/)
})

test('routes: registered by routes-gdtf-share, every endpoint the Godot pane calls exists', () => {
	assert.match(read('src/api/routes-gdtf-share.js'), /require\('\.\/routes-gdtf-library'\)\.register\(routes\)/)
	const server = read('src/api/routes-gdtf-library.js')
	const pane = read('godot/client/features/settings/library_pane.gd') + read('godot/client/features/settings/library_model.gd')
	for (const p of pane.match(/\/api\/fixtures\/library\/[a-z]+/g)) {
		assert.ok(server.includes(`'${p}'`), `${p} is served`)
	}
	assert.match(read('godot/client/features/settings/settings_tab.gd'), /_pane\("GDTF library"\)\.add_child\(LibraryPane\.new\(\)\)/)
})

test('the library lives under ~/.highascg/cache, which the ISO exclude lists drop', () => {
	assert.match(read('src/fixtures/gdtf-library.js'), /path\.join\(share\.home\(\), 'cache', 'gdtf-library'\)/)
	for (const f of ['penguins-eggs-exclude-highascg-fragment.list', 'penguins-eggs-exclude-highascg-embed-server.list']) {
		assert.match(read(`tools/eggs/live-usb/${f}`), /^home\/casparcg\/\.highascg\/cache\/\*$/m, f)
	}
})

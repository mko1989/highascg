'use strict'
/**
 * WO-705 — the operator dock's apps (owner next.md 23.10, .64 live ISO boot: "no programs in the dock..."). The GUI
 * comes up before the server (WO-696 / WO-702: DeckLink compile + Caspar gate held highascg.service for minutes); the
 * dock asked GET /api/system/dock once, failed, and kept only its HighAsCG button. It now asks again on every WS
 * connect until it has the list, and only once fills (both askings can be in flight on a normal start).
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const dock = fs.readFileSync(path.join(__dirname, '../../godot/client/app/operator_dock.gd'), 'utf8')

describe('WO-705 dock loads when the server is up', () => {
	it('asks again on every WS connect', () => {
		assert.match(dock, /\t_load\(\)\n\tWs\.connected\.connect\(_load\)/)
	})

	it('fills once: guarded before and after the request', () => {
		const body = dock.slice(dock.indexOf('func _load() -> void:'))
		assert.match(body, /^func _load\(\) -> void:\n\tif _loaded or _loading:\n\t\treturn\n\t_loading = true\n/)
		assert.match(body, /\t_loading = false\n\tif _loaded:\n\t\treturn\n/)
		const failed = body.indexOf('could not load the app list')
		const set = body.indexOf('\t_loaded = true')
		assert.ok(failed > 0 && set > failed, 'only a loaded list sets _loaded')
	})
})

'use strict'
/**
 * WO-902: another client's operatorGuiLayout broadcast must never make this client re-tile (and post) the shared
 * layout, and Auto is off until pressed — fresh / probe clients shrank the owner's Live windows.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..', 'godot', 'client', 'features', 'live')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

describe('WO-902 compose layout writes', () => {
	it('a broadcast (_take without media) does not re-tile', () => {
		const src = read('compose_tiles.gd')
		const take = src.slice(src.indexOf('func _take('), src.indexOf('func _on_ws('))
		assert.match(take, /\tif with_media:[^\n]*\n\t\t_retile_soon\(\)/)
		assert.equal(take.match(/_retile_soon\(\)/g).length, 1)
		assert.match(src, /_take\(data\.cells, false\)/)
	})
	it('--test / --check never reach the box server', () => {
		const sh = fs.readFileSync(path.join(root, '..', '..', 'run-client.sh'), 'utf8')
		const block = sh.slice(sh.indexOf('if [[ "${1:-}" == "--test" || "${1:-}" == "--check" ]]; then'), sh.indexOf('if [[ "${1:-}" == "--test" ]]; then'))
		assert.match(block, /export HIGHASCG_SERVER="\$\{HIGHASCG_TEST_SERVER:-http:\/\/127\.0\.0\.1:9\}"/)
	})
	it('Auto defaults to off', () => {
		const src = read('live_preview.gd')
		assert.match(src, /cfg\.get_value\("live", "auto", false\)/)
		assert.doesNotMatch(src, /"live", "auto", true/)
	})
})

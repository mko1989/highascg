'use strict'

/**
 * WO-323 smoke — compose preview: add/remove live sources as tiles.
 *
 * The compose-tile logic (source-tile store, drop normalization/rejection, mvcell resolution,
 * seed keys) lived in client/components/operator-compose-tiles*.js, which was deleted with the
 * Firefox kiosk operator GUI (WO-646). Those cases were removed. What remains pins the
 * parseRouteValue relocation, which still serves scenes-shared.js and input-channels.js.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { parseRouteValue } = require('../../client/lib/input-channels.js')

describe('WO-323: parseRouteValue relocation', () => {
	it('parseRouteValue is require-safe from input-channels.js and parses both route forms', () => {
		assert.deepEqual(parseRouteValue('route://5'), { channel: 5, layer: null })
		assert.deepEqual(parseRouteValue('route://5-4'), { channel: 5, layer: 4 })
		assert.equal(parseRouteValue('media/clip'), null)
	})

	it('scenes-shared.js re-exports it for its existing importers (source assertion)', () => {
		const fs = require('node:fs')
		const path = require('node:path')
		const src = fs.readFileSync(path.join(__dirname, '../../client/components/scenes-shared.js'), 'utf8')
		assert.match(src, /import \{ parseRouteValue \} from '\.\.\/lib\/input-channels\.js'/)
		assert.match(src, /export \{ parseRouteValue \}/)
	})
})

'use strict'

/**
 * WO-625 — "4. TŁO 4 - DELIKATNE FALE" (a numbered CLS id, no extension) normalized to "4": the "last dot onward"
 * extension strip ate the name, so the take never matched the probed disk row and Fill width fell back to 16:9
 * (MIXER FILL 0 0 1 1 for a 20:7 clip the editor drew at 1920×672). Only real media extensions are stripped now, in
 * the take's resolution lookup, the media-list dedupe and the web mixer-fill copy.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const nf = require('../../src/engine/scene-native-fill')
const { dedupeMediaList, canonicalMediaBasenameKey, MEDIA_FILE_EXT } = require('../../src/utils/media-browser-dedupe')

const CLS = 'PROJECTS/AIRPORT/4. TŁO 4 - DELIKATNE FALE'
const DISK = 'projects/airport/4. Tło 4 - delikatne fale.mp4'

describe('WO-625 numbered / dotted media names keep their identity', () => {
	it('basename keys: only a media extension is stripped', () => {
		assert.equal(canonicalMediaBasenameKey(CLS), '4. tło 4 - delikatne fale')
		assert.equal(canonicalMediaBasenameKey(DISK), '4. tło 4 - delikatne fale')
		assert.equal(canonicalMediaBasenameKey('BRIDGE/CONF 3.16.2026 REV3'), 'conf 3.16.2026 rev3')
		assert.equal(canonicalMediaBasenameKey('clip.mov'), 'clip')
		assert.equal(canonicalMediaBasenameKey('still.webp'), 'still')
	})

	it('the take finds the probed resolution for the CLS id → Fill width keeps the clip aspect', () => {
		const self = {
			state: { getState: () => ({ media: [{ id: CLS }] }) },
			mediaDetails: {},
			_mediaProbeCache: { [DISK]: { resolution: '3840×1344' } },
		}
		const res = nf.getMediaResolutionFromSelf(self, CLS)
		assert.deepEqual(res, { w: 3840, h: 1344 })
		const layer = {
			contentFit: 'horizontal',
			aspectLocked: true,
			fill: { x: 0, y: 0, scaleX: 1, scaleY: 0.6222222222222222 },
		}
		const fill = nf.resolveSceneLayerFill(layer, 1920, 1080, 1920, 1080, res)
		assert.ok(Math.abs(fill.scaleY - 672 / 1080) < 1e-6, `scaleY ${fill.scaleY}`)
		const blind = nf.resolveSceneLayerFill(layer, 1920, 1080, 1920, 1080, null)
		assert.equal(blind.scaleY, 1, 'without the resolution Fill width assumes 16:9 — the stretched picture the owner saw')
	})

	it('the media list merges the CLS row into the disk row', () => {
		const ids = dedupeMediaList([{ id: CLS }, { id: DISK, resolution: '3840×1344' }]).map((m) => m.id)
		assert.deepEqual(ids, [DISK])
	})

	it('the web mixer-fill copy uses the same extension list', () => {
		const web = fs.readFileSync(path.join(__dirname, '../../client/lib/mixer-fill.js'), 'utf8')
		assert.ok(web.includes(`const MEDIA_FILE_EXT = ${MEDIA_FILE_EXT}`), 'KEEP IN SYNC')
		assert.match(web, /\.replace\(MEDIA_FILE_EXT, ''\)/)
	})
})

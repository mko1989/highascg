'use strict'

/**
 * WO-627 — a locked-aspect 3072×1280 clip ("BAZA 2.mp4", Fill canvas) drew 1920×800 in the editor but Caspar got
 * MIXER FILL 0 0 0.7407 0.7407: node never knew the clip's resolution (the media list probed only the same first 120
 * of 345 files on every call; this Caspar build's CINF has no resolution), so the take assumed 16:9. The take now
 * ffprobes the file once as a last resort, and the media list works through the whole library.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const nf = require('../../src/engine/scene-native-fill')
const ffmpeg = require('../../src/media/local-media-ffmpeg')
const catalog = require('../../src/api/media-catalog')

const CLIP = 'projects/npcc/Tlo Orange Ball/BAZA 2.mp4'
const layer = { contentFit: 'fill-canvas', aspectLocked: true, source: { type: 'media', value: CLIP }, fill: { x: 0, y: 0, scaleX: 1, scaleY: 0.7407407407407407 } }

describe('WO-627 take resolves an unprobed clip from the file itself', () => {
	let tmp
	let realProbe
	const calls = []
	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo627-'))
		fs.mkdirSync(path.join(tmp, path.dirname(CLIP)), { recursive: true })
		fs.writeFileSync(path.join(tmp, CLIP), '')
		realProbe = ffmpeg.probeMedia
		ffmpeg.probeMedia = async (fp) => {
			calls.push(fp)
			return fp.endsWith('BAZA 2.mp4') ? { resolution: '3072×1280', durationMs: 20000 } : {}
		}
	})
	after(() => {
		ffmpeg.probeMedia = realProbe
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	it('no row resolution, no CINF → one ffprobe, cached; the fill keeps 2.4:1 (1920×800), not 16:9', async () => {
		const self = { config: { local_media_path: tmp }, state: { getState: () => ({ media: [{ id: CLIP }] }) }, mediaDetails: {} }
		assert.equal(nf.getMediaResolutionFromSelf(self, CLIP), null, 'the owner case: nothing known up front')
		const blind = nf.resolveSceneLayerFill(layer, 1920, 1080, 1920, 1080, null)
		assert.ok(Math.abs(blind.scaleX - 0.7407) < 1e-3, 'without it: the squeezed 0.7407 × 0.7407 Caspar showed')
		const res = await nf.probeResolutionFromDisk(self, CLIP)
		assert.deepEqual(res, { w: 3072, h: 1280 })
		assert.deepEqual(await nf.probeResolutionFromDisk(self, CLIP), { w: 3072, h: 1280 })
		assert.equal(calls.length, 1, 'probed once')
		assert.deepEqual(nf.getMediaResolutionFromSelf(self, CLIP), { w: 3072, h: 1280 }, 'later lookups hit the cache')
		const fill = nf.resolveSceneLayerFill(layer, 1920, 1080, 1920, 1080, res)
		assert.ok(Math.abs(fill.scaleX - 1) < 1e-6 && Math.abs(fill.scaleY - 800 / 1080) < 1e-6, JSON.stringify(fill))
	})

	it('routes and missing files are never probed', async () => {
		const self = { config: { local_media_path: tmp } }
		calls.length = 0
		assert.equal(await nf.probeResolutionFromDisk(self, 'route://4-1'), null)
		assert.equal(await nf.probeResolutionFromDisk(self, 'nope/missing.mov'), null)
		assert.equal(calls.length, 0)
	})

	it('getResolvedFillForSceneLayer uses it when CINF has no resolution', async () => {
		const self = {
			config: { local_media_path: tmp },
			state: { getState: () => ({ media: [] }) },
			mediaDetails: {},
			amcp: { query: { cinf: async () => ({ data: ['"PROJECTS/NPCC/TLO ORANGE BALL/BAZA 2"  MOVIE  99685797 20260101000000 500 1/25'] }) } },
		}
		const fill = await nf.getResolvedFillForSceneLayer(self, layer, 1)
		assert.ok(Math.abs(fill.scaleX - 1) < 1e-6 && Math.abs(fill.scaleY - 800 / 1080) < 1e-6, JSON.stringify(fill))
	})
})

describe('WO-627 the media list probe works through the whole library', () => {
	it('a second call probes the NEXT files, not the same 120 again (unprobeable files count as tried)', async () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo627-list-'))
		try {
			const media = []
			for (let i = 0; i < 150; i++) {
				const id = `c${String(i).padStart(3, '0')}.mov`
				fs.writeFileSync(path.join(tmp, id), '') // empty → ffprobe fails ({}), which is an answer too
				media.push({ id })
			}
			const ctx = { config: { local_media_path: tmp }, mediaDetails: {} }
			await catalog.enrichMediaListForHttp(ctx, media, { skipFinalDedupe: true })
			assert.equal(ctx._mediaProbeTried.size, 120)
			assert.ok(ctx._mediaProbeTried.has('c000.mov') && !ctx._mediaProbeTried.has('c149.mov'))
			await catalog.enrichMediaListForHttp(ctx, media, { skipFinalDedupe: true })
			assert.equal(ctx._mediaProbeTried.size, 150, 'the remaining 30 — the old filter re-picked c000…c119 forever')
			const rows = await catalog.enrichMediaListForHttp(ctx, media, { skipFinalDedupe: true })
			assert.ok(rows.every((r) => !('probed' in r)), 'no bookkeeping leaks into /api/media rows')
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true })
		}
	})
})

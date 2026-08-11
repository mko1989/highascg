'use strict'

/* Regression, client half of WO-469 (see WO-472). The server-side browser dedupe was scoped to the
 * folder, but the GUI still showed an empty exfat folder: mergeMediaProbeOverlay re-merges WS
 * `state.media` with GET /api/media on the client and keyed FILE rows on normalizeMediaIdForMatch,
 * which strips the directory. `exfat/TALK2.mp4` and `bridge/TALK2.mp4` both keyed `talk2`, and
 * preferMergedMediaId's `b.length >= a.length` tie-break keeps the longer id — `bridge/` is one
 * character longer than `exfat/`, so bridge won every single row.
 *
 * normalizeMediaIdForMatch itself must stay directory-blind: findMediaRow resolves a layer
 * source.value that carries a bare clip name with no path. */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

/* The eight files as they exist on the box, identical in both folders. */
const NAMES = [
	'06f - J Lin - Blood-based Methylation Next-Generation Sequencing Technology for Lung Cancer Screening.mp4',
	'Conference Acknowledgements 3.16.2026 rev3.mp4',
	'leader2050_intro_1.mp4',
	'leader2050_intro.mp4',
	'M_czwartek_glowki frn26_28.png',
	'pkg_belka_animowana_1_1920x200_all.mp4',
	'PKG-TypoAnim-Scene01_v5-ambicja_mix.mp4',
	'TALK2.mp4',
]

const HELPERS = '../../client/components/sources-panel-helpers.js'

describe('mergeMediaProbeOverlay folder scope', () => {
	it('keeps same-named files in bridge/ and exfat/ as separate rows', async () => {
		const { mergeMediaProbeOverlay } = await import(HELPERS)
		const stateMedia = [
			{ id: 'bridge', isDir: true },
			{ id: 'exfat', isDir: true },
			...NAMES.map((n) => ({ id: `bridge/${n}` })),
			...NAMES.map((n) => ({ id: `exfat/${n}` })),
		]
		const probeList = stateMedia.map((r) => ({ ...r, resolution: '1920×1080' }))
		const out = mergeMediaProbeOverlay(stateMedia, probeList)
		const inFolder = (p) => out.filter((r) => !r.isDir && r.id.startsWith(p)).length
		assert.equal(inFolder('bridge/'), NAMES.length, 'every bridge file survives the overlay')
		assert.equal(inFolder('exfat/'), NAMES.length, 'every exfat file survives the overlay')
		assert.ok(out.some((r) => r.id === 'exfat' && r.isDir), 'the exfat folder row is still listed')
	})

	it('still folds a CLS row onto the disk row for the same file in one folder', async () => {
		const { mergeMediaProbeOverlay } = await import(HELPERS)
		/* Caspar CLS lists clips uppercased and without an extension; the disk scan has the real
		 * filename. Those two rows are one clip and must merge, keeping the disk id + probe data. */
		const out = mergeMediaProbeOverlay(
			[{ id: 'BRIDGE/TALK2' }],
			[{ id: 'bridge/TALK2.mp4', resolution: '1920×1080' }],
		)
		assert.equal(out.length, 1, 'CLS casing + missing extension merges inside a folder')
		assert.equal(out[0].id, 'bridge/TALK2.mp4')
		assert.equal(out[0].resolution, '1920×1080')
	})

	it('normalizes separators and keeps root files distinct from nested ones', async () => {
		const { mergeMediaProbeOverlay } = await import(HELPERS)
		const out = mergeMediaProbeOverlay(
			[{ id: 'TALK2.mp4' }, { id: 'bridge/TALK2.mp4' }, { id: 'projects/a/clip.mp4' }],
			[{ id: 'bridge\\TALK2.mp4' }, { id: 'projects/b/clip.mp4' }],
		)
		const ids = out.map((r) => r.id).sort()
		assert.equal(ids.length, 4, 'backslash path merges; root and both project clips stay apart')
		assert.ok(ids.includes('TALK2.mp4'))
		assert.ok(ids.includes('projects/a/clip.mp4') && ids.includes('projects/b/clip.mp4'))
	})

	it('leaves normalizeMediaIdForMatch directory-blind for bare-name layer values', async () => {
		const { normalizeMediaIdForMatch, findMediaRow } = await import('../../client/lib/mixer-fill.js')
		assert.equal(normalizeMediaIdForMatch('exfat/TALK2.mp4'), 'talk2')
		assert.equal(normalizeMediaIdForMatch('bridge/TALK2.mp4'), 'talk2')
		assert.equal(findMediaRow([{ id: 'bridge/TALK2.mp4' }], 'TALK2')?.id, 'bridge/TALK2.mp4')
	})
})

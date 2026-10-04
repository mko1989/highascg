'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { resolvePlaylistPlayingIndex } = require('../../src/engine/scene-take-lbg-playlist')

/**
 * Owner 2026-10-03 ("sponsorzy"): Caspar's OSC names the foreground clip upper-case, under the
 * project prefix, WITHOUT extension. Basename "4" / "6" substring-matched the long item-0 name
 * ("Raben START 40 SEK 07.2026") and the AUTO chain looped 1 → 2 → "0" → 1 forever.
 */

const playlist = [
	{ value: 'Filmiki Sponsorzy/Videos Sponsors/1/Raben START 40 SEK 07.2026.mp4' },
	{ value: '2 (1 min) TVN.mp4' },
	{ value: 'Filmiki Sponsorzy/Videos Sponsors/3.mp4' },
	{ value: 'Filmiki Sponsorzy/Videos Sponsors/4.mp4' },
	{ value: 'Filmiki Sponsorzy/Videos Sponsors/5.mp4' },
	{ value: 'Filmiki Sponsorzy/Videos Sponsors/6.mp4' },
]
const osc = (rest) => `PROJECTS/NPCC/${rest}`

test('every sponsorzy clip resolves to its own index from the OSC name', () => {
	const cases = [
		[osc('FILMIKI SPONSORZY/VIDEOS SPONSORS/1/RABEN START 40 SEK 07.2026'), 0],
		[osc('2 (1 MIN) TVN'), 1],
		[osc('FILMIKI SPONSORZY/VIDEOS SPONSORS/3'), 2],
		[osc('FILMIKI SPONSORZY/VIDEOS SPONSORS/4'), 3],
		[osc('FILMIKI SPONSORZY/VIDEOS SPONSORS/5'), 4],
		[osc('FILMIKI SPONSORZY/VIDEOS SPONSORS/6'), 5],
	]
	for (const [file, want] of cases) {
		const last = (want + playlist.length - 1) % playlist.length
		assert.equal(resolvePlaylistPlayingIndex(playlist, file, last, 'prev'), want, file)
	}
})

test('a dotted name is not truncated by extension stripping', () => {
	const pl = [{ value: 'a/clip 07.2026.mp4' }, { value: 'a/clip 07.mp4' }]
	assert.equal(resolvePlaylistPlayingIndex(pl, 'A/CLIP 07.2026', 1, 'prev'), 0)
	assert.equal(resolvePlaylistPlayingIndex(pl, 'A/CLIP 07', 0, 'prev'), 1)
})

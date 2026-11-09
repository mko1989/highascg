'use strict'

/**
 * WO-1026 — the owner's two-box workflow (09.11), as data: what must be true on each server in each phase.
 *
 *   phase 1  second server: tracking cameras on DeckLink 1 + 2, vision mixer on DeckLink 3, PowerPoint on DeckLink 4,
 *            a 1080p50 PGM/PRV destination shown on that server's own monitor output only, stream + record of its PGM.
 *            main server: only the LED wall destination of the show on its DisplayPort.
 *   phase 2  tracking moves to the main server (its DeckLink 1 + 2). The second server keeps DeckLink 3 + 4 as inputs,
 *            stream + record, and sends the destination's PGM out of DeckLink 2 as well.
 *
 * Destinations are found by id (the LED wall, already in the Narvil show) and by label (the workflow's own one), the
 * rest is read off the servers: nothing here names a channel number.
 */

const STREAM_LABEL = 'Stream PGM'
const LED_ID = 'dst_mw7t9epz_1'
const MODE = { videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 }

/** The test looks (project scenes, by name) the take checks use; `slot` = the DeckLink input of the SECOND server. */
const LOOKS = { mixer: { name: '2box Mixer', slot: 3 }, ppt: { name: '2box PPT', slot: 4 }, led: { name: '2box LED' } }

const PHASES = {
	1: {
		tracking: 'peer',
		main: { decklink: { 1: 'unassigned', 2: 'unassigned', 3: 'unassigned', 4: 'unassigned' }, cameras: [] },
		peer: { decklink: { 1: 'in', 2: 'in', 3: 'in', 4: 'in' }, cameras: [1, 2], gpuOut: 'required', decklinkOut: null },
	},
	2: {
		tracking: 'main',
		main: { decklink: { 1: 'in', 2: 'in', 3: 'unassigned', 4: 'unassigned' }, cameras: [1, 2] },
		peer: { decklink: { 1: 'unassigned', 2: 'out', 3: 'in', 4: 'in' }, cameras: [], gpuOut: 'optional', decklinkOut: 2 },
	},
}

module.exports = { STREAM_LABEL, LED_ID, MODE, LOOKS, PHASES }

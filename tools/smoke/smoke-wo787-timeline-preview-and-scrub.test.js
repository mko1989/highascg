'use strict'

/**
 * WO-787 — owner 26.10: "timeline workflow is lacking. first it does not show on preview. the seek isnt smooth on the
 * screen, it makes bigger jumps." Three faults on the box (Caspar log, INTRO.mov NotchLC 3840×1792 on the 50p PRV):
 *  1. a project-scoped clip ("INTRO.mov" under projects/<slug>/) went to Caspar as stored → 404 LOAD FAILED;
 *  2. SEEK counts channel frames (WO-592) and the timeline sent its own 25 fps frames → half the playhead;
 *  3. a seek on a playing timeline was STOP + PLAY — a ruler drag reopened the 4K producer every ~30 ms.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

function makeEngine({ media, slug, chFps } = {}) {
	const wire = []
	const noop = () => Promise.resolve()
	const osc = { elapsed: NaN } // OSC file/time of 2-210 (WO-790 scrub gate)
	const self = {
		oscState: { _channels: { 2: { layers: { 210: { file: osc } } } } },
		config: { screen_count: 1, ...(media ? { local_media_path: media } : {}) },
		persistence: { get: (k) => (/slug/i.test(k) ? slug || '' : undefined) },
		variables: chFps ? { channel_2_framerate: String(chFps) } : {},
		log: () => {},
		mediaDetails: {},
		CHOICES_MEDIAFILES: [],
		amcp: {
			raw: (s) => {
				if (!/^MIXER/.test(s)) wire.push(s.replace(/\s+AF\s.*$/, ''))
				return noop()
			},
			stop: (ch, l) => {
				wire.push(`STOP ${ch}-${l}`)
				return noop()
			},
			pause: noop,
			resume: noop,
			call: (ch, l, cmd, arg) => {
				wire.push(`CALL ${ch}-${l} ${cmd} ${arg}`)
				return noop()
			},
			mixerFill: noop,
			mixerOpacity: noop,
			mixerVolume: noop,
			mixerCommit: noop,
			batchSendChunked: (lines) => {
				for (const s of lines || []) if (!/^MIXER/.test(s)) wire.push(s.replace(/\s+AF\s.*$/, ''))
				return noop()
			},
		},
	}
	const eng = new TimelineEngine(self)
	const tl = eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [
			{ id: 'l1', name: 'L1', clips: [{ id: 'c1', startTime: 0, duration: 60000, source: { value: 'INTRO.mov' } }] },
		],
	})
	eng.setSendTo({ preview: true, program: false, screenIdx: 0 })
	return { eng, tl, wire, osc }
}

test('a project-scoped clip is loaded by its project CLS id', () => {
	const media = fs.mkdtempSync(path.join(os.tmpdir(), 'wo787-'))
	fs.mkdirSync(path.join(media, 'projects', 'mhp'), { recursive: true })
	fs.writeFileSync(path.join(media, 'projects', 'mhp', 'INTRO.mov'), '')
	try {
		const { eng, tl, wire } = makeEngine({ media, slug: 'mhp' })
		eng.seek(tl.id, 10000)
		assert.deepStrictEqual(
			wire.filter((s) => /^LOAD/.test(s)),
			['LOAD 2-210 "PROJECTS/MHP/INTRO" SEEK 250']
		)
	} finally {
		fs.rmSync(media, { recursive: true, force: true })
	}
})

test('SEEK is in channel frames: 10 s of a 25 fps timeline on a 50p channel is 500', () => {
	const { eng, tl, wire } = makeEngine({ chFps: 50 })
	eng.seek(tl.id, 10000)
	assert.match(
		wire.find((s) => /^LOAD/.test(s)),
		/ SEEK 500$/
	)
	wire.length = 0
	eng.seek(tl.id, 20000)
	assert.deepStrictEqual(wire, ['CALL 2-210 SEEK 1000'], 'a paused scrub')
})

test('a drag over a playing timeline seeks in place — never STOP + PLAY', async () => {
	const { eng, tl, wire, osc } = makeEngine({ chFps: 50 })
	eng.play(tl.id, 0)
	if (eng._ticker) clearInterval(eng._ticker)
	eng._ticker = null
	wire.length = 0
	for (let ms = 30000; ms <= 31000; ms += 100) eng.seek(tl.id, ms)
	// WO-790: paced — the first target goes out at once, the rest wait for Caspar to show it
	assert.deepStrictEqual(wire, ['CALL 2-210 SEEK 1500'])
	osc.elapsed = 30
	await new Promise((r) => setTimeout(r, 30))
	assert.deepStrictEqual(wire, ['CALL 2-210 SEEK 1500', 'CALL 2-210 SEEK 1550'], 'then only the newest target')
	eng.stop(tl.id, { skipAmcp: true })
})

test('an empty channel still records its framerate; the Godot drag keeps one seek in flight (source pins)', () => {
	const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
	assert.match(
		read('src/utils/query-cycle.js'),
		/if \(chFr\) \{[\s\S]{0,80}ctx\.variables\[`channel_\$\{ch\}_framerate`\] = String\(chFr\)/
	)
	const tr = read('godot/client/features/timeline/timeline_transport.gd')
	assert.match(tr, /_seek_next = \{"id": str\(tl\.id\), "ms": ms\}\n\tif _seeking:\n\t\treturn/)
})

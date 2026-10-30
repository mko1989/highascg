'use strict'

/**
 * WO-830a items 3, 6, 7, 8 — inputs one remote request controls must not drive an unbounded loop / allocation.
 *   3. OSC `nb_channels` / `/N/dBFS` index from one UDP datagram (osc-state-audio.js)
 *   6. self-referencing / fan-out MVR Symdef and GDTF GeometryReference (mvr-scene.js, mvr-gdtf.js)
 *   7. POST /api/screens/label screenIdx and Companion page-preview rowMax / colMax
 *   8. amcp_max_batch_commands 1 or 2 → clear-stack chunkSize 0 (scene-exit-layers.js)
 * HIGHASCG_WO830A_ROOT points at another checkout (used to prove the pre-fix behaviour; the old tree hangs or OOMs).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = process.env.HIGHASCG_WO830A_ROOT || path.join(__dirname, '..', '..')
const R = (rel) => require(path.join(ROOT, rel))

describe('WO-830a OSC audio meters clamp channel count (item 3)', () => {
	const { OscState } = R('src/osc/osc-state')
	const mk = () => new OscState(() => {}, { peakHoldMs: 2000 })

	it('nb_channels 1e9 is clamped, not pushed 1e9 times', () => {
		const s = mk()
		s._routeMixerAudio(1, 'nb_channels', [1e9])
		assert.ok(s._channels[1].audio.nbChannels <= 64)
		assert.ok(s._channels[1].audio.levels.length <= 64)
	})
	it('a normal 8-channel count is untouched', () => {
		const s = mk()
		s._routeMixerAudio(1, 'nb_channels', [8])
		assert.equal(s._channels[1].audio.nbChannels, 8)
		assert.equal(s._channels[1].audio.levels.length, 8)
	})
	it('/N/dBFS with a huge meter index is ignored', () => {
		const s = mk()
		s._routeMixerAudio(1, '2/dBFS', [-20])
		assert.equal(s._routeMixerAudio(1, '900000000/dBFS', [-20]), false)
		assert.ok(s._channels[1].audio.levels.length <= 64)
	})
})

describe('WO-830a MVR / GDTF expansion is bounded (item 6)', () => {
	const { parseScene } = R('src/stage/mvr-scene')
	const { gdtfParts } = R('src/stage/mvr-gdtf')
	const SYM = (n) => Array.from({ length: n }, () => '<Symbol symdef="AAAA"><Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,0}</Matrix></Symbol>').join('')
	const scene = (symdefBody) => `<GeneralSceneDescription verMajor="1" verMinor="6"><Scene>
	<AUXData><Symdef uuid="AAAA" name="loop"><ChildList>${symdefBody}</ChildList></Symdef></AUXData>
	<Layers><Layer uuid="L1" name="L"><ChildList>
	<SceneObject uuid="O1" name="obj"><Geometries><Symbol symdef="AAAA"/></Geometries></SceneObject>
	</ChildList></Layer></Layers></Scene></GeneralSceneDescription>`
	const io = { has: () => true, resolveGdtf: async () => null }

	it('a Symdef containing 3 Symbols of itself terminates with few parts', async () => {
		const xml = scene('<Geometry3D fileName="a.3ds"/>' + SYM(3))
		const out = await parseScene(xml, io)
		assert.ok(out.report.parts <= 10, `parts=${out.report.parts}`)
	})
	it('a wide acyclic fan-out is capped per object', async () => {
		// B has 40 refs to C, C 40 refs to D, ...: 40^4 leaves from ~200 elements; the per-object visit budget cuts it.
		const defs = ['BBBB>CCCC', 'CCCC>DDDD', 'DDDD>EEEE', 'EEEE>FFFF']
			.map((d) => {
				const [id, to] = d.split('>')
				return `<Symdef uuid="${id}"><ChildList>${Array.from({ length: 40 }, () => `<Symbol symdef="${to}"/>`).join('')}</ChildList></Symdef>`
			})
			.join('') + '<Symdef uuid="FFFF"><ChildList><Geometry3D fileName="a.3ds"/></ChildList></Symdef>'
		const xml = `<GeneralSceneDescription><Scene><AUXData>${defs}</AUXData><Layers><Layer uuid="L" name="L"><ChildList>
			<SceneObject uuid="O" name="o"><Geometries><Symbol symdef="BBBB"/></Geometries></SceneObject></ChildList></Layer></Layers></Scene></GeneralSceneDescription>`
		const out = await parseScene(xml, io)
		assert.ok(out.report.parts <= 4096, `parts=${out.report.parts}`)
	})
	it('a normal symbol used twice still yields both placements', async () => {
		const xml = `<GeneralSceneDescription><Scene><AUXData><Symdef uuid="SSSS"><ChildList><Geometry3D fileName="a.3ds"/></ChildList></Symdef></AUXData>
			<Layers><Layer uuid="L" name="L"><ChildList><SceneObject uuid="O" name="o"><Geometries><Symbol symdef="SSSS"/><Symbol symdef="SSSS"/></Geometries></SceneObject></ChildList></Layer></Layers></Scene></GeneralSceneDescription>`
		const out = await parseScene(xml, io)
		assert.equal(out.report.parts, 2)
	})

	const gdtf = (geoms) => `<GDTF><FixtureType Name="x"><Models><Model Name="m" File="" PrimitiveType="Cube" Length="1" Width="1" Height="1"/></Models>
		<Geometries>${geoms}</Geometries><DMXModes><DMXMode Name="d" Geometry="A"/></DMXModes></FixtureType></GDTF>`
	it('GDTF: A→B, B→A GeometryReference cycle terminates', async () => {
		const xml = gdtf(
			'<Geometry Name="A" Model="m"><GeometryReference Geometry="B"/><GeometryReference Geometry="B"/></Geometry>' +
				'<Geometry Name="B" Model="m"><GeometryReference Geometry="A"/><GeometryReference Geometry="A"/></Geometry>',
		)
		const out = await gdtfParts(xml, 'd', () => false)
		assert.ok(out.parts.length >= 1 && out.parts.length <= 512, `parts=${out.parts.length}`)
	})
	it('GDTF: an ordinary reference to a sibling geometry is still placed', async () => {
		const xml = gdtf('<Geometry Name="A" Model="m"><GeometryReference Geometry="B"/></Geometry><Geometry Name="B" Model="m"/>')
		const out = await gdtfParts(xml, 'd', () => false)
		assert.equal(out.parts.length, 2)
	})
})

describe('WO-830a screen label index and Companion grid bounds (item 7)', () => {
	const { handlePost } = R('src/api/routes-screens')
	const handleScreenLabel = (body, ctx) => handlePost('/api/screens/label', body, ctx)
	const mkCtx = () => {
		const saved = []
		const cfg = { screenLabels: [] }
		return {
			saved,
			ctx: {
				config: cfg,
				configManager: { get: () => cfg, save: (c) => saved.push(c) },
			},
		}
	}
	it('screenIdx 1e9 → 400 and nothing is padded or saved', () => {
		const { ctx, saved } = mkCtx()
		const r = handleScreenLabel(JSON.stringify({ screenIdx: 1e9, label: 'x' }), ctx)
		assert.equal(r.status, 400)
		assert.equal(saved.length, 0)
	})
	it('screenIdx 2 still saves', () => {
		const { ctx, saved } = mkCtx()
		const r = handleScreenLabel(JSON.stringify({ screenIdx: 2, label: 'Left' }), ctx)
		assert.equal(r.status, 200)
		assert.equal(saved[0].screenLabels[2], 'Left')
	})

	const { SatellitePreviewClient } = R('src/companion/satellite-preview-client')
	const sub = async (grid) => {
		const c = new SatellitePreviewClient()
		c.configure = () => {}
		let calls = 0
		c.ensureSubscribed = async () => {
			calls++
			return { ok: true }
		}
		const r = await c.subscribePageSession({ companion: {} }, 's1', 1, grid)
		return { r, calls }
	}
	it('rowMax / colMax 1e9 are clamped to the 32 x 32 Companion page', async () => {
		const { r, calls } = await sub({ rowMax: 1e9, colMax: 1e9 })
		assert.ok(r.ok)
		assert.ok(calls <= 32 * 32, `calls=${calls}`)
	})
	it('the default grid and a small explicit grid are unchanged', async () => {
		assert.equal((await sub(undefined)).calls, 64)
		assert.equal((await sub({ rowMin: 1, rowMax: 2, colMin: 0, colMax: 3 })).calls, 8)
	})
	it('negative / inverted / NaN bounds stay finite', async () => {
		const { calls } = await sub({ rowMin: -5, rowMax: 'abc', colMin: 9, colMax: 2 })
		assert.ok(calls >= 1 && calls <= 1024)
	})
})

describe('WO-830a clear-stack chunking with a tiny AMCP batch cap (item 8)', () => {
	const { clearSceneProgramLookStackLayers } = R('src/engine/scene-exit-layers')
	for (const cap of [1, 2, 3]) {
		it(`amcp_max_batch_commands=${cap} terminates and clears layers 996 + 998`, async () => {
			let batches = 0
			const stops = []
			const amcp = {
				_context: { config: { amcp_max_batch_commands: cap } },
				// A batch larger than the cap is rejected like the real client does → individual fallback.
				batchSend: async (lines) => {
					if (++batches > 50) throw new Error('runaway loop (old code never advances)')
					if (lines.length > cap) throw new Error(`batch: max ${cap} commands`)
				},
				stop: async (ch, L) => void stops.push(L),
				mixerClear: async () => {},
				mixerCommit: async () => {},
			}
			await clearSceneProgramLookStackLayers(amcp, 1, { config: {} })
			assert.ok(batches <= 50, `batches=${batches}`)
			// cap 3: one layer (3 lines) per batch → 2 batches; cap 1/2: batches rejected → per-layer fallback STOPs
			if (cap >= 3) assert.equal(batches, 2)
			else assert.deepEqual(stops.sort(), [996, 998])
		})
	}
})

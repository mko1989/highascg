'use strict'

/**
 * WO-585: server-side global border control (Companion) — slot logic, sceneId-take border overlay,
 * and the POST /api/scene/global-border handler (project / live file / AMCP stubbed).
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const ctl = require(path.join(ROOT, 'src/engine/global-border-control'))

describe('WO-585 applyControlToSlot', () => {
	it('enables an unconfigured screen from the default template', () => {
		const r = ctl.applyControlToSlot(null, { enabled: true })
		assert.equal(r.ok, true)
		assert.equal(r.wasEnabled, false)
		assert.equal(r.nowEnabled, true)
		assert.equal(r.next.type, 'border')
		assert.equal(r.next.activePgmLayer, 998)
	})

	it('toggles and keeps on/off when enabled is omitted', () => {
		const on = { ...ctl.defaultGlobalBorderSlot(), enabled: true }
		assert.equal(ctl.applyControlToSlot(on, { enabled: 'toggle' }).nowEnabled, false)
		assert.equal(ctl.applyControlToSlot(on, { params: { color: '#00ff00' } }).nowEnabled, true)
		assert.equal(ctl.applyControlToSlot(null, { enabled: 'toggle' }).nowEnabled, true)
	})

	it('merges params, forces side inside, validates type / fade / enabled', () => {
		const slot = { ...ctl.defaultGlobalBorderSlot(), params: { color: '#111111', width: 4 } }
		const r = ctl.applyControlToSlot(slot, { params: { color: '#ff0000', side: 'outside' }, fadeDuration: 10 })
		assert.deepEqual(r.next.params, { color: '#ff0000', width: 4, side: 'inside' })
		assert.equal(r.next.fadeDuration, 10)
		assert.equal(ctl.applyControlToSlot(slot, { type: 'nope' }).ok, false)
		assert.equal(ctl.applyControlToSlot(slot, { type: 'router' }).ok, false)
		assert.equal(ctl.applyControlToSlot(slot, { fadeDuration: -1 }).ok, false)
		assert.equal(ctl.applyControlToSlot(slot, { enabled: 'maybe' }).ok, false)
		assert.equal(ctl.applyControlToSlot(slot, { type: 'edge_strip' }).typeChanged, true)
	})

	it('recalls a preset (turns the border on) and rejects an empty slot', () => {
		const slot = {
			...ctl.defaultGlobalBorderSlot(),
			borderPresets: [{ slot: 2, name: 'Red', data: { type: 'glow', params: { color: '#f00' }, fadeDuration: 12 } }],
		}
		const r = ctl.applyControlToSlot(slot, { preset: 2 })
		assert.equal(r.ok, true)
		assert.equal(r.nowEnabled, true)
		assert.equal(r.next.type, 'glow')
		assert.equal(r.next.fadeDuration, 12)
		assert.equal(ctl.applyControlToSlot(slot, { preset: 1 }).ok, false)
	})
})

describe('WO-585 screenBorderCasparSlots', () => {
	const map = { programCh: (n) => n, previewCh: (n) => n + 10 }
	it('targets the active PGM layer and clears both PGM layers', () => {
		const s = ctl.screenBorderCasparSlots(map, 0, { activePgmLayer: 996 })
		assert.deepEqual(s.onAir, [{ channel: 1, layer: 996 }])
		assert.deepEqual(s.clear, [
			{ channel: 1, layer: 998 },
			{ channel: 1, layer: 996 },
		])
	})
	it('mirror-on-PRV puts the border on PRV layer 997', () => {
		const s = ctl.screenBorderCasparSlots(map, 1, { mirrorBorderOnPrv: true })
		assert.deepEqual(s.onAir, [{ channel: 12, layer: 997 }])
		assert.equal(s.clear.at(-1).layer, 997)
	})
})

describe('WO-585 withScreenGlobalBorder (sceneId-only takes)', () => {
	it("replaces the look's stale copy with the screen slot", () => {
		const look = { id: 'a', layers: [], globalBorder: { enabled: false, type: 'border' } }
		const project = { scenes: { globalBorders: [null, { enabled: true, type: 'glow' }] } }
		assert.deepEqual(ctl.withScreenGlobalBorder(look, project, 1).globalBorder, { enabled: true, type: 'glow' })
		assert.equal(ctl.withScreenGlobalBorder(look, project, 0).globalBorder, null)
		assert.equal(look.globalBorder.enabled, false, 'input look is not mutated')
	})
	it('leaves the look alone without a globalBorders array', () => {
		const look = { id: 'a', globalBorder: { enabled: true } }
		assert.equal(ctl.withScreenGlobalBorder(look, { scenes: {} }, 0), look)
	})
	it('the take route applies it to disk-resolved looks', () => {
		const src = require('fs').readFileSync(path.join(ROOT, 'src/api/routes-scene-take.js'), 'utf8')
		assert.match(src, /b\.incomingScene = withScreenGlobalBorderForChannel\(fromProject, ctx, channel\)/)
	})
})

describe('WO-585 POST /api/scene/global-border', () => {
	let stored
	let persisted
	let liveSet
	let sent
	let handler

	function stub(rel, exports) {
		const p = require.resolve(path.join(ROOT, rel))
		require.cache[p] = { id: p, filename: p, loaded: true, exports }
	}

	beforeEach(() => {
		for (const k of Object.keys(require.cache)) {
			if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k]
		}
		stored = {
			name: 'P',
			scenes: { scenes: [], globalBorders: [{ ...ctl.defaultGlobalBorderSlot(), params: { color: '#e63946' } }] },
		}
		persisted = null
		liveSet = null
		sent = []
		stub('src/engine/project-scenes.js', {
			loadFullProject: () => JSON.parse(JSON.stringify(stored)),
			persistProject: (_ctx, p) => {
				persisted = p
				stored = p
				return { ok: true, project: p }
			},
		})
		stub('src/api/routes-data-project-sync.js', { scheduleProjectSyncBroadcast: () => {} })
		stub('src/state/live-scene-state.js', {
			getChannel: () => ({ sceneId: 'look', scene: { id: 'look', globalBorder: { enabled: false } } }),
			setChannel: async (ch, e) => {
				liveSet = { ch, e }
			},
		})
		stub('src/engine/global-border-live.js', {
			liveFileName: (ch) => `global-border-live-${ch}.json`,
			writeGlobalBorderLiveFile: () => {},
			markCasparBorderType: () => {},
			casparBorderTypeChanged: () => false,
			clearCasparBorderType: () => {},
		})
		stub('src/api/routes-scene-shared.js', {
			getRouteMap: () => ({ screenCount: 2, programCh: (n) => n, previewCh: (n) => n + 10 }),
		})
		handler = require(path.join(ROOT, 'src/api/routes-scene-global-border')).handleGlobalBorderControl
	})

	const ctx = () => ({ amcp: { raw: async (l) => sent.push(l) }, log: () => {} })
	const call = async (body) => {
		const r = await handler(JSON.stringify(body), ctx())
		return { status: r.status, body: JSON.parse(r.body) }
	}

	it('turning on adds the template on PGM 998 with a fade, persists and syncs live state', async () => {
		const r = await call({ screen: 0, enabled: true })
		assert.equal(r.status, 200)
		assert.equal(r.body.enabled, true)
		assert.ok(sent.some((l) => /^CG 1-998 ADD 0 "pip_border"/.test(l)))
		assert.ok(sent.some((l) => /MIXER 1-998 OPACITY 1 25/.test(l)))
		assert.equal(sent.at(-1), 'MIXER 1 COMMIT')
		assert.equal(persisted.scenes.globalBorders[0].enabled, true)
		assert.equal(persisted.scenes.globalBorders[0].pgmAirSnapshot.enabled, true)
		assert.equal(liveSet.ch, 1)
		assert.equal(liveSet.e.scene.globalBorder.enabled, true)
	})

	it('a style change while on is a live update (no re-ADD)', async () => {
		await call({ screen: 0, enabled: true })
		sent = []
		const r = await call({ screen: 0, params: { color: '#00ff00' } })
		assert.equal(r.status, 200)
		assert.deepEqual(sent, [])
		assert.equal(stored.scenes.globalBorders[0].params.color, '#00ff00')
	})

	it('turning off fades both PGM layers out', async () => {
		await call({ screen: 0, enabled: true })
		sent = []
		const r = await call({ screen: 0, enabled: 'toggle' })
		assert.equal(r.body.enabled, false)
		assert.ok(sent.some((l) => /MIXER 1-998 OPACITY 0 25/.test(l)))
		assert.ok(sent.some((l) => /MIXER 1-996 OPACITY 0 25/.test(l)))
	})

	it('turning off an already-off border sends nothing', async () => {
		const r = await call({ screen: 0, enabled: false })
		assert.equal(r.status, 200)
		assert.deepEqual(sent, [])
	})

	it('preset recall while on crossfades to the idle PGM layer', async () => {
		stored.scenes.globalBorders[0].borderPresets = [{ slot: 1, name: 'A', data: { type: 'border', params: { color: '#0000ff' } } }]
		await call({ screen: 0, enabled: true })
		sent = []
		const r = await call({ screen: 0, preset: 1 })
		assert.equal(r.status, 200)
		assert.ok(sent.some((l) => /^CG 1-996 ADD/.test(l)))
		assert.ok(sent.some((l) => /MIXER 1-998 OPACITY 0/.test(l)))
		assert.equal(stored.scenes.globalBorders[0].activePgmLayer, 996)
	})

	it('rejects bad screens and empty presets', async () => {
		assert.equal((await call({ screen: 5, enabled: true })).status, 400)
		assert.equal((await call({ screen: 0, preset: 9 })).status, 400)
		assert.deepEqual(sent, [])
	})
})

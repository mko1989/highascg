'use strict'

/**
 * WO-1012 stage B2 — Zoom sources as LAYERS on a channel Caspar already runs (src/config/host-live-sources-zoom.js):
 * the first DeckLink input channel, else ONE shared Zoom host channel; layers 21/22/23 at OPACITY 0; the live input is
 * route://<ch>-<layer>. Covers placement, the AMCP plan, which entries own a channel (pinning, generator, device view,
 * device graph), the legacy stage-B migration, the route heal through a renumber, the reconnect replay (never an
 * auto-apply), and GET/POST /api/zoom/host with raw JSON-string bodies and an injected config.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const hostLive = require('../../src/config/host-live-sources')
const zoom = require('../../src/config/host-live-sources-zoom')
const { getChannelMap } = require('../../src/config/routing-map')
const { ConfigManager } = require('../../src/config/config-manager')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildGeneratedChannelOrder } = require('../../src/api/device-view-snapshot')
const { suggestConnectorsAndDevicesFromLive } = require('../../src/config/device-graph')
const { healExtraLiveSourceChannels } = require('../../src/config/live-source-route-heal')

let tmp
before(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1012-zoom-host-'))
})
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** A factory config (fixture ConfigManager, never the box's own config/), `decklink` DeckLink inputs, plus keys. */
function factoryConfig(decklink, extra = {}) {
	const dir = fs.mkdtempSync(path.join(tmp, 'cfg-'))
	const cm = new ConfigManager(dir, { info() {}, warn() {}, error() {} })
	cm.load()
	const base = cm.get()
	return { ...base, casparServer: { ...base.casparServer, decklink_input_count: decklink }, ...extra }
}
const dlChannel = (config, slot = 1) => getChannelMap(config).inputChannels.find((e) => e.kind === 'decklink' && e.slot === slot).channel
const legacy = (ch) => ({ type: 'zoom', routeType: 'zoom_host', source: 'gallery', ring: 'zoom-gallery', value: `route://${ch}-1`,
	label: 'Zoom gallery', hostChannel: ch, hostLayer: 1, sourceId: 'zoom_gallery', interactiveCapable: false, hostRole: 'zoom_host' })

describe('WO-1012 B2: placement and the AMCP plan', () => {
	it('with a DeckLink input: a layer on its channel (21/22/23), no channel of its own, nothing renumbered', () => {
		const config = factoryConfig(2, { extraLiveSources: [] })
		const before = JSON.stringify(getChannelMap(config).inputChannels)
		const ch = dlChannel(config)
		const n = hostLive.normalizeToHostLiveSource({ type: 'zoom', source: 'share' }, { config })
		assert.equal(n.routeType, 'zoom_host')
		assert.equal(n.hostOn, 'decklink_input')
		assert.equal(n.hostSlot, 1)
		assert.equal(n.hostChannel, ch)
		assert.equal(n.hostLayer, 22)
		assert.equal(n.value, `route://${ch}-22`)
		assert.equal(n.ring, 'zoom-share')
		assert.equal(n.sourceId, 'zoom_share')
		assert.ok(hostLive.isHostLiveSource(n))
		const p = zoom.normalizeZoomHostSource({ source: 'presenter' }, { config: { ...config, extraLiveSources: [n] } })
		assert.equal(p.value, `route://${ch}-21`, 'every source on the same channel, its own layer')
		const g = zoom.normalizeZoomHostSource({ source: 'gallery' }, { config })
		assert.equal(g.hostLayer, 23)

		const withZoom = { ...config, extraLiveSources: [n, p] }
		assert.deepEqual(hostLive.listHostLiveChannelEntries(withZoom), [], 'a DeckLink-hosted Zoom layer owns no channel')
		assert.equal(JSON.stringify(getChannelMap(withZoom).inputChannels), before, 'no pin: the DeckLink channels stay put')
		const xml = buildConfigXml(buildCasparGeneratorFlatConfig(withZoom))
		assert.doesNotMatch(xml, /Caspar channel \d+: Zoom host/, 'the generator makes no Zoom channel')
		assert.ok(!buildGeneratedChannelOrder({ config: withZoom }).some((r) => r.role === 'zoom_host'))
	})

	it('PLAY the ring hidden from the host channel (OPACITY 0: the layer route carries it); STOP + CLEAR', () => {
		const item = zoom.normalizeZoomHostSource({ type: 'zoom', source: 'presenter' }, { config: factoryConfig(1) })
		const ch = item.hostChannel
		assert.deepEqual(hostLive.amcpCommandsForHostLiveSource(item), [
			`PLAY ${ch}-21 SHM NAME zoom-presenter`,
			`MIXER ${ch}-21 OPACITY 0`,
			`MIXER ${ch} COMMIT`,
		])
		assert.deepEqual(zoom.zoomHostStopCommands(9, 23), ['STOP 9-23', 'MIXER 9-23 CLEAR', 'MIXER 9 COMMIT'])
	})

	it('no DeckLink input: ONE shared Zoom channel for all three — generated, pinned and listed once', () => {
		const base = factoryConfig(0, { extraLiveSources: [] })
		const free = hostLive.suggestNextHostChannel(base)
		const a = zoom.normalizeZoomHostSource({ source: 'share' }, { config: base })
		assert.equal(a.hostOn, 'zoom_channel')
		assert.equal(a.hostChannel, free)
		assert.equal(a.value, `route://${free}-22`)
		const b = zoom.normalizeZoomHostSource({ source: 'gallery' }, { config: { ...base, extraLiveSources: [a] } })
		assert.equal(b.hostChannel, free, 'the second source joins the same channel')
		const config = { ...base, extraLiveSources: [a, b] }
		const entries = hostLive.listHostLiveChannelEntries(config)
		assert.equal(entries.length, 1)
		assert.equal(entries[0].kind, 'zoom_host')
		assert.equal(entries[0].sourceId, 'zoom')
		assert.equal(entries[0].mode, hostLive.DEFAULT_HOST_MODE)
		assert.notEqual(hostLive.suggestNextHostChannel(config), free)

		const xml = buildConfigXml(buildCasparGeneratorFlatConfig(config))
		assert.equal((xml.match(/Caspar channel \d+: Zoom host/g) || []).length, 1)
		assert.match(xml, new RegExp(`Caspar channel ${free}: Zoom host[\\s\\S]*?<video-mode>1080p5000</video-mode>`))
		const order = buildGeneratedChannelOrder({ config })
		assert.deepEqual(order.filter((r) => r.role === 'zoom_host').map((r) => r.ch), [free])
		const graph = suggestConnectorsAndDevicesFromLive({ caspar: { generatedChannelOrder: order } }, config)
		assert.equal(graph.connectors.filter((c) => c.externalRef === 'host_zoom_zoom').length, 1)
		assert.deepEqual(zoom.listZoomLayerEntries(config).map((e) => e.route), [`route://${free}-22`, `route://${free}-23`])
	})

	it('a shared Zoom channel stays even when a DeckLink input appears later (no second restart)', () => {
		const a = zoom.normalizeZoomHostSource({ source: 'share' }, { config: factoryConfig(0) })
		const n = zoom.normalizeZoomHostSource({ source: 'presenter' }, { config: factoryConfig(1, { extraLiveSources: [a] }) })
		assert.equal(n.hostOn, 'zoom_channel')
		assert.equal(n.hostChannel, a.hostChannel)
	})

	it('refuses an unknown source; reads the source from sourceId or the shm value', () => {
		assert.throws(() => zoom.normalizeZoomHostSource({ type: 'zoom', source: 'webcam' }, { config: {} }), /presenter, share, gallery/)
		assert.equal(zoom.zoomSourceOf({ value: 'shm://zoom-presenter' }), 'presenter')
		assert.equal(zoom.zoomSourceOf({ sourceId: 'zoom_gallery' }), 'gallery')
	})
})

describe('WO-1012 B2: stage-B migration and the route heal', () => {
	it('a stage-B entry owns nothing (its channel drops at the next apply) and moves onto the DeckLink channel', () => {
		const config = factoryConfig(2, { extraLiveSources: [legacy(8)] })
		assert.deepEqual(hostLive.listHostLiveChannelEntries(config), [])
		assert.doesNotMatch(buildConfigXml(buildCasparGeneratorFlatConfig(config)), /Zoom host/)
		const ch = dlChannel(config)
		const n = zoom.normalizeZoomHostSource(config.extraLiveSources[0], { config })
		assert.equal(n.value, `route://${ch}-23`)
		assert.equal(n.hostOn, 'decklink_input')
		assert.equal(zoom.listZoomLayerEntries(config)[0].route, `route://${ch}-23`, 'replayed at its new place already')
	})

	it('the heal re-points a stage-B entry and follows a DeckLink renumber', () => {
		const config = factoryConfig(2, { extraLiveSources: [legacy(8)] })
		const ch = dlChannel(config)
		const notes = []
		assert.equal(healExtraLiveSourceChannels(config, (l, m) => notes.push(m)).changed, true)
		const item = config.extraLiveSources[0]
		assert.equal(item.value, `route://${ch}-23`)
		assert.equal(item.hostOn, 'decklink_input')
		assert.equal(item.hostChannel, ch)
		assert.equal(healExtraLiveSourceChannels(config).changed, false, 'stable once healed')

		// A pinned NDI host on the DeckLink's channel pushes the DeckLink inputs up one channel.
		const ndi = hostLive.normalizeNdiHostSource({ ndiName: 'HOST (cam)', hostChannel: ch }, { config })
		config.extraLiveSources.push(ndi)
		const moved = dlChannel(config)
		assert.notEqual(moved, ch)
		assert.equal(zoom.listZoomLayerEntries(config)[0].channel, moved, 'the replay follows at once')
		assert.equal(healExtraLiveSourceChannels(config).changed, true)
		assert.equal(item.value, `route://${moved}-23`)
	})

	it('a DeckLink-hosted entry on a box with no DeckLink input has no placement until a save', () => {
		const config = factoryConfig(0, { extraLiveSources: [legacy(8)] })
		assert.deepEqual(zoom.listZoomLayerEntries(config), [])
		assert.equal(healExtraLiveSourceChannels(config).changed, false)
		assert.equal(zoom.normalizeZoomHostSource(config.extraLiveSources[0], { config }).hostOn, 'zoom_channel')
	})
})

/** An applied casparcg.config with given channel role comments; returns its path. */
function appliedFile(roles) {
	const p = path.join(fs.mkdtempSync(path.join(tmp, 'caspar-')), 'casparcg.config')
	fs.writeFileSync(p, Object.entries(roles).map(([ch, r]) => `<!-- HighAsCG: Caspar channel ${ch}: ${r} -->\n`).join(''))
	return p
}

describe('WO-1012 B2: reconnect replay', () => {
	it('re-PLAYs every Zoom layer whose host channel is applied in that role; a pending one is skipped, never auto-applied', async () => {
		const base = factoryConfig(1)
		const ch = dlChannel(base)
		const share = zoom.normalizeZoomHostSource({ source: 'share' }, { config: base })
		const gallery = zoom.normalizeZoomHostSource({ source: 'gallery' }, { config: base })
		const sent = []
		const mk = (roles) => ({
			config: { ...base, casparServer: { ...base.casparServer, configPath: appliedFile(roles) }, extraLiveSources: [share, gallery] },
			gatheredInfo: { channelIds: [ch] },
			amcp: { raw: async (c) => sent.push(c) },
			log() {},
		})
		const setup = require('../../src/config/host-live-sources-setup')
		const self = mk({ [ch]: 'DeckLink input 1 (PLAY …)' })
		await setup.setupHostLiveSources(self)
		assert.deepEqual(sent.filter((c) => c.startsWith('PLAY')), [`PLAY ${ch}-22 SHM NAME zoom-share`, `PLAY ${ch}-23 SHM NAME zoom-gallery`])
		assert.ok(sent.includes(`MIXER ${ch}-23 OPACITY 0`))
		assert.deepEqual(self._hostLiveSourcesStatus.played.map((p) => p.kind), ['zoom_host', 'zoom_host'])

		sent.length = 0
		const pending = mk({ [ch]: 'Monitor / headphone mix (system-audio consumer)' })
		await setup.setupHostLiveSources(pending)
		assert.deepEqual(sent, [], 'no PLAY onto a channel Caspar runs in another role')
		assert.equal(pending._hostLiveSourcesStatus.failed[0].message, 'zoom_host_channel_not_applied')
		assert.equal(pending._hostLiveCasparAutoApplyAttempted, undefined, 'a Zoom skip never reaches the auto-apply')
	})
})

describe('WO-1012 B2: GET/POST /api/zoom/host', () => {
	function harness({ decklink = 1, roles = null, extraLiveSources = [] } = {}) {
		const handlers = {}
		const routes = {
			get: (p, fn, opt) => (handlers[`GET ${p}`] = { fn, opt }),
			post: (p, fn, opt) => (handlers[`POST ${p}`] = { fn, opt }),
		}
		require('../../src/api/routes-zoom-host').register(routes)
		const events = []
		let disk = factoryConfig(decklink, { extraLiveSources })
		const ch = decklink ? dlChannel(disk) : null
		const casparPath = appliedFile(roles || (ch ? { [ch]: 'DeckLink input 1 (PLAY …)' } : {}))
		disk = { ...disk, casparServer: { ...disk.casparServer, configPath: casparPath } }
		const ctx = {
			configManager: { get: () => disk, save: (c) => (events.push('save'), (disk = c), true) },
			gatheredInfo: { channelIds: [1, 2, 3, 4, 5, 6, 7, 8], channelXml: {} },
			state: { getStateShared: () => ({ channels: [] }) },
			amcp: { raw: async (c) => events.push(c) },
			_wsBroadcast() {},
			log() {},
		}
		// Like the live ctx: `config` cannot be assigned (the 09.11 box run threw on ctx.config = …).
		Object.defineProperty(ctx, 'config', { get: () => disk, enumerable: true })
		const get = async () => JSON.parse((await handlers['GET /api/zoom/host'].fn({ ctx })).body)
		const post = async (b) => {
			const res = await handlers['POST /api/zoom/host'].fn({ ctx, body: JSON.stringify(b) })
			return { status: res.status, json: JSON.parse(res.body) }
		}
		return { handlers, ctx, get, post, events, ch, casparPath }
	}
	const shm = (ch, layer) => ({ getStateShared: () => ({ channels: [{ id: ch, oscLayers: { [layer]: { type: 'shm' } } }] }) })

	it('registers both routes without requiring Caspar; GET lists the three sources, none configured', async () => {
		const h = harness()
		assert.equal(h.handlers['GET /api/zoom/host'].opt.requireCaspar, false)
		assert.equal(h.handlers['POST /api/zoom/host'].opt.requireCaspar, false)
		const j = await h.get()
		assert.equal(j.ok, true)
		assert.equal(j.needsRestart, false)
		assert.deepEqual(j.entries.map((e) => e.source), ['presenter', 'share', 'gallery'])
		assert.ok(j.entries.every((e) => e.configured === false && e.live === false && e.route === null))
	})

	it('enable = save + PLAY at once, no restart; live from OSC; idempotent; disable = STOP, then save', async () => {
		const h = harness()
		const ch = h.ch
		const add = await h.post({ source: 'share', enabled: true })
		assert.equal(add.status, 200)
		const e = add.json.entries.find((x) => x.source === 'share')
		assert.deepEqual([e.configured, e.hostChannel, e.hostLayer, e.route], [true, ch, 22, `route://${ch}-22`])
		assert.equal(add.json.needsRestart, false, 'the DeckLink input channel exists: no restart')
		assert.deepEqual(h.events, ['save', `PLAY ${ch}-22 SHM NAME zoom-share`, `MIXER ${ch}-22 OPACITY 0`, `MIXER ${ch} COMMIT`])
		const stored = h.ctx.config.extraLiveSources.find((x) => x.routeType === 'zoom_host')
		assert.equal(stored.value, `route://${ch}-22`, 'the Live-tab source value')

		h.ctx.state = shm(ch, 22)
		assert.equal((await h.get()).entries.find((x) => x.source === 'share').live, true)
		h.events.length = 0
		await h.post({ source: 'share', enabled: true })
		assert.deepEqual(h.events, [], 'enabling a live source again saves and sends nothing')

		const off = await h.post({ source: 'share', enabled: false })
		assert.equal(off.json.entries.find((x) => x.source === 'share').configured, false)
		assert.deepEqual(h.events, [`STOP ${ch}-22`, `MIXER ${ch}-22 CLEAR`, `MIXER ${ch} COMMIT`, 'save'])
		assert.ok(!h.ctx.config.extraLiveSources.some((x) => x.routeType === 'zoom_host'))
	})

	it('a renumbered channel the running Caspar has in another role (pending Apply): saved, no PLAY, needsRestart', async () => {
		const h = harness({ roles: { 1: 'Monitor / headphone mix' } })
		const j = (await h.post({ source: 'gallery', enabled: true })).json
		assert.equal(j.needsRestart, true)
		assert.deepEqual(h.events, ['save'])
		assert.equal((await h.post({ source: 'gallery', enabled: false })).status, 200)
		assert.deepEqual(h.events, ['save', 'save'], 'disable sends no STOP to a channel that is not ours')
	})

	it('any POST moves a stage-B entry onto its layer (one save) and plays it', async () => {
		const h = harness({ extraLiveSources: [legacy(8)] })
		assert.equal((await h.get()).entries.find((x) => x.source === 'gallery').route, `route://${h.ch}-23`)
		const j = (await h.post({ source: 'gallery', enabled: true })).json
		const g = h.ctx.config.extraLiveSources.find((x) => x.source === 'gallery')
		assert.deepEqual([g.value, g.hostOn, g.hostChannel], [`route://${h.ch}-23`, 'decklink_input', h.ch])
		assert.equal(j.needsRestart, false)
		assert.deepEqual(h.events.slice(0, 2), ['save', `PLAY ${h.ch}-23 SHM NAME zoom-gallery`])
	})

	it('no DeckLink input: the shared Zoom channel needs one apply, later sources play at once', async () => {
		const h = harness({ decklink: 0 })
		const j = (await h.post({ source: 'share', enabled: true })).json
		const ch = j.entries.find((x) => x.source === 'share').hostChannel
		assert.equal(j.needsRestart, true)
		assert.deepEqual(h.events, ['save'])
		fs.writeFileSync(h.casparPath, buildConfigXml(buildCasparGeneratorFlatConfig(h.ctx.config)))
		h.ctx.gatheredInfo.channelIds = Array.from({ length: ch }, (_, i) => i + 1)
		const k = (await h.post({ source: 'presenter', enabled: true })).json
		assert.equal(k.needsRestart, false)
		assert.ok(h.events.includes(`PLAY ${ch}-21 SHM NAME zoom-presenter`))
	})

	it('refuses an unknown source and a non-boolean enabled; disabling an absent source saves nothing', async () => {
		const h = harness()
		assert.equal((await h.post({ source: 'webcam', enabled: true })).status, 400)
		assert.equal((await h.post({ source: 'share', enabled: 'yes' })).status, 400)
		assert.equal((await h.post({ source: 'share' })).status, 400)
		assert.equal((await h.post({ source: 'share', enabled: false })).status, 200)
		assert.deepEqual(h.events, [])
	})
})

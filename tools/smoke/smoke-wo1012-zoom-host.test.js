'use strict'

/**
 * WO-1012 stage B — Zoom sources as host channels: the zoom_host kind (src/config/host-live-sources-zoom.js), its
 * place at every host-live kind switch (generator, device view, device graph), and GET/POST /api/zoom/host
 * (src/api/routes-zoom-host.js) with raw JSON-string bodies and an injected config.
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
const { enrichExtraLiveSource } = require('../../src/config/extra-live-source-enrich')
const { authoritativeEntryForSource } = require('../../src/config/live-source-route-heal')

let tmp
before(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1012-zoom-host-'))
})
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** A factory config (fixture ConfigManager, never the box's own config/) plus extra keys. */
function factoryConfig(extra = {}) {
	const dir = fs.mkdtempSync(path.join(tmp, 'cfg-'))
	const cm = new ConfigManager(dir, { info() {}, warn() {}, error() {} })
	cm.load()
	return { ...cm.get(), ...extra }
}

describe('WO-1012 B: the zoom_host kind', () => {
	it('normalizes an entry: route, kind, role, ring, sourceId; picks the next free channel', () => {
		const config = factoryConfig({ extraLiveSources: [] })
		const free = hostLive.suggestNextHostChannel(config)
		const n = hostLive.normalizeToHostLiveSource({ type: 'zoom', source: 'share' }, { config })
		assert.equal(n.routeType, 'zoom_host')
		assert.equal(n.hostRole, 'zoom_host')
		assert.equal(n.type, 'zoom')
		assert.equal(n.source, 'share')
		assert.equal(n.ring, 'zoom-share')
		assert.equal(n.sourceId, 'zoom_share')
		assert.equal(n.label, 'Zoom share')
		assert.equal(n.hostChannel, free)
		assert.equal(n.hostLayer, 1)
		assert.equal(n.value, `route://${free}-1`)
		assert.ok(hostLive.isHostLiveSource(n))
		assert.equal(hostLive.isWebpageHostCandidate(n), false)
		assert.equal(hostLive.isNdiHostCandidate(n), false)
		assert.equal(hostLive.isBrowserDisplayCandidate(n), false)
	})

	it('keeps a given hostChannel/hostLayer, reads the source from sourceId, refuses an unknown source', () => {
		const n = zoom.normalizeZoomHostSource({ routeType: 'zoom_host', sourceId: 'zoom_gallery', hostChannel: 12, hostLayer: 3 }, { config: {} })
		assert.equal(n.source, 'gallery')
		assert.equal(n.value, 'route://12-3')
		assert.equal(zoom.zoomSourceOf({ value: 'shm://zoom-presenter' }), 'presenter')
		assert.throws(() => zoom.normalizeZoomHostSource({ type: 'zoom', source: 'webcam' }, { config: {} }), /presenter, share, gallery/)
	})

	it('AMCP plan: PLAY SHM NAME zoom-<source>, full fill, commit', () => {
		const item = zoom.normalizeZoomHostSource({ type: 'zoom', source: 'presenter', hostChannel: 9 }, { config: {} })
		assert.deepEqual(hostLive.amcpCommandsForHostLiveSource(item), [
			'PLAY 9-1 SHM NAME zoom-presenter',
			'MIXER 9-1 FILL 0 0 1 1',
			'MIXER 9 COMMIT',
		])
	})

	it('host channel entry: kind zoom_host, DEFAULT_HOST_MODE, stable destination id', () => {
		const item = zoom.normalizeZoomHostSource({ type: 'zoom', source: 'share', hostChannel: 9 }, { config: {} })
		const config = { webpage_host_channel_mode: '720p5000', extraLiveSources: [item] }
		const [e] = hostLive.listHostLiveChannelEntries(config)
		assert.equal(e.kind, 'zoom_host')
		assert.equal(e.mode, hostLive.DEFAULT_HOST_MODE, 'the ring is fixed-size: not the webpage mode')
		assert.equal(e.route, 'route://9-1')
		assert.equal(hostLive.hostChannelDestinationId('zoom_host', 9, 'zoom_share'), 'host_zoom_zoom_share')
		assert.equal(hostLive.hostChannelDestinationId('zoom_host', 9, ''), 'host_zoom_ch_9')
	})

	it('channel map, generator, device view, device graph, enrich and heal all carry the zoom channel', () => {
		const base = factoryConfig({ extraLiveSources: [] })
		const item = zoom.normalizeZoomHostSource({ type: 'zoom', source: 'share' }, { config: base })
		const config = { ...base, extraLiveSources: [item] }
		const ch = item.hostChannel
		const map = getChannelMap(config)
		const input = (map.inputChannels || []).find((x) => x.kind === 'zoom_host')
		assert.ok(input && input.channel === ch && input.route === item.value, 'routing map input entry')
		assert.notEqual(hostLive.suggestNextHostChannel(config), ch, 'the next source gets another channel')

		const xml = buildConfigXml(buildCasparGeneratorFlatConfig(config))
		const block = xml.match(new RegExp(`<!-- HighAsCG: Caspar channel ${ch}: Zoom host[\\s\\S]*?</channel>`))
		assert.ok(block, 'the generated config declares the channel as a Zoom host')
		assert.match(block[0], /SHM NAME zoom-/)
		assert.match(block[0], /<video-mode>1080p5000<\/video-mode>/)
		assert.doesNotMatch(block[0], /DeckLink/i, 'not built as a DeckLink input channel')

		const order = buildGeneratedChannelOrder({ config })
		const row = order.find((r) => r.ch === ch)
		assert.equal(row?.role, 'zoom_host')
		assert.equal(row?.sourceId, 'zoom_share')

		const graph = suggestConnectorsAndDevicesFromLive({ caspar: { generatedChannelOrder: order } }, config)
		const dst = graph.connectors.filter((c) => c.externalRef === 'host_zoom_zoom_share')
		assert.equal(dst.length, 1, 'one destination connector')
		assert.equal(dst[0].caspar?.hostRole, 'zoom_host')

		const enriched = enrichExtraLiveSource(item, { config })
		assert.equal(enriched.thumbnailChannel, ch)
		assert.equal(enriched.thumbnailLayer, 1)
		assert.equal(authoritativeEntryForSource(item, map)?.channel, ch)
	})

	it('setup replays a configured zoom entry on reconnect', async () => {
		const item = zoom.normalizeZoomHostSource({ type: 'zoom', source: 'gallery', hostChannel: 9 }, { config: {} })
		const sent = []
		const self = { config: { extraLiveSources: [item] }, amcp: { raw: async (c) => sent.push(c) }, log() {} }
		await require('../../src/config/host-live-sources-setup').setupHostLiveSources(self)
		assert.ok(sent.includes('PLAY 9-1 SHM NAME zoom-gallery'), sent.join(' | '))
		assert.equal(self._hostLiveSourcesStatus.played[0]?.kind, 'zoom_host')
	})
})

describe('WO-1012 B: GET/POST /api/zoom/host', () => {
	function harness(over = {}) {
		const handlers = {}
		const routes = {
			get: (p, fn, opt) => (handlers[`GET ${p}`] = { fn, opt }),
			post: (p, fn, opt) => (handlers[`POST ${p}`] = { fn, opt }),
		}
		require('../../src/api/routes-zoom-host').register(routes)
		const casparPath = path.join(fs.mkdtempSync(path.join(tmp, 'caspar-')), 'casparcg.config')
		fs.writeFileSync(casparPath, '<configuration><channels></channels></configuration>')
		const saved = []
		const sent = []
		const broadcasts = []
		let disk = factoryConfig({ casparServer: { configPath: casparPath }, extraLiveSources: [] })
		const ctx = {
			config: disk,
			configManager: { get: () => disk, save: (c) => (saved.push(c), (disk = c), true) },
			gatheredInfo: { channelIds: [1, 2, 3, 4, 5, 6, 7], channelXml: {} },
			state: { getStateShared: () => ({ channels: [] }) },
			amcp: { raw: async (c) => sent.push(c) },
			_wsBroadcast: (ev, v) => broadcasts.push(v),
			log() {},
			...over,
		}
		const get = async () => JSON.parse((await handlers['GET /api/zoom/host'].fn({ ctx })).body)
		const post = async (b) => {
			const res = await handlers['POST /api/zoom/host'].fn({ ctx, body: JSON.stringify(b) })
			return { status: res.status, json: JSON.parse(res.body) }
		}
		return { handlers, ctx, get, post, saved, sent, broadcasts, casparPath }
	}

	it('registers both routes without requiring Caspar', () => {
		const h = harness()
		assert.equal(h.handlers['GET /api/zoom/host'].opt.requireCaspar, false)
		assert.equal(h.handlers['POST /api/zoom/host'].opt.requireCaspar, false)
	})

	it('GET lists the three sources, none configured', async () => {
		const j = await harness().get()
		assert.equal(j.ok, true)
		assert.equal(j.needsRestart, false)
		assert.deepEqual(j.entries.map((e) => e.source), ['presenter', 'share', 'gallery'])
		assert.ok(j.entries.every((e) => e.configured === false && e.live === false && e.route === null))
	})

	it('add → saved entry, needsRestart; apply → not; live from OSC or INFO; remove → STOP + gone', async () => {
		const h = harness()
		const add = await h.post({ source: 'share', enabled: true })
		assert.equal(add.status, 200)
		const e = add.json.entries.find((x) => x.source === 'share')
		assert.equal(e.configured, true)
		assert.equal(e.route, `route://${e.hostChannel}-1`)
		assert.equal(add.json.needsRestart, true, 'the applied config has no Zoom host channel yet')
		assert.equal(h.saved.length, 1)
		const stored = h.saved[0].extraLiveSources.find((x) => x.routeType === 'zoom_host')
		assert.equal(stored.source, 'share')
		assert.equal(stored.value, e.route)
		assert.equal(h.broadcasts.at(-1)?.path, 'extraLiveSources')
		assert.deepEqual(h.sent, [], 'no PLAY onto a channel the running Caspar does not have as a Zoom host')

		assert.equal((await h.post({ source: 'share', enabled: true })).json.entries.filter((x) => x.configured).length, 1)
		assert.equal(h.saved.length, 1, 'enabling twice does not add a second entry')

		// The operator's Apply & restart: the file declares the channel, the running Caspar has it.
		const ch = e.hostChannel
		fs.writeFileSync(h.casparPath, buildConfigXml(buildCasparGeneratorFlatConfig(h.ctx.config)))
		h.ctx.gatheredInfo.channelIds = Array.from({ length: ch }, (_, i) => i + 1)
		let j = await h.get()
		assert.equal(j.needsRestart, false)
		assert.equal(j.entries.find((x) => x.source === 'share').live, false, 'nothing plays yet')

		h.ctx.gatheredInfo.channelXml[String(ch)] =
			'<channel><stage><layer><layer_1><background><producer>empty</producer></background><foreground><producer>shm</producer></foreground></layer_1></layer></stage></channel>'
		assert.equal((await h.get()).entries.find((x) => x.source === 'share').live, true, 'INFO fallback')
		h.ctx.gatheredInfo.channelXml = {}
		h.ctx.state = { getStateShared: () => ({ channels: [{ id: ch, oscLayers: { 1: { type: 'shm' } } }] }) }
		assert.equal((await h.get()).entries.find((x) => x.source === 'share').live, true, 'OSC mirror')

		// A second source after the apply: no channel for it yet → needsRestart again.
		j = (await h.post({ source: 'gallery', enabled: true })).json
		const g = j.entries.find((x) => x.source === 'gallery')
		assert.notEqual(g.hostChannel, ch)
		assert.equal(j.needsRestart, true)

		const off = await h.post({ source: 'share', enabled: false })
		assert.equal(off.json.entries.find((x) => x.source === 'share').configured, false)
		assert.ok(h.ctx.config.extraLiveSources.every((x) => x.source !== 'share'))
		assert.deepEqual(h.sent, [`STOP ${ch}-1`], 'the ring stops on its old channel')
	})

	it('enabling onto a channel the running Caspar already has as a Zoom host plays it at once', async () => {
		const h = harness()
		const config = { ...h.ctx.config, extraLiveSources: [zoom.normalizeZoomHostSource({ source: 'presenter' }, h.ctx)] }
		fs.writeFileSync(h.casparPath, buildConfigXml(buildCasparGeneratorFlatConfig(config)))
		const ch = config.extraLiveSources[0].hostChannel
		h.ctx.gatheredInfo.channelIds = Array.from({ length: ch }, (_, i) => i + 1)
		const j = (await h.post({ source: 'presenter', enabled: true })).json
		assert.equal(j.needsRestart, false)
		assert.deepEqual(h.sent, [`PLAY ${ch}-1 SHM NAME zoom-presenter`, `MIXER ${ch}-1 FILL 0 0 1 1`, `MIXER ${ch} COMMIT`])
	})

	it('refuses an unknown source and a non-boolean enabled; disabling an absent source saves nothing', async () => {
		const h = harness()
		assert.equal((await h.post({ source: 'webcam', enabled: true })).status, 400)
		assert.equal((await h.post({ source: 'share', enabled: 'yes' })).status, 400)
		assert.equal((await h.post({ source: 'share' })).status, 400)
		const r = await h.post({ source: 'share', enabled: false })
		assert.equal(r.status, 200)
		assert.equal(h.saved.length, 0)
	})

	it('needsRestart when the channel number exists but the applied config gives it another role', async () => {
		const h = harness()
		const add = (await h.post({ source: 'share', enabled: true })).json
		const ch = add.entries.find((x) => x.source === 'share').hostChannel
		h.ctx.gatheredInfo.channelIds = Array.from({ length: ch + 2 }, (_, i) => i + 1)
		fs.writeFileSync(h.casparPath, `<!-- HighAsCG: Caspar channel ${ch}: Monitor / headphone mix -->`)
		assert.equal((await h.get()).needsRestart, true)
	})
})

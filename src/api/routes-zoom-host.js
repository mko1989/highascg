'use strict'

/**
 * WO-1012 stage B2 — Zoom sources (presenter / share / gallery) as LAYERS on a channel Caspar already runs
 * (src/config/host-live-sources-zoom.js): the first DeckLink input channel, else one shared Zoom host channel.
 * The live input is route://<ch>-<layer>.
 *   GET  /api/zoom/host → { ok, entries: [{ source, hostChannel, hostLayer, route, configured, live }], needsRestart }
 *        one entry per source; an unconfigured one has hostChannel / hostLayer / route null. hostChannel / hostLayer /
 *        route are the CURRENT placement (they follow a DeckLink input through a channel renumber).
 *   POST /api/zoom/host { source, enabled: bool } → the same shape.
 *        enable = save the `extraLiveSources` entry, then PLAY the layer at once when its host channel is ready;
 *        disable = STOP the layer, then remove the entry. Any POST first moves stage-B entries (their own channel)
 *        and entries whose host moved onto the current placement (saved).
 *
 * GET is polled by the UI about once a second, so it is cheap: no XML generation, no AMCP.
 * - needsRestart: a configured entry with no placement yet (no DeckLink input and no Zoom channel), or whose host
 *   channel is not ready: the APPLIED casparcg.config does not give the channel that role (its "<!-- HighAsCG: Caspar
 *   channel N: DeckLink input <slot>" / "Zoom host" comment; re-read only on an mtime / size change), or the running
 *   Caspar lacks it (gatheredInfo.channelIds). False whenever the host channel exists — the usual case.
 * - live: the host channel is ready and the layer's producer is the shm producer — from the OSC mirror (state
 *   channels' oscLayers), else the last INFO <ch> XML (gatheredInfo.channelXml).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const zoom = require('../config/host-live-sources-zoom')
const { enrichExtraLiveSource } = require('../config/extra-live-source-enrich')

const { ZOOM_SOURCES, isZoomHostCandidate, zoomSourceOf } = zoom
const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

/** Same save path as routes-device-view.js `addExtraLiveSource` / `removeExtraLiveSource`. */
function persistConfigPatch(ctx, patch) {
	if (!ctx.configManager) {
		Object.assign(ctx.config, patch)
		return true
	}
	return ctx.configManager.save({ ...ctx.configManager.get(), ...patch })
}

/** The foreground producer of one layer: OSC mirror first, else the last INFO <ch>. */
function layerProducer(ctx, ch, layer) {
	try {
		const chans = ctx?.state?.getStateShared?.()?.channels
		const entry = Array.isArray(chans) ? chans.find((c) => Number(c?.id) === ch) : null
		const t = entry?.oscLayers?.[String(layer)]?.type
		if (t) return String(t)
	} catch {
		/* fall through to INFO */
	}
	const xml = String(ctx?.gatheredInfo?.channelXml?.[String(ch)] || '')
	const block = xml.match(new RegExp(`<layer_${layer}>([\\s\\S]*?)</layer_${layer}>`))
	const fg = block && block[1].match(/<foreground>[\s\S]*?<producer>([^<]*)<\/producer>/)
	return fg ? fg[1].trim() : ''
}

function buildStatus(ctx) {
	const config = ctx?.config || {}
	const configured = (Array.isArray(config.extraLiveSources) ? config.extraLiveSources : []).filter(isZoomHostCandidate)
	const placed = configured.length ? zoom.listZoomLayerEntries(config) : []
	let needsRestart = false
	const entries = ZOOM_SOURCES.map((source) => {
		const item = configured.find((x) => zoomSourceOf(x) === source)
		if (!item) return { source, hostChannel: null, hostLayer: null, route: null, configured: false, live: false }
		const p = placed.find((e) => e.source === source)
		if (!p) {
			needsRestart = true
			return { source, hostChannel: null, hostLayer: null, route: null, configured: true, live: false }
		}
		const ready = zoom.zoomHostChannelReady(ctx, p)
		if (!ready) needsRestart = true
		const live = ready && /shm/i.test(layerProducer(ctx, p.channel, p.layer))
		return { source, hostChannel: p.channel, hostLayer: p.layer, route: p.route, configured: true, live }
	})
	return { ok: true, entries, needsRestart }
}

function saveList(ctx, list) {
	if (!persistConfigPatch(ctx, { extraLiveSources: list })) return false
	ctx.config.extraLiveSources = list
	if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('change', { path: 'extraLiveSources', value: list })
	return true
}

/**
 * Stage-B entries (no hostOn) and entries whose host moved: re-normalized onto the current placement.
 * @returns {{ list: object[], changed: boolean }}
 */
function migrateZoomEntries(ctx, list) {
	let changed = false
	const out = list.map((x) => {
		if (!isZoomHostCandidate(x) || !zoomSourceOf(x)) return x
		const n = enrichExtraLiveSource(zoom.normalizeZoomHostSource(x, { config: { ...ctx.config, extraLiveSources: list } }), ctx)
		const same = n.value === x.value && n.hostOn === x.hostOn && Number(n.hostChannel) === Number(x.hostChannel)
		if (same) return x
		changed = true
		ctx.log?.('info', `[zoom-host] ${x.label || n.label}: ${x.value} → ${n.value} (${n.hostOn})`)
		return n
	})
	return { list: out, changed }
}

async function sendAll(ctx, cmds, what) {
	try {
		for (const cmd of cmds) await ctx.amcp.raw(cmd)
	} catch (e) {
		ctx.log?.('warn', `[zoom-host] ${what} failed: ${e?.message || e}`)
	}
}

async function setZoomHost(ctx, b) {
	const source = String(b?.source || '').trim().toLowerCase()
	if (!ZOOM_SOURCES.includes(source)) return reply(400, { ok: false, error: `source must be one of ${ZOOM_SOURCES.join(', ')}` })
	if (typeof b.enabled !== 'boolean') return reply(400, { ok: false, error: 'enabled must be true or false' })
	// ctx.config is read-only on the live ctx (assigning it threw on the box, 09.11)
	let { list, changed } = migrateZoomEntries(ctx, Array.isArray(ctx.config?.extraLiveSources) ? [...ctx.config.extraLiveSources] : [])
	const mine = (x) => isZoomHostCandidate(x) && zoomSourceOf(x) === source
	if (b.enabled) {
		if (!list.some(mine)) {
			let item
			try {
				item = enrichExtraLiveSource(zoom.normalizeZoomHostSource({ source }, { config: { ...ctx.config, extraLiveSources: list } }), ctx)
			} catch (e) {
				return reply(400, { ok: false, error: String(e?.message || e) })
			}
			list.push(item)
			changed = true
		}
		if (changed && !saveList(ctx, list)) return reply(503, { ok: false, error: 'Failed to save config' })
		// PLAY only onto a channel the running Caspar has in that role (never onto a renumbered, not yet applied one).
		const p = zoom.listZoomLayerEntries(ctx.config).find((e) => e.source === source)
		if (ctx.amcp && p && zoom.zoomHostChannelReady(ctx, p) && !/shm/i.test(layerProducer(ctx, p.channel, p.layer))) {
			await sendAll(ctx, zoom.zoomHostPlayCommands(p.channel, p.layer, p.item), `play ${p.route}`)
		}
	} else {
		const p = zoom.listZoomLayerEntries({ ...ctx.config, extraLiveSources: list }).find((e) => e.source === source)
		// Stop the ring only on a layer that is ours (the host channel in its role, playing shm).
		if (ctx.amcp && p && zoom.zoomHostChannelReady(ctx, p) && /shm/i.test(layerProducer(ctx, p.channel, p.layer))) {
			await sendAll(ctx, zoom.zoomHostStopCommands(p.channel, p.layer), `stop ${p.route}`)
		}
		if (list.some(mine)) {
			list = list.filter((x) => !mine(x))
			changed = true
		}
		if (changed && !saveList(ctx, list)) return reply(503, { ok: false, error: 'Failed to save config' })
	}
	return reply(200, buildStatus(ctx))
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/zoom/host', ({ ctx }) => reply(200, buildStatus(ctx || {})), opt)
	routes.post('/api/zoom/host', ({ ctx, body }) => setZoomHost(ctx, parseBody(body) || {}), opt)
}

module.exports = { register }

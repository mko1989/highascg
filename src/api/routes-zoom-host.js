'use strict'

/**
 * WO-1012 stage B — Zoom sources (presenter / share / gallery) as HOST CHANNELS (src/config/host-live-sources-zoom.js):
 * a dedicated Caspar channel that plays the source's ring, routed like any input (route://<ch>-<layer>).
 *   GET  /api/zoom/host → { ok, entries: [{ source, hostChannel, hostLayer, route, configured, live }], needsRestart }
 *        one entry per source; an unconfigured one has hostChannel / hostLayer / route null.
 *   POST /api/zoom/host { source, enabled: bool } → the same shape. Adds or removes the source's `extraLiveSources`
 *        entry (the save path of the Devices "add live source" edit); the channel itself arrives with
 *        Devices ▸ Apply & restart. When the running Caspar already has the channel as a Zoom host, it plays at once.
 *
 * GET is polled by the UI about once a second, so it is cheap: no XML generation, no AMCP.
 * - needsRestart: a configured entry whose channel the APPLIED casparcg.config does not declare as a Zoom host
 *   (its "<!-- HighAsCG: Caspar channel N: Zoom host" comment; the file is re-read only when its mtime/size change),
 *   or whose channel the running Caspar does not have (gatheredInfo.channelIds, from INFO at connect).
 * - live: the channel runs and its layer's producer is the shm producer — from the OSC mirror (state channels'
 *   oscLayers), else the last INFO <ch> XML (gatheredInfo.channelXml).
 */

const fs = require('fs')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { ZOOM_SOURCES, isZoomHostCandidate, zoomSourceOf, normalizeZoomHostSource } = require('../config/host-live-sources-zoom')
const { enrichExtraLiveSource } = require('../config/extra-live-source-enrich')

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

/** Same save path as routes-device-view.js `addExtraLiveSource` / `removeExtraLiveSource`. */
function persistConfigPatch(ctx, patch) {
	if (!ctx.configManager) {
		Object.assign(ctx.config, patch)
		return true
	}
	return ctx.configManager.save({ ...ctx.configManager.get(), ...patch })
}

const applied = { path: '', mtimeMs: -1, size: -1, channels: new Set() }

/** Channels the applied casparcg.config (the file Caspar starts from) declares as Zoom hosts. */
function appliedZoomChannels(ctx) {
	let p
	try {
		p = require('./routes-caspar-config').resolveCasparConfigWritePath(ctx)
		const st = fs.statSync(p)
		if (applied.path === p && applied.mtimeMs === st.mtimeMs && applied.size === st.size) return applied.channels
		const xml = fs.readFileSync(p, 'utf8')
		const channels = new Set()
		for (const m of xml.matchAll(/<!-- HighAsCG: Caspar channel (\d+): Zoom host/g)) channels.add(parseInt(m[1], 10))
		Object.assign(applied, { path: p, mtimeMs: st.mtimeMs, size: st.size, channels })
		return channels
	} catch {
		return new Set()
	}
}

/** @returns {Set<number>|null} null when nothing is known about the running Caspar yet */
function runningChannels(ctx) {
	const ids = ctx?.gatheredInfo?.channelIds
	if (!Array.isArray(ids) || ids.length === 0) return null
	return new Set(ids.map(Number))
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

function zoomEntries(ctx) {
	const list = Array.isArray(ctx?.config?.extraLiveSources) ? ctx.config.extraLiveSources : []
	return list.filter(isZoomHostCandidate)
}

function buildStatus(ctx) {
	const appliedSet = appliedZoomChannels(ctx)
	const running = runningChannels(ctx)
	const configured = zoomEntries(ctx)
	let needsRestart = false
	const entries = ZOOM_SOURCES.map((source) => {
		const item = configured.find((x) => zoomSourceOf(x) === source)
		if (!item) return { source, hostChannel: null, hostLayer: null, route: null, configured: false, live: false }
		const hostChannel = parseInt(String(item.hostChannel), 10)
		const hostLayer = parseInt(String(item.hostLayer ?? 1), 10) || 1
		const inCaspar = appliedSet.has(hostChannel) && (running == null || running.has(hostChannel))
		if (!inCaspar) needsRestart = true
		const live = inCaspar && running != null && /shm/i.test(layerProducer(ctx, hostChannel, hostLayer))
		return { source, hostChannel, hostLayer, route: `route://${hostChannel}-${hostLayer}`, configured: true, live }
	})
	return { ok: true, entries, needsRestart }
}

function saveList(ctx, list) {
	if (!persistConfigPatch(ctx, { extraLiveSources: list })) return false
	ctx.config.extraLiveSources = list
	if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('change', { path: 'extraLiveSources', value: list })
	return true
}

async function setZoomHost(ctx, b) {
	const source = String(b?.source || '').trim().toLowerCase()
	if (!ZOOM_SOURCES.includes(source)) return reply(400, { ok: false, error: `source must be one of ${ZOOM_SOURCES.join(', ')}` })
	if (typeof b.enabled !== 'boolean') return reply(400, { ok: false, error: 'enabled must be true or false' })
	ctx.config = ctx.config || {}
	const list = Array.isArray(ctx.config.extraLiveSources) ? [...ctx.config.extraLiveSources] : []
	const mine = (x) => isZoomHostCandidate(x) && zoomSourceOf(x) === source
	if (b.enabled && !list.some(mine)) {
		let item
		try {
			item = enrichExtraLiveSource(normalizeZoomHostSource({ source }, ctx), ctx)
		} catch (e) {
			return reply(400, { ok: false, error: String(e?.message || e) })
		}
		list.push(item)
		if (!saveList(ctx, list)) return reply(503, { ok: false, error: 'Failed to save config' })
		// Play now only onto a channel the running Caspar already has AS a Zoom host — never onto another role's channel.
		const running = runningChannels(ctx)
		if (ctx.amcp && running?.has(item.hostChannel) && appliedZoomChannels(ctx).has(item.hostChannel)) {
			try {
				await require('../config/host-live-sources-setup').playHostLiveSourceNow(ctx, item)
			} catch (e) {
				ctx.log?.('warn', `[zoom-host] play ${item.value} failed: ${e?.message || e}`)
			}
		}
	} else if (!b.enabled && list.some(mine)) {
		const removed = list.filter(mine)
		if (!saveList(ctx, list.filter((x) => !mine(x)))) return reply(503, { ok: false, error: 'Failed to save config' })
		for (const item of removed) {
			const ch = parseInt(String(item.hostChannel), 10)
			const layer = parseInt(String(item.hostLayer ?? 1), 10) || 1
			// Stop the ring on the old channel only while it is ours (a Zoom host per the applied config, playing shm).
			if (!ctx.amcp || !appliedZoomChannels(ctx).has(ch) || !/shm/i.test(layerProducer(ctx, ch, layer))) continue
			try {
				await ctx.amcp.raw(`STOP ${ch}-${layer}`)
			} catch (e) {
				ctx.log?.('warn', `[zoom-host] stop ${ch}-${layer} failed: ${e?.message || e}`)
			}
		}
	}
	return reply(200, buildStatus(ctx))
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/zoom/host', ({ ctx }) => reply(200, buildStatus(ctx || {})), opt)
	routes.post('/api/zoom/host', ({ ctx, body }) => setZoomHost(ctx, parseBody(body) || {}), opt)
}

module.exports = { register }

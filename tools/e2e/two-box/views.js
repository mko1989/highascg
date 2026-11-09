'use strict'

/** WO-1026 — reading one server's answers (GET /api/device-view and friends) for the two-box checks. */

const arr = (v) => (Array.isArray(v) ? v : [])

const destinations = (dv) => arr(dv?.screenDestinations?.destinations)
const destById = (dv, id) => destinations(dv).find((d) => d.id === id) || null
const destByLabel = (dv, label) => destinations(dv).find((d) => String(d.label || '').trim() === label) || null

/** { pgm, prv } Caspar channels this server generated for the destination, or null. */
function channelsOf(dv, id) {
	const it = arr(dv?.live?.caspar?.destinationIntent?.items).find((x) => x.id === id)
	if (!it) return null
	return { pgm: Number(it.pgmChannel) || null, prv: it.previewChannelGeneratedEnabled === false ? null : Number(it.previewChannelGenerated) || null }
}

const connector = (dv, id) => arr(dv?.graph?.connectors).find((c) => c.id === id) || null

/** The connectors a destination is cabled to on this server (its own device graph), with the cable's note. */
function sinksOf(dv, id) {
	return arr(dv?.graph?.edges)
		.filter((e) => e.sourceId === `dst_in_${id}`)
		.map((e) => ({ ...(connector(dv, e.sinkId) || { id: e.sinkId, kind: '?' }), note: e.note || '' }))
}

/** DeckLink slot → { dir (graph), live (the runtime row: state, hostChannel), signal (true | false | null) }. */
function decklink(dv, slot) {
	const dir = String(connector(dv, `dlsdi_${slot}`)?.caspar?.ioDirection || 'unassigned')
	const live = arr(dv?.live?.decklink?.inputs).find((i) => Number(i.slot) === slot) || null
	const open = arr(dv?.live?.decklink?.runtime?.alreadyOpen).find((o) => Number(o.device) === slot)
	return { dir, live, signal: open ? open.hasSignal === true : null }
}

/** The X output a gpu_out connector drives and what is plugged there: { name, connected, resolution, hz }. */
function gpuDisplay(dv, conn) {
	const name = String(conn?.externalRef || '')
	const c = arr(dv?.live?.gpu?.connectors).find((x) => x.name === name)
	const d = arr(dv?.live?.gpu?.displays).find((x) => x.name === name)
	return { name, connected: c?.connected === true, resolution: String(d?.resolution || ''), hz: Number(d?.refreshHz) || 0 }
}

/** `INFO` → { channel: mode } ("2 3072x1024 PLAYING"). */
function channelModes(infoText) {
	const out = {}
	for (const line of String(infoText).split('\n')) {
		const m = /^\s*(\d+)\s+(\S+)/.exec(line)
		if (m) out[Number(m[1])] = m[2]
	}
	return out
}

/** A destination's size as Caspar names a channel of it ("1080p5000", or "3072x1024" for a custom one). */
const modeName = (d) => (d.videoMode && d.videoMode !== 'custom' ? String(d.videoMode) : `${d.width}x${d.height}`)

const liveSource = (dv, slot) => arr(dv?.extraLiveSources).find((s) => s.routeType === 'decklink' && Number(s.decklinkSlot) === slot) || null

module.exports = { destinations, destById, destByLabel, channelsOf, connector, sinksOf, decklink, gpuDisplay, channelModes, modeName, liveSource }

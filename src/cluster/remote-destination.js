'use strict'

/**
 * WO-1017 — a screen destination rendered on a linked server (WO-670 "extension": cabled on that server, through its
 * own mapping node to its own outputs). The destination is shared (WO-746 show), so every box generates channels for
 * it at its own Apply; the master plays takes on its own channel for it and the fan-out (cluster-fanout.js) translates
 * them to that server's channel by destination id.
 *
 * That translation is only right while BOTH Caspars run the layout the shared destination list asks for. A destination
 * added to the show moves channel numbers on every box (a new PGM/PRV pair goes in before the input channels), and the
 * new numbers are known (channelMap, from the config) before either Caspar was restarted with them. Found live 09.11:
 * the owner's new "PGM/PRV 3" (7680x2160) maps to this box's channel 5, which its running Caspar still uses for
 * DeckLink input 1, so its input commands would have been replayed onto the other server's LED channel.
 *
 * Rule: a destination is forwarded only when its PGM (and PRV, when both boxes have one) channel runs at the same size
 * on both Caspars. The sizes are the running ones: channelMap.programResolutions / previewResolutions come from each
 * Caspar's INFO CONFIG (channel-map-from-ctx.js pickRes). Both boxes generate the same mode from the same shared
 * destination, so a difference means one of them has not applied it yet. A view without resolutions (older peer,
 * tests) is not judged.
 */

const isRes = (r) => !!r && Number(r.w) > 0 && Number(r.h) > 0
const sizeText = (r) => `${Number(r.w)}x${Number(r.h)}`

/** destination id → { idx, pgm: {w,h}|null, prv: {w,h}|null } — the running sizes of its channels on that box. */
function runningSizes(view) {
	const cm = view?.live?.caspar?.channelMap || {}
	const out = new Map()
	for (const d of view?.screenDestinations?.destinations || []) {
		if (!d || typeof d.id !== 'string') continue
		const idx = Math.max(0, parseInt(String(d.mainScreenIndex ?? 0), 10) || 0)
		const pgm = cm.programResolutions?.[idx]
		const prv = cm.previewChannels?.[idx] ? cm.previewResolutions?.[idx] : null
		out.set(d.id, { idx, pgm: isRes(pgm) ? pgm : null, prv: isRes(prv) ? prv : null })
	}
	return out
}

/**
 * '' when that destination may be forwarded, else why not (shown on the server's card).
 * @param {object} own   this box's device view (screenDestinations + live.caspar.channelMap)
 * @param {object} peer  the linked server's /api/device-view
 */
function staleLayout(own, peer, id, peerName = 'the linked server') {
	const a = runningSizes(own).get(id)
	const b = runningSizes(peer).get(id)
	if (!a || !b) return ''
	for (const bus of ['pgm', 'prv']) {
		if (!a[bus] || !b[bus]) continue
		if (a[bus].w === b[bus].w && a[bus].h === b[bus].h) continue
		const d = peer?.screenDestinations?.destinations?.find((x) => x?.id === id) || {}
		const asked = isRes({ w: d.width, h: d.height }) ? ` (${sizeText({ w: d.width, h: d.height })})` : ''
		return (
			`${String(d.label || id)}${asked}: ${bus.toUpperCase()} runs ${sizeText(a[bus])} here, ` +
			`${sizeText(b[bus])} on ${peerName}; Apply the Caspar config where it differs`
		)
	}
	return ''
}

module.exports = { runningSizes, staleLayout }

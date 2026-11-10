'use strict'

/**
 * WO-1029 — shared fakes for the smoke-wo1029-apply-* tests: a scripted Caspar (INFO <ch> in the 2.6 schema, every
 * other line recorded) and an in-memory persistence. Not a test file itself.
 */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** One layer's XML. */
function layerXml(n, L) {
	let fg
	if (L.producer === 'route') fg = `<producer>route</producer><route><channel>${L.route.channel}</channel>${L.route.layer != null ? `<layer>${L.route.layer}</layer>` : ''}</route>`
	else if (L.producer === 'html') fg = `<producer>html</producer><file><path>${esc(L.url)}</path></file>`
	else
		fg =
			`<producer>ffmpeg</producer><file><name>${esc(L.clip)}</name><path>media/${esc(L.clip)}.mov</path>` +
			`<clip>0</clip><clip>${L.len}</clip><time>${L.time}</time><time>${L.len}</time></file><loop>${!!L.loop}</loop>`
	return `<layer_${n}><foreground>${fg}<paused>${!!L.paused}</paused></foreground><background><producer>empty</producer></background></layer_${n}>`
}

/** channel → { layer → spec } → INFO XML (framerate as this build sends it: [num, den]). */
function channelXml(layers, fps = 50) {
	const body = Object.entries(layers || {})
		.map(([n, L]) => layerXml(n, L))
		.join('')
	return `<?xml version="1.0" encoding="utf-8"?>\n<channel><framerate>${fps * 1000}</framerate><framerate>1000</framerate><format>1080p${fps * 100}</format><stage><layer>${body}</layer></stage></channel>`
}

/** A scripted Caspar: `state[ch][layer] = spec`; `lines` = every non-INFO line sent. */
function fakeCaspar(state = {}, { fps = 50, failOn = null } = {}) {
	const lines = []
	return {
		state,
		lines,
		xml: async (ch) => channelXml(state[ch] || {}, fps),
		amcp: {
			isConnected: true,
			info: async (ch) => ({ data: channelXml(state[ch] || {}, fps) }),
			raw: async (line) => {
				if (failOn && failOn.test(line)) throw new Error(`refused: ${line}`)
				lines.push(line)
				return { ok: true }
			},
		},
	}
}

function memPersistence(init = {}) {
	const m = { ...init }
	return {
		data: m,
		get: (k) => m[k],
		set: (k, v) => void (m[k] = v),
		remove: (k) => void delete m[k],
		flushSync: () => {},
	}
}

/** Live look store fake (getAll / setChannel / clearChannel). */
function memLive(init = {}) {
	const all = { ...init }
	return {
		all,
		getAll: () => ({ ...all }),
		setChannel: async (ch, e) => void (all[String(ch)] = e),
		clearChannel: async (ch) => void delete all[String(ch)],
		broadcastSceneLive: () => {},
	}
}

const dests = (ids) => ({
	screenDestinations: { destinations: ids.map((id, i) => ({ id, label: id.toUpperCase(), mode: 'pgm_prv', mainScreenIndex: i })) },
})

module.exports = { channelXml, fakeCaspar, memPersistence, memLive, dests }

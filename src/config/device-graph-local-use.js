'use strict'

/**
 * WO-1029 plan 07 (C2, owner decision O3) — the "Local use" virtual connector: ONE per server (`local_use`), the sink
 * for a destination that this server keeps for local purposes only (the Zoom feed, a virtual camera, a draft, a
 * preview-only screen). With `cluster.channelsWhereCabled` on, a cable into it counts as "cabled here"
 * (destination-cabling.js SINK_KINDS) so the destination gets its Caspar channels here, and nothing else: no Caspar
 * consumer, nothing in casparcg.config (device-view-apply.js ignores a sink that is not a physical output).
 *
 * Unlike every Caspar output it takes ANY number of cables (device-graph-edges.js does not treat it as a
 * single-input output). Flag off: the jack is drawn (so a destination can be given its Local use cable BEFORE the
 * switch — the dry run refuses on a destination cabled nowhere) but nothing reads it.
 */

const { DEFAULT_DEVICE_ID } = require('./device-graph-constants')

const LOCAL_USE_ID = 'local_use'
const LOCAL_USE_LABEL = 'Local use'

const isLocalUseConnector = (c) => !!(c && c.deviceId === DEFAULT_DEVICE_ID && c.kind === 'local_use')

function localUseConnector() {
	return { id: LOCAL_USE_ID, deviceId: DEFAULT_DEVICE_ID, kind: 'local_use', index: 0, label: LOCAL_USE_LABEL }
}

/** `suggested` plus the Local use jack (once). */
function withLocalUse(suggested) {
	const s = suggested && typeof suggested === 'object' ? suggested : { devices: [], connectors: [] }
	const connectors = Array.isArray(s.connectors) ? s.connectors : []
	if (connectors.some((c) => c && c.id === LOCAL_USE_ID)) return s
	return { ...s, connectors: [...connectors, localUseConnector()] }
}

module.exports = { LOCAL_USE_ID, isLocalUseConnector, withLocalUse }

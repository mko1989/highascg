'use strict'

const { destinationsFromConfig } = require('./screen-destinations')
const { isDecklinkIoOut } = require('./decklink-io-direction')
const {
	parseDecklinkDeviceIndex,
	readDecklinkKeyFillFromConnectorCaspar,
	writeDecklinkKeyFillToCasparServer,
	applyDecklinkConsumerSettingsFromConnector,
} = require('./decklink-key-fill')

function applyDecklinkOverridesToScreens(merged, appConfig) {
	const g = appConfig?.deviceGraph
	if (!g || !Array.isArray(g.connectors)) return

	const edges = Array.isArray(g.edges) ? g.edges : []
	const destinations = destinationsFromConfig(appConfig || {})
	const byId = new Map(g.connectors.map((c) => [String(c?.id || ''), c]))
	const outgoing = new Map()
	for (const e of edges) {
		const src = String(e?.sourceId || '')
		if (!src) continue
		if (!outgoing.has(src)) outgoing.set(src, [])
		outgoing.get(src).push(String(e?.sinkId || ''))
	}

	function applyDecklinkKeyFillFromConnector(merged, prefix, connector) {
		const keyFill = readDecklinkKeyFillFromConnectorCaspar(connector?.caspar)
		if (!keyFill.enabled) return
		writeDecklinkKeyFillToCasparServer(merged, prefix, {
			fillDevice: parseDecklinkDeviceIndex(connector?.externalRef),
			keyDevice: keyFill.keyDevice,
			keyer: keyFill.keyer,
		})
	}

	function resolveDestinationSourceForConnector(sourceId) {
		const seen = new Set()
		const queue = [String(sourceId || '')]
		while (queue.length) {
			const cur = queue.shift()
			if (!cur || seen.has(cur)) continue
			seen.add(cur)
			if (cur.startsWith('dst_in_') || cur.startsWith('dst_ch') || cur.startsWith('dst_mv') || cur.startsWith('caspar_pgm_') || cur === 'caspar_mv_out') return cur
			const conn = byId.get(cur)
			if (conn?.kind === 'destination_in') {
				const did = String(conn.externalRef || '').trim()
				if (did) return `dst_in_${did}`
			}
			// Pixel mapping passthrough: input of same node can feed all node outputs.
			if (conn?.kind === 'pixel_map_out') {
				const nodeId = String(conn.deviceId || '')
				const nodeInputs = g.connectors.filter((c) => String(c?.deviceId || '') === nodeId && c?.kind === 'pixel_map_in')
				for (const ni of nodeInputs) {
					const inEdges = edges.filter((e) => String(e?.sinkId || '') === String(ni?.id || ''))
					for (const ie of inEdges) queue.push(String(ie?.sourceId || ''))
				}
			}
		}
		return ''
	}

	/**
	 * WO-275: this projection is additive — `merged` is seeded from the persisted `casparServer`
	 * blob, so a `screen_N_decklink_device` written by an *earlier* binding survives forever once
	 * the operator re-cables that physical DeckLink to a different destination. The graph is the
	 * source of truth, so before claiming `devNum` for a target, drop every other target still
	 * pointing at the same device. Without this, rebinding DeckLink 3 from "PGM 2" to "Multiview"
	 * left `screen_2_decklink_device: 3` in place and the generator emitted TWO `<decklink>`
	 * consumers on device 3 (one under the PGM 2 channel, one under multiview) — Caspar opens the
	 * screen one first, so the output kept showing PGM 2 across restarts.
	 * @param {number} devNum
	 * @param {'multiview' | number} keep - target that legitimately owns `devNum`
	 */
	function releaseDecklinkDeviceFromOtherTargets(devNum, keep) {
		if (!Number.isFinite(devNum) || devNum <= 0) return
		// Scan the full 1..16 screen key space, not just `merged.screen_count` — a stale binding on a
		// screen index that no longer exists still has to be cleared out of the flat config.
		for (let n = 1; n <= 16; n++) {
			if (keep === n) continue
			const cur = parseInt(String(merged[`screen_${n}_decklink_device`] || '0'), 10) || 0
			if (cur !== devNum) continue
			// Tiled (LED-wall) screens own the device through `screen_N_decklink_tiles`, not this key —
			// assignDecklinkToScreen refuses to touch them, so releasing them here would be inconsistent.
			const tiles = merged[`screen_${n}_decklink_tiles`]
			if (Array.isArray(tiles) && tiles.length > 0) continue
			merged[`screen_${n}_decklink_device`] = 0
			merged[`screen_${n}_decklink_key_device`] = 0
			merged[`screen_${n}_decklink_replace_screen`] = false
		}
		if (keep !== 'multiview') {
			const mv = parseInt(String(merged.multiview_decklink_device || '0'), 10) || 0
			if (mv === devNum) {
				merged.multiview_decklink_device = 0
				merged.multiview_decklink_key_device = 0
			}
		}
	}

	function assignDecklinkToScreen(n, devNum, connector) {
		const existingTiles = merged[`screen_${n}_decklink_tiles`]
		if (Array.isArray(existingTiles) && existingTiles.length > 0) return
		releaseDecklinkDeviceFromOtherTargets(devNum, n)
		merged[`screen_${n}_decklink_device`] = devNum
		if (merged[`screen_${n}_decklink_replace_screen`] === undefined) {
			merged[`screen_${n}_decklink_replace_screen`] = true
		}
		applyDecklinkKeyFillFromConnector(merged, `screen_${n}_`, connector)
		applyDecklinkConsumerSettingsFromConnector(merged, `screen_${n}_`, connector)
	}

	g.connectors.forEach((c) => {
		if (c.kind !== 'decklink_io' && c.kind !== 'decklink_out') return
		const devNum = parseInt(String(c.externalRef || ''), 10)
		if (!Number.isFinite(devNum) || devNum <= 0) return

		const incomingEdge = edges.find((e) => e.sinkId === c.id)
		if (!incomingEdge) {
			// Fallback to legacy binding if no cable exists
			if (c.kind === 'decklink_io' && !isDecklinkIoOut(c)) return
			/* WO-496 (owner: "cabling can change dynamically, but when hitting apply caspar config it
			 * needs to read what is actually connected"). A binding that a CABLE created, or that
			 * `handleUpdateConnector` SYNTHESIZED when an SDI port was merely saved as an output,
			 * describes a connection that no longer exists once the cable is gone — emitting a
			 * consumer from it is the config disagreeing with the graph. Pull the cable and Apply:
			 * no consumer. Plug it back and Apply: it returns. Bindings the operator made explicitly
			 * (dropping a DeckLink on a destination's output dot => `manual`) have no cable by
			 * design and are honoured, as are pre-WO-496 bindings with no recorded provenance —
			 * unknown must never silently blank a live SDI output. */
			const src = String(c.caspar?.bindingSource || '').toLowerCase()
			if (src === 'cable' || src === 'auto') {
				/* Skipping the connector is only half of it: `merged` is seeded from the persisted
				 * casparServer, so the `screen_N_decklink_device` this binding wrote is already in
				 * there and `config-generator-consumer-attach-screen` would emit from it regardless.
				 * Release the device from every target — nothing is cabled to it this pass. Tiled
				 * LED-wall screens are skipped inside, as always. */
				releaseDecklinkDeviceFromOtherTargets(devNum, null)
				return
			}
			const binding = c.caspar?.outputBinding
			if (binding?.type === 'screen') {
				const n = Math.min(8, Math.max(1, parseInt(String(binding.index ?? 1), 10) || 1))
				assignDecklinkToScreen(n, devNum, c)
			} else if (binding?.type === 'multiview') {
				releaseDecklinkDeviceFromOtherTargets(devNum, 'multiview')
				merged.multiview_decklink_device = devNum
				applyDecklinkKeyFillFromConnector(merged, 'multiview_', c)
				applyDecklinkConsumerSettingsFromConnector(merged, 'multiview_', c)
			}
			return
		}

		const sourceId = resolveDestinationSourceForConnector(String(incomingEdge.sourceId || ''))

		if (sourceId.startsWith('dst_in_') || sourceId.startsWith('dst_ch')) {
			// Cabled to a Destination feed
			let dest = null
			if (sourceId.startsWith('dst_in_')) {
				const destId = sourceId.slice('dst_in_'.length)
				dest = destinations.find((d) => String(d.id) === destId)
			} else {
				const n = parseInt(sourceId.slice('dst_ch'.length), 10)
				if (Number.isFinite(n) && n >= 1) {
					const idx = n - 1
					dest = destinations.find((d) => Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) === idx)
				}
			}
			if (!dest) return
			if (String(dest.mode || '') === 'multiview') {
				releaseDecklinkDeviceFromOtherTargets(devNum, 'multiview')
				merged.multiview_decklink_device = devNum
				applyDecklinkKeyFillFromConnector(merged, 'multiview_', c)
				applyDecklinkConsumerSettingsFromConnector(merged, 'multiview_', c)
			} else {
				const idx = Number.isFinite(Number(dest.mainScreenIndex)) ? Number(dest.mainScreenIndex) : 0
				const n = idx + 1
				assignDecklinkToScreen(n, devNum, c)
			}
		} else if (sourceId.startsWith('caspar_pgm_')) {
			// Cabled directly to a raw Caspar Program output
			const idx = parseInt(sourceId.slice('caspar_pgm_'.length), 10) - 1
			const n = idx + 1
			if (n > 0) assignDecklinkToScreen(n, devNum, c)
		} else if (sourceId === 'caspar_mv_out') {
			releaseDecklinkDeviceFromOtherTargets(devNum, 'multiview')
			merged.multiview_decklink_device = devNum
			applyDecklinkKeyFillFromConnector(merged, 'multiview_', c)
			applyDecklinkConsumerSettingsFromConnector(merged, 'multiview_', c)
		}
	})
}

/**
 * DeckLink tiles + GPU screen consumer can coexist; stale saved `decklink_replace_screen` must not suppress `<screen>`.
 * @param {Record<string, unknown>} merged
 */
function reconcileDecklinkScreenConsumerFlags(merged) {
	const sc = Math.min(16, Math.max(1, parseInt(String(merged.screen_count || 4), 10) || 4))
	for (let n = 1; n <= sc; n++) {
		const tiles = merged[`screen_${n}_decklink_tiles`]
		const decklinkDevice = parseInt(String(merged[`screen_${n}_decklink_device`] || '0'), 10) || 0
		const hasDecklink = decklinkDevice > 0 || (Array.isArray(tiles) && tiles.length > 0)
		if (!hasDecklink) continue
		const wantsScreen =
			merged[`screen_${n}_screen_consumer`] === true || merged[`screen_${n}_screen_consumer`] === 'true'
		merged[`screen_${n}_decklink_replace_screen`] = !wantsScreen
	}
}

module.exports = { applyDecklinkOverridesToScreens, reconcileDecklinkScreenConsumerFlags }

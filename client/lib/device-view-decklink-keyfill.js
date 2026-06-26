/**
 * DeckLink fill + key helpers (inspector + cable overlay).
 */
import { CASPAR_HOST } from '../components/device-view-helpers.js'

const DECKLINK_KINDS = new Set(['decklink_io', 'decklink_out', 'decklink_in'])

export function decklinkConnectorByDeviceIndex(payload, deviceIndex) {
	const n = parseInt(String(deviceIndex ?? ''), 10)
	if (!Number.isFinite(n) || n <= 0) return null
	const all = [...(payload?.graph?.connectors || []), ...(payload?.suggested?.connectors || [])]
	return (
		all.find(
			(c) =>
				c?.deviceId === CASPAR_HOST &&
				DECKLINK_KINDS.has(String(c?.kind || '')) &&
				parseInt(String(c?.externalRef ?? '0'), 10) === n
		) || null
	)
}

function resolveDecklinkOutputBinding(conn) {
	const ob = conn?.caspar?.outputBinding
	if (!ob || typeof ob !== 'object') return null
	const t = String(ob.type || '').toLowerCase()
	if (t === 'multiview') return { type: 'multiview' }
	if (t === 'screen') {
		const idx = parseInt(String(ob.index ?? ''), 10)
		if (Number.isFinite(idx) && idx >= 1) return { type: 'screen', screen: idx }
	}
	return null
}

function liveKeyFillForBinding(lastPayload, binding) {
	if (!binding || !lastPayload) return null
	if (binding.type === 'multiview') {
		const mv = lastPayload?.live?.decklink?.multiviewKeyFill
		return mv?.keyFill ?? mv ?? null
	}
	const outs = Array.isArray(lastPayload?.live?.decklink?.screenOutputs) ? lastPayload.live.decklink.screenOutputs : []
	const row = outs.find((o) => Number(o?.screen) === binding.screen)
	return row?.keyFill ?? null
}

export function collectDecklinkDeviceIndices(lastPayload, { exclude = 0 } = {}) {
	const seen = new Set()
	const add = (n) => {
		const v = parseInt(String(n), 10)
		if (Number.isFinite(v) && v > 0 && v !== exclude) seen.add(v)
	}
	const hw = lastPayload?.live?.decklink?.hardware?.connectors
	if (Array.isArray(hw)) {
		for (const c of hw) add(c?.device ?? c?.index ?? c?.externalRef)
	}
	const sug = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	for (const c of sug) {
		if (DECKLINK_KINDS.has(String(c?.kind || ''))) add(c?.externalRef)
	}
	const outs = Array.isArray(lastPayload?.live?.decklink?.screenOutputs) ? lastPayload.live.decklink.screenOutputs : []
	for (const o of outs) {
		add(o?.device)
		add(o?.keyFill?.keyDevice)
	}
	add(lastPayload?.live?.decklink?.multiviewDevice)
	return [...seen].sort((a, b) => a - b)
}

export function resolveDecklinkKeyFillState(conn, lastPayload) {
	const caspar = conn?.caspar && typeof conn.caspar === 'object' ? conn.caspar : {}
	const fillDevice = parseInt(String(conn?.externalRef ?? '0'), 10) || 0
	const graphKeyDev = parseInt(String(caspar.decklinkKeyDevice ?? '0'), 10) || 0
	const graphKeyFill = caspar.decklinkKeyFill === true || caspar.decklinkKeyFill === 'true'
	const graphKeyer = String(caspar.decklinkKeyer || '').trim()

	const binding = resolveDecklinkOutputBinding(conn)
	const liveKf = liveKeyFillForBinding(lastPayload, binding)
	const liveEnabled = liveKf?.enabled === true
	const liveKeyDev = parseInt(String(liveKf?.keyDevice ?? '0'), 10) || 0
	const liveKeyer = String(liveKf?.keyer || '').trim()

	const keyFillEnabled = graphKeyFill || graphKeyDev > 0 || liveEnabled || liveKeyDev > 0
	let keyDevice = graphKeyDev > 0 ? graphKeyDev : liveKeyDev
	if (!keyFillEnabled) keyDevice = 0
	const keyer = graphKeyer || liveKeyer || 'internal'

	return { fillDevice, keyFillEnabled, keyDevice, keyer, binding }
}

/** Virtual fill→key side links for the SVG overlay (not persisted graph edges). */
export function collectDecklinkKeyFillVirtualEdges(payload) {
	const edges = []
	const seen = new Set()
	const all = [...(payload?.graph?.connectors || []), ...(payload?.suggested?.connectors || [])]
	for (const conn of all) {
		if (conn?.deviceId !== CASPAR_HOST) continue
		if (conn.kind === 'decklink_io' && String(conn?.caspar?.ioDirection || 'in').toLowerCase() !== 'out') continue
		if (conn.kind !== 'decklink_io' && conn.kind !== 'decklink_out') continue

		const { keyFillEnabled, keyDevice, fillDevice } = resolveDecklinkKeyFillState(conn, payload)
		if (!keyFillEnabled || keyDevice <= 0 || keyDevice === fillDevice) continue

		const fillId = String(conn.id || '').trim()
		const keyConn = decklinkConnectorByDeviceIndex(payload, keyDevice)
		const keyId = String(keyConn?.id || '').trim()
		if (!fillId || !keyId || fillId === keyId) continue

		const id = `decklink_kf:${fillId}:${keyId}`
		if (seen.has(id)) continue
		seen.add(id)
		edges.push({ id, sourceId: fillId, sinkId: keyId, virtual: 'decklink_key_fill' })
	}
	return edges
}

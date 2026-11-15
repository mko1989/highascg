'use strict'

/**
 * WO-1084 — which screen destinations are "configured but offline" right now, and why, in the operator's words:
 * "PGM 2: DP-4/DP-5 + DP-6/DP-7 not connected — not started". One derivation for the boot log line, the Devices
 * view badge (device-view-snapshot.js `screenOutputs`) and the hot-plug log.
 *
 * Truth = the marks the run.sh screen gate left in casparcg.config (src/config/screen-connector-gate.js): a window it
 * did not start carries its channel and reason. The cable side (which GPU jacks the destination is cabled to, and
 * whether they are lit) comes from the device graph + the same `xrandr --current` heads the gate reads (a jack's
 * externalRef "DP-4/DP-5" is lit when one of those heads is connected) — only to phrase the reason. No --verbose
 * probe: that freezes X input (WO-397).
 */

const { listOfflineScreens, walkScreens } = require('../config/screen-connector-gate')

const PROGRAM_MODES = new Set(['pgm_prv', 'pgm_only', 'multiview'])

/**
 * PURE. Caspar channel → { destId, label, half } for the destinations that own `<screen>` windows.
 * @param {object} config
 * @param {{ programChannels?: Array, previewChannels?: Array, multiviewChannels?: Array }} map getChannelMap(config)
 */
function channelOwners(config, map) {
	const dests = Array.isArray(config?.screenDestinations?.destinations) ? config.screenDestinations.destinations : []
	const owners = new Map()
	const mvs = dests.filter((d) => String(d?.mode || '').toLowerCase() === 'multiview')
	for (const d of dests) {
		const mode = String(d?.mode || 'pgm_prv').toLowerCase()
		const label = String(d?.label || d?.id || 'Screen')
		if (mode === 'multiview') {
			const ch = (map?.multiviewChannels || [])[mvs.indexOf(d)] ?? map?.multiviewCh
			if (ch != null) owners.set(Number(ch), { destId: d.id, label, half: 'mv' })
			continue
		}
		if (!PROGRAM_MODES.has(mode)) continue
		const i = Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0)
		const pgm = (map?.programChannels || [])[i]
		const prv = (map?.previewChannels || [])[i]
		if (pgm != null && !owners.has(Number(pgm))) owners.set(Number(pgm), { destId: d.id, label, half: 'pgm' })
		if (prv != null && !owners.has(Number(prv))) owners.set(Number(prv), { destId: d.id, label, half: 'prv' })
	}
	return owners
}

/**
 * PURE. A destination's GPU jacks: [{ id, ref, name, connected, operator }] — `operator` = the operator's cable is on it.
 * @param {object} config
 * @param {string} destId
 * @param {Array<{ name: string, connected: boolean }>|null} heads connector-state readHeads()
 */
function destinationJacks(config, destId, heads) {
	const g = config?.deviceGraph || {}
	const conns = new Map((g.connectors || []).map((c) => [String(c?.id || ''), c]))
	const edges = Array.isArray(g.edges) ? g.edges : []
	const ops = new Set(
		(config?.screenDestinations?.destinations || [])
			.filter((d) => String(d?.mode || '').toLowerCase() === 'operator_gui')
			.map((d) => `dst_in_${d.id}`)
	)
	const lit = new Set((heads || []).filter((h) => h && h.connected).map((h) => String(h.name)))
	const out = []
	for (const e of edges) {
		if (String(e?.sourceId || '') !== `dst_in_${destId}`) continue
		const c = conns.get(String(e?.sinkId || ''))
		if (!c || (c.kind !== 'gpu_out' && c.kind !== 'gpu_output')) continue
		if (out.some((j) => j.id === c.id)) continue
		const ref = String(c.externalRef || c.label || c.id)
		const name = ref.split('/').map((n) => n.trim()).find((n) => lit.has(n)) || ''
		out.push({
			id: String(c.id),
			ref,
			name,
			connected: !!name,
			operator: edges.some((x) => String(x?.sinkId || '') === c.id && ops.has(String(x?.sourceId || ''))),
		})
	}
	return out
}

/** PURE. Why a destination's windows did not start, in words, from its jacks (falls back to the gate's reason). */
function offlineReason(jacks, gateReason) {
	const opJack = jacks.find((j) => j.operator && j.connected)
	if (opJack) return `${opJack.name || opJack.ref} is the operator screen`
	const dark = jacks.filter((j) => !j.connected)
	if (jacks.length && dark.length === jacks.length) return `${dark.map((j) => j.ref).join(' + ')} not connected`
	return String(gateReason || 'no connected screen').replace(/^ch\d+ /, '')
}

/**
 * Per destination: { id, label, state: 'live' | 'offline' | 'partial' | 'none', reason, jacks, offline: [ch…] }.
 * @param {object} config
 * @param {{ xml?: string|null, heads?: Array|null, channelMap?: object }} src
 */
function screenOutputStatus(config, src = {}) {
	const xml = typeof src.xml === 'string' ? src.xml : ''
	const owners = channelOwners(config, src.channelMap || {})
	const marks = listOfflineScreens(xml)
	const running = []
	walkScreens(xml, { includeMarked: false }, (s) => running.push(s))
	const byDest = {}
	const dests = Array.isArray(config?.screenDestinations?.destinations) ? config.screenDestinations.destinations : []
	for (const d of dests) {
		if (!PROGRAM_MODES.has(String(d?.mode || 'pgm_prv').toLowerCase())) continue
		const chs = [...owners.entries()].filter(([, o]) => o.destId === d.id).map(([ch]) => ch)
		const off = marks.filter((m) => chs.includes(m.channel))
		const on = running.filter((r) => chs.includes(r.channel))
		const jacks = destinationJacks(config, d.id, src.heads)
		const state = off.length && on.length ? 'partial' : off.length ? 'offline' : on.length ? 'live' : 'none'
		byDest[d.id] = {
			id: d.id,
			label: String(d.label || d.id),
			state,
			reason: off.length ? offlineReason(jacks, off[0].reason) : '',
			jacks,
			channels: chs,
			offline: [...new Set(off.map((m) => m.channel))],
		}
	}
	return { destinations: byDest }
}

/** Log lines for the offline destinations: "PGM 2: DP-4/DP-5 + DP-6/DP-7 not connected — not started". */
function offlineLogLines(status) {
	return Object.values(status?.destinations || {})
		.filter((d) => d.state === 'offline' || d.state === 'partial')
		.map((d) => `${d.label}: ${d.reason} — ${d.state === 'partial' ? 'some windows ' : ''}not started`)
}

/** Live: the file on disk + this machine's heads + channel map. */
function liveScreenOutputStatus(ctx, deps = {}) {
	const config = ctx?.config || {}
	let xml = deps.xml
	if (xml === undefined) {
		try {
			const p = require('../api/routes-caspar-config').resolveCasparConfigWritePath(ctx)
			xml = require('fs').readFileSync(p, 'utf8')
		} catch {
			xml = null
		}
	}
	const heads = deps.heads !== undefined ? deps.heads : require('../utils/connector-state').readHeads()
	let channelMap = deps.channelMap
	if (!channelMap) {
		try {
			channelMap = require('../config/routing-map').getChannelMap(config)
		} catch {
			channelMap = {}
		}
	}
	return screenOutputStatus(config, { xml, heads, channelMap })
}

module.exports = { channelOwners, destinationJacks, offlineReason, screenOutputStatus, offlineLogLines, liveScreenOutputStatus }

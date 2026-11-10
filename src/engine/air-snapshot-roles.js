'use strict'

/**
 * WO-1029 — Caspar channel ↔ role, so an air snapshot survives a renumbering Apply (that is often WHY one applies).
 * Roles are channel-remap.js `channelRoles` (WO-868: operator GUI, multiview, inputs, audio, monitor, stream), with the
 * program / preview roles keyed by the DESTINATION that owns the main screen (`pgm:dst_…`) instead of its index, so a
 * deleted screen does not hand its content to the one that moved into its index. Pure apart from `getChannelMap`.
 */

const { channelRoles } = require('../config/channel-remap')
const { isScreenHere } = require('../config/screen-channels')
const { routingDestinationsFromConfig, isMainBusDestinationMode } = require('../config/screen-destinations')

/** main screen index → destination id ('' when none owns it). */
function mainDestinationIds(config, count) {
	const dests = (() => {
		try {
			return routingDestinationsFromConfig(config) || []
		} catch {
			return []
		}
	})()
	const out = []
	for (let i = 0; i < count; i++) {
		const d = dests.find((x) => x && isMainBusDestinationMode(x.mode) && (parseInt(String(x.mainScreenIndex ?? 0), 10) || 0) === i)
		out.push(d?.id ? String(d.id) : '')
	}
	return out
}

/**
 * @param {object} config ctx.config
 * @param {(cfg: object) => object} [getChannelMap]
 * @returns {{ byRole: Map<string, number>, byChannel: Map<number, string>, kind: (role: string) => string, label: Map<string, string> }}
 */
function rolesOf(config, getChannelMap = (c) => require('../config/routing').getChannelMap(c)) {
	const map = getChannelMap(config || {}) || {}
	const base = channelRoles(map)
	const n = Math.max((map.programChannels || []).length, (map.previewChannels || []).length)
	const ids = mainDestinationIds(config, n)
	const labels = Array.isArray(map.screenLabels) ? map.screenLabels : []
	const byRole = new Map()
	const label = new Map()
	for (const [role, ch] of base) {
		const m = /^(pgm|prv):(\d+)$/.exec(role)
		const r = m && ids[+m[2]] ? `${m[1]}:${ids[+m[2]]}` : role
		if (!byRole.has(r)) byRole.set(r, ch)
		if (m) label.set(r, `${labels[+m[2]] || `Screen ${+m[2] + 1}`}${m[1] === 'prv' ? ' preview' : ''}`)
	}
	const byChannel = new Map()
	for (const [r, ch] of byRole) if (!byChannel.has(ch)) byChannel.set(ch, r)
	/* WO-1029 C1b: the roles of screens that EXIST but are output by another server (holes) — their content is dropped
	 * with "not on this server", never moved onto a screen that is here. Empty while the rule is off. */
	const notHere = new Set()
	if (map.channelsWhereCabled === true) {
		for (let i = 0; i < n; i++) if (ids[i] && !isScreenHere(map, i)) notHere.add(`pgm:${ids[i]}`).add(`prv:${ids[i]}`)
	}
	return { byRole, byChannel, label, kind: roleKind, notHere }
}

/** 'program' | 'preview' | 'other' — the restore order (program first). */
function roleKind(role) {
	const s = String(role || '')
	if (s.startsWith('pgm:')) return 'program'
	if (s.startsWith('prv:')) return 'preview'
	return 'other'
}

/** Plain-object form for the snapshot file (Maps do not serialise). */
function rolesToObject(roles) {
	const o = {}
	for (const [ch, r] of roles.byChannel) o[ch] = r
	return o
}

module.exports = { rolesOf, roleKind, rolesToObject }

'use strict'

/**
 * WO-1029 plan 07 (C12, §7.2-7.3) — the read-only half of the "Channels only for the screens cabled here" switch: what
 * turning `cluster.channelsWhereCabled` on (or off) would do on THIS server. Modelled on the WO-868 Operator GUI first
 * plan (operator-first-plan.js): the maps come from the same code the generator uses (getChannelMap over the flat
 * generator config), once with the flag as it is and once forced, so the dry run cannot disagree with the Apply.
 *
 * Plan: { enable, current, noop, before, after, removed, added, kept, renumbered, external, state, refusals, warnings }
 *   before / after  [{ ch, role, label }] channel tables
 *   removed         [{ label, destId, ch, reason }] screens that lose their channels here — 'cabled on <server>' | 'cabled nowhere'
 *   added           [{ label, destId, ch }] screens that get channels here (switching off)
 *   kept            labels of the screens that keep theirs · renumbered [{ label, role, from, to }]
 *   state           { keys, references, dropped } persisted channel-keyed state the switch re-keys / drops by role
 * Refusals (O10): a linked server online without the capabilities (dest-actions, channels-cabled), a destination cabled
 * nowhere (forceable: "give it a Local use cable"), content on a channel that disappears (forceable), a manual
 * casparcg.config override, virtual main channels, no destination list. Never on a switch OFF except the override.
 */

const fs = require('fs')
const { getChannelMap } = require('../config/routing')
const { buildCasparGeneratorFlatConfig } = require('../config/build-caspar-generator-config')
const { channelsWhereCabledEnabled } = require('../config/screen-channels')
const { channelRoles, buildChannelRemap, remapToObject, remapDeep, remapChannelKeyedObject, remapConfigSlices } = require('../config/channel-remap')

const CHANNEL_KEYED_STATE = ['liveScenesByProgramChannel', 'liveAudioOnlyLooksByChannel', 'programLayerBankByChannel']
const ROUTE_STATE_RE = /^(multiviewLayout(_\d+)?|scene_deck)$/
const ROUTE_RE = /^route:\/\/(\d+)(?:-\d+)?$/
const NEEDED_CAPS = ['dest-actions', 'channels-cabled']
/** Same list as operator-first-plan.js EXTERNAL_NOTES (not exported there): the outside consumers a server cannot renumber. */
const EXTERNAL_NOTES = [
	'Companion buttons with hand-made "…_compose_preview_ch<N>_image" overrides',
	'REST / AMCP scripts that address a channel by number (e.g. "channel": 1 or PLAY 1-10)',
	'extra OSC listeners reading /channel/<N>/… from Caspar',
	'dev tools reading /dev/shm/highascg-ch<N> rings',
]

const withFlag = (config, on) => ({ ...config, cluster: { ...(config.cluster && typeof config.cluster === 'object' ? config.cluster : {}), channelsWhereCabled: on } })
const mapOf = (config) => getChannelMap(buildCasparGeneratorFlatConfig(config))

function screenName(map, i) {
	const l = Array.isArray(map?.screenLabels) ? String(map.screenLabels[i] || '').trim() : ''
	return l || `Screen ${i + 1}`
}

/** Channel table of one map: [{ ch, role, label }] by channel number (holes skipped). */
function describeChannels(map) {
	const rows = []
	const add = (ch, role, label) => {
		if (Number.isFinite(ch) && ch >= 1) rows.push({ ch, role, label })
	}
	;(map.operatorGuiChannels || []).forEach((c) => add(c, 'operator_gui', 'Operator GUI'))
	;(map.programChannels || []).forEach((c, i) => add(c, 'pgm', `PGM ${screenName(map, i)}`))
	;(map.previewChannels || []).forEach((c, i) => add(c, 'prv', `PRV ${screenName(map, i)}`))
	;(map.multiviewChannels || []).forEach((c, i) => add(c, 'multiview', `Multiview ${i + 1}`))
	for (const e of map.inputChannels || []) add(e.channel, e.kind, String(e.label || `${e.kind} ${e.slot ?? ''}`).trim())
	;(map.audioOnlyChannels || []).forEach((c, i) => add(c, 'audio_only', `Audio ${i + 1}`))
	add(map.monitorCh, 'monitor', 'Monitor / headphones')
	if (map.streamingDedicatedChannelSlot) add(map.streamingCh, 'stream', 'Streaming')
	return rows.sort((a, b) => a.ch - b.ch)
}

/** A role key (channel-remap.js channelRoles) → the words the operator knows it by. */
function roleLabel(map, key) {
	const [kind, a, b] = String(key).split(':')
	if (kind === 'pgm') return `PGM ${screenName(map, Number(a))}`
	if (kind === 'prv') return `PRV ${screenName(map, Number(a))}`
	if (kind === 'opgui') return 'Operator GUI'
	if (kind === 'mv') return `Multiview ${Number(a) + 1}`
	if (kind === 'in') {
		const e = (map.inputChannels || []).find((x) => String(x.kind) === a && String(x.slot) === String(b))
		return String(e?.label || `${a} ${b}`)
	}
	if (kind === 'host') return `${a} ${b}`
	if (kind === 'audio') return `Audio ${Number(a) + 1}`
	return key === 'monitor' ? 'Monitor / headphones' : key === 'stream' ? 'Streaming' : key
}

/** Old channels whose role is gone from the new map (their persisted entries are dropped, never renumbered). */
function vanishedChannels(oldMap, newMap) {
	const after = channelRoles(newMap)
	const out = new Set()
	for (const [role, ch] of channelRoles(oldMap)) if (!after.has(role)) out.add(ch)
	return out
}

/** `route://<vanished>` strings become null (a placeholder cell, never another role's channel). */
function nullVanishedRoutes(value, gone, stats) {
	if (typeof value === 'string') {
		const m = value.match(ROUTE_RE)
		if (m && gone.has(parseInt(m[1], 10))) {
			stats.count++
			return null
		}
		return value
	}
	if (Array.isArray(value)) return value.map((x) => nullVanishedRoutes(x, gone, stats))
	if (value && typeof value === 'object') {
		const o = {}
		for (const [k, v] of Object.entries(value)) o[k] = nullVanishedRoutes(v, gone, stats)
		return o
	}
	return value
}

/**
 * The persisted channel-keyed state after the switch: entries of vanished channels dropped (copy channels never held a
 * screen's content), the rest re-keyed by role in one simultaneous pass. Pure.
 * @returns {{ next: Record<string, unknown>, keys: string[], references: number, dropped: number }}
 */
function remapState(all, remap, gone) {
	const next = {}
	const keys = []
	let references = 0
	let dropped = 0
	for (const [key, value] of Object.entries(all || {})) {
		const stats = { count: 0 }
		let out
		if (CHANNEL_KEYED_STATE.includes(key)) {
			const kept = {}
			for (const [k, v] of Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {})) {
				if (String(parseInt(k, 10)) === k && gone.has(parseInt(k, 10))) dropped++
				else kept[k] = nullVanishedRoutes(v, gone, stats)
			}
			out = remapChannelKeyedObject(kept, remap, stats)
		} else if (ROUTE_STATE_RE.test(key)) out = remapDeep(nullVanishedRoutes(value, gone, stats), remap, stats)
		else continue
		if (stats.count || out && JSON.stringify(out) !== JSON.stringify(value)) {
			next[key] = out
			keys.push(key)
			references += stats.count
		}
	}
	return { next, keys, references, dropped }
}

/** Project files whose looks name a channel that moves or vanishes (the switch does not rewrite shared shows: warning only). */
function projectRouteRefs(remap, gone) {
	let count = 0
	try {
		const dir = require('../engine/project-store').projectsDir()
		const { listProjectFiles } = require('./operator-first-plan')
		for (const f of listProjectFiles(dir)) {
			let text
			try {
				text = fs.readFileSync(f, 'utf8')
			} catch {
				continue
			}
			for (const m of text.matchAll(/route:\/\/(\d+)/g)) {
				const n = parseInt(m[1], 10)
				if (gone.has(n) || (remap.has(n) && remap.get(n) !== n)) count++
			}
		}
	} catch {
		/* no project store */
	}
	return count
}

/** Linked servers as { id, name, online, caps } (empty without a cluster). */
function peersOf(ctx) {
	try {
		return (ctx?._cluster?.snapshot?.().peers || []).map((p) => ({ id: p.id, name: p.name || p.id, online: p.online === true, caps: Array.isArray(p.caps) ? p.caps : [] }))
	} catch {
		return []
	}
}

function ownersOf(ctx, destId) {
	try {
		return (ctx?._destOwnerIndex || require('../cluster/dest-owners').ownerIndexOf(ctx))?.ownersOf?.(destId) || []
	} catch {
		return []
	}
}

/** Channels carrying content (tracked layers or a live look) among `chs`. Reads the ctx's own persistence. */
function onAirAmong(ctx, persistence, chs) {
	const busy = []
	let tracker = null
	try {
		tracker = require('../state/playback-tracker')
	} catch {
		/* optional */
	}
	const raw = typeof persistence?.get === 'function' ? persistence.get('liveScenesByProgramChannel') : null
	const live = raw && typeof raw === 'object' ? raw : {}
	for (const ch of chs) {
		let layers = 0
		try {
			layers = tracker ? tracker.getOccupiedLayers(ctx, ch).size : 0
		} catch {
			/* no matrix */
		}
		const look = live[String(ch)]?.sceneId ? String(live[String(ch)].sceneId) : ''
		if (layers > 0 || look) busy.push({ ch, layers, look: look || null })
	}
	return busy
}

/**
 * @param {object} ctx
 * @param {{ enable: boolean, includeProjects?: boolean }} opts
 */
function planChannelsCabled(ctx, opts) {
	const config = ctx.config || {}
	const enable = opts.enable === true
	const current = channelsWhereCabledEnabled(config)
	const oldMap = mapOf(withFlag(config, current))
	const newMap = mapOf(withFlag(config, enable))
	const refusals = []
	const warnings = []
	const rolesOld = channelRoles(oldMap)
	const rolesNew = channelRoles(newMap)
	const remap = buildChannelRemap(oldMap, newMap)
	const gone = vanishedChannels(oldMap, newMap)
	const removed = []
	const added = []
	const kept = []
	const hosts = Array.isArray(newMap.screenHosts) ? newMap.screenHosts : []
	const destLabel = (i) => screenName(newMap, i)
	for (let i = 0; i < Math.max(oldMap.programChannels?.length || 0, newMap.programChannels?.length || 0); i++) {
		const had = rolesOld.has(`pgm:${i}`)
		const has = rolesNew.has(`pgm:${i}`)
		const destId = hosts[i]?.destId || null
		if (had && !has) {
			const owners = destId ? ownersOf(ctx, destId) : []
			const reason = owners.length ? `cabled on ${owners.map((o) => o.name).join(', ')}` : 'cabled nowhere'
			removed.push({ label: destLabel(i), destId, ch: [rolesOld.get(`pgm:${i}`), rolesOld.get(`prv:${i}`)].filter(Boolean), reason })
		} else if (!had && has) added.push({ label: destLabel(i), destId, ch: [rolesNew.get(`pgm:${i}`), rolesNew.get(`prv:${i}`)].filter(Boolean) })
		else if (had && has) kept.push(destLabel(i))
	}
	const renumbered = []
	for (const [role, from] of rolesOld) {
		const to = rolesNew.get(role)
		if (to != null && to !== from) renumbered.push({ label: roleLabel(newMap, role), role, from, to })
	}
	renumbered.sort((a, b) => a.from - b.from)
	if (enable && !current) {
		const cs = config.casparServer || {}
		if (String(cs.casparConfigOverride || '').trim()) refusals.push({ code: 'config_override', message: 'A manual casparcg.config override is set; the generated channel plan would be ignored.' })
		if (oldMap.useVirtual) refusals.push({ code: 'virtual_main_channels', message: 'Virtual main channels name the PGM/PRV numbers themselves; clear them first.' })
		if (!Array.isArray(config.screenDestinations?.destinations)) refusals.push({ code: 'no_destinations', message: 'This server has no screen destination list yet.' })
		for (const p of peersOf(ctx)) {
			const missing = NEEDED_CAPS.filter((c) => !p.caps.includes(c))
			if (p.online && missing.length) refusals.push({ code: 'peer_caps', server: p.name, message: `${p.name} is online but does not advertise ${missing.join(', ')}: update it first.` })
			else if (!p.online) warnings.push({ code: 'peer_offline', server: p.name, message: `${p.name} is offline: its capabilities are unknown.` })
		}
		const nowhere = removed.filter((r) => r.reason === 'cabled nowhere')
		if (nowhere.length) {
			refusals.push({ code: 'cabled_nowhere', forceable: true, destinations: nowhere.map((r) => r.label), message: `${nowhere.map((r) => r.label).join(', ')} ${nowhere.length > 1 ? 'are' : 'is'} cabled nowhere and would get no channel on any server: give ${nowhere.length > 1 ? 'them' : 'it'} a Local use cable (Devices), or switch anyway.` })
		}
	}
	if (!enable && String(config.casparServer?.casparConfigOverride || '').trim()) {
		refusals.push({ code: 'config_override', message: 'A manual casparcg.config override is set; the generated channel plan would be ignored.' })
	}
	const persistence = ctx.persistence || require('../utils/persistence')
	const busy = gone.size && current !== enable ? onAirAmong(ctx, persistence, [...gone]) : []
	if (busy.length) refusals.push({ code: 'on_air', forceable: true, message: `Channel(s) ${busy.map((b) => b.ch).join(', ')} carry content and disappear; the Apply restarts Caspar.` })
	if (config.replication?.enabled) warnings.push({ code: 'hot_backup', message: 'Hot backup is enabled: switch the paired box too, or the follower replays commands on the wrong channels.' })
	let connected = false
	try {
		connected = require('../utils/caspar-amcp-wait').isAmcpTcpConnected(ctx) || !!ctx.amcp?.isOffline
	} catch {
		/* optional */
	}
	if (!connected) warnings.push({ code: 'caspar_down', message: 'Caspar is not connected; the new channel plan is used on its next start.' })
	const all = typeof persistence?.getAll === 'function' ? persistence.getAll() : {}
	const st = remapState(all, remap, gone)
	if (opts.includeProjects !== false && current !== enable) {
		const refs = projectRouteRefs(remap, gone)
		if (refs) warnings.push({ code: 'project_routes', count: refs, message: `${refs} route:// reference(s) in saved projects name a channel that moves or disappears; shows are not rewritten (looks are keyed by screen).` })
	}
	return {
		enable,
		current,
		noop: current === enable,
		before: describeChannels(oldMap),
		after: describeChannels(newMap),
		removed,
		added,
		kept,
		renumbered,
		remap: remapToObject(remap),
		external: EXTERNAL_NOTES,
		state: { keys: st.keys, references: st.references, dropped: st.dropped },
		refusals,
		warnings,
		_remap: remap,
		_gone: gone,
		_state: st,
		_configPatch: remapConfigSlices(config, remap).patch,
	}
}

/** The plan without its internal fields (what the API returns). */
function publicPlan(plan) {
	const out = {}
	for (const [k, v] of Object.entries(plan)) if (!k.startsWith('_')) out[k] = v
	return out
}

module.exports = { withFlag, planChannelsCabled, publicPlan }

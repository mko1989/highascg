'use strict'

/**
 * WO-868 — the read-only half of the "Operator GUI first" switch: what turning it on (or off) would do on this box.
 * `POST /api/system/operator-first {enable, dryRun: true}` returns this plan and writes nothing; the switch itself
 * (operator-first-switch.js) runs the same plan first and refuses when it carries a refusal.
 *
 * Refusals (owner decision Q4 + the WO's guards): no operator GUI destination (nothing to put first), virtual main
 * channels (the config names PGM/PRV numbers itself), mapping-fed GPU outputs (the WO-40a bbox owns the left of the
 * canvas), a manual casparcg.config override (the generated config would be bypassed), and content on a PGM channel
 * (the switch restarts Caspar; `force` overrides only this one). Warnings: hot backup enabled (the paired box must
 * flip too — the air journal replays MIXER commands by channel number), Caspar not connected.
 */

const fs = require('fs')
const path = require('path')
const { getChannelMap } = require('../config/routing')
const { isOperatorGuiFirst, withOperatorGuiFirst, CHANNEL_SCHEME_FIRST, CHANNEL_SCHEME_LEGACY } = require('../config/operator-gui-first')
const { buildChannelRemap, remapToObject, isIdentityRemap, remapDeep, remapChannelKeyedObject, remapConfigSlices } = require('../config/channel-remap')

/** Persistence keys keyed by channel number (re-keyed) and keys holding route strings (remapped in place). */
const CHANNEL_KEYED_STATE = ['liveScenesByProgramChannel', 'liveAudioOnlyLooksByChannel', 'programLayerBankByChannel']
const ROUTE_STATE_RE = /^(multiviewLayout(_\d+)?|scene_deck)$/

/** Outside consumers the server cannot renumber (listed in the dryRun so the owner can check them). */
const EXTERNAL_NOTES = [
	'Companion buttons with hand-made "…_compose_preview_ch<N>_image" overrides',
	'REST / AMCP scripts that address a channel by number (e.g. "channel": 1 or PLAY 1-10)',
	'extra OSC listeners reading /channel/<N>/… from Caspar',
	'dev tools reading /dev/shm/highascg-ch<N> rings',
]

function screenName(map, i) {
	const l = Array.isArray(map?.screenLabels) ? String(map.screenLabels[i] || '').trim() : ''
	return l || `Screen ${i + 1}`
}

/**
 * Channel table for one map: [{ ch, role, label }] by channel number.
 * @param {object} map
 */
function describeChannels(map) {
	const rows = []
	const add = (ch, role, label) => {
		if (Number.isFinite(ch) && ch >= 1) rows.push({ ch, role, label })
	}
	;(map.operatorGuiChannels || []).forEach((c) => add(c, 'operator_gui', 'Operator GUI'))
	;(map.programChannels || []).forEach((c, i) => add(c, 'pgm', `PGM ${screenName(map, i)}`))
	;(map.previewChannels || []).forEach((c, i) => add(c, 'prv', `PRV ${screenName(map, i)}`))
	;(map.multiviewChannels || []).forEach((c, i) => add(c, 'multiview', `Multiview ${i + 1}`))
	for (const e of map.inputChannels || []) add(e.channel, e.kind, String(e.label || e.kind))
	;(map.audioOnlyChannels || []).forEach((c, i) => add(c, 'audio_only', `Audio ${i + 1}`))
	add(map.monitorCh, 'monitor', 'Monitor / headphones')
	if (map.streamingDedicatedChannelSlot) add(map.streamingCh, 'stream', 'Streaming')
	return rows.sort((a, b) => a.ch - b.ch)
}

/** @param {object} config */
function layoutRows(config) {
	const { calculateLayoutPositions } = require('../utils/os-layout-calculator')
	const lay = calculateLayoutPositions(config)
	const rows = []
	const put = (kind, n, info) => {
		if (info) rows.push({ kind, n: Number(n), sysId: info.sysId, x: info.x, y: info.y, width: info.width, height: info.height })
	}
	for (const [n, info] of Object.entries(lay.operatorGui || {})) put('operator_gui', n, info)
	for (const [n, info] of Object.entries(lay.screens || {})) put('screen', n, info)
	for (const [n, info] of Object.entries(lay.multiview || {})) put('multiview', n, info)
	for (const [n, info] of Object.entries(lay.prv || {})) put('prv', n, info)
	return { rows: rows.sort((a, b) => a.x - b.x || a.y - b.y), mappingGpuOutputs: (lay.mappingGpuOutputs || []).length }
}

/** Project files the switch rewrites: projects/*.json and projects/_autosave/*.json (trash converts on restore). */
function listProjectFiles(dir) {
	const out = []
	for (const sub of ['', '_autosave']) {
		const d = path.join(dir, sub)
		let names
		try {
			names = fs.readdirSync(d)
		} catch {
			continue
		}
		for (const n of names) if (n.endsWith('.json')) out.push(path.join(d, n))
	}
	return out
}

/**
 * @param {object} ctx
 * @param {object} config live app config
 * @param {string} toScheme
 */
function planProjects(ctx, config, toScheme) {
	const { convertProjectChannelScheme } = require('../engine/project-channel-scheme')
	const projectStore = require('../engine/project-store')
	const dir = projectStore.projectsDir()
	const files = listProjectFiles(dir)
	const renumbered = []
	let stamped = 0
	let references = 0
	let unreadable = 0
	for (const f of files) {
		let project
		try {
			project = JSON.parse(fs.readFileSync(f, 'utf8'))
		} catch {
			unreadable++
			continue
		}
		const r = convertProjectChannelScheme(project, config, { toScheme, absent: CHANNEL_SCHEME_LEGACY })
		if (r.project !== project) stamped++
		if (r.converted) {
			renumbered.push({ file: path.relative(dir, f), references: r.count })
			references += r.count
		}
	}
	// a project whose own rig has no operator GUI keeps its numbers (the flag is a no-op there) and is only stamped
	return { dir, files: files.length, stamped, renumbered: renumbered.length, references, unreadable, list: renumbered }
}

/** @param {object} persistence @param {Map<number, number>} remap */
function planPersistence(persistence, remap) {
	const all = typeof persistence?.getAll === 'function' ? persistence.getAll() : {}
	const keys = []
	let references = 0
	for (const [key, value] of Object.entries(all)) {
		const stats = { count: 0 }
		if (CHANNEL_KEYED_STATE.includes(key)) remapChannelKeyedObject(value, remap, stats)
		else if (ROUTE_STATE_RE.test(key)) remapDeep(value, remap, stats)
		else continue
		if (stats.count) {
			keys.push(key)
			references += stats.count
		}
	}
	return { keys, references }
}

/** PGM channels carrying content (tracked layers or a live look). */
function programChannelsOnAir(ctx, map) {
	const busy = []
	let tracker = null
	let live = {}
	try {
		tracker = require('../state/playback-tracker')
	} catch {
		/* optional */
	}
	try {
		live = require('../state/live-scene-state').getAll() || {}
	} catch {
		/* optional */
	}
	for (const ch of map.programChannels || []) {
		const layers = tracker ? tracker.getOccupiedLayers(ctx, ch).size : 0
		const look = live[String(ch)]?.sceneId ? String(live[String(ch)].sceneId) : ''
		if (layers > 0 || look) busy.push({ ch, layers, look: look || null })
	}
	return busy
}

/**
 * @param {object} ctx
 * @param {{ enable: boolean, includeProjects?: boolean }} opts
 */
function planOperatorFirst(ctx, opts) {
	const config = ctx.config || {}
	const enable = opts.enable === true
	const current = isOperatorGuiFirst(config)
	const target = withOperatorGuiFirst(config, enable)
	const oldMap = getChannelMap(config)
	const newMap = getChannelMap(target)
	const remap = buildChannelRemap(oldMap, newMap)
	const refusals = []
	const warnings = []
	const cs = config.casparServer || {}
	if (enable && !(oldMap.operatorGuiChannels || []).length) {
		refusals.push({ code: 'no_operator_gui', message: 'No Operator GUI destination: add one in Devices first.' })
	}
	if (enable && oldMap.useVirtual) {
		refusals.push({ code: 'virtual_main_channels', message: 'Virtual main channels name the PGM/PRV numbers themselves; clear them first.' })
	}
	const before = layoutRows(config)
	const after = layoutRows(target)
	// A pixel-mapping canvas on GPU heads no longer refuses: it starts right of the operator GUI (os-layout-calculator).
	if (String(cs.casparConfigOverride || '').trim()) {
		refusals.push({ code: 'config_override', message: 'A manual casparcg.config override is set; the generated channel order would be ignored.' })
	}
	const onAir = current === enable ? [] : programChannelsOnAir(ctx, oldMap)
	if (onAir.length) {
		refusals.push({ code: 'on_air', forceable: true, message: `Program channel(s) ${onAir.map((b) => b.ch).join(', ')} carry content; the switch restarts Caspar.` })
	}
	if (config.replication?.enabled) {
		warnings.push({ code: 'hot_backup', message: 'Hot backup is enabled: switch the paired box too, or the follower replays commands on the wrong channels.' })
	}
	let connected = false
	try {
		connected = require('../utils/caspar-amcp-wait').isAmcpTcpConnected(ctx) || !!ctx.amcp?.isOffline
	} catch {
		/* optional */
	}
	if (!connected) {
		warnings.push({ code: 'caspar_down', message: 'Caspar is not connected; the new config is used on its next start.' })
	}
	const configPlan = remapConfigSlices(config, remap)
	const persistence = ctx.persistence || require('../utils/persistence')
	const toScheme = enable ? CHANNEL_SCHEME_FIRST : CHANNEL_SCHEME_LEGACY
	return {
		enable,
		current,
		noop: current === enable,
		refusals,
		warnings,
		channels: { before: describeChannels(oldMap), after: describeChannels(newMap) },
		remap: remapToObject(remap),
		remapIsIdentity: isIdentityRemap(remap),
		config: { slices: Object.keys(configPlan.patch), references: configPlan.count },
		persistence: planPersistence(persistence, remap),
		projects: opts.includeProjects === false ? null : planProjects(ctx, config, toScheme),
		layout: { before: before.rows, after: after.rows },
		external: EXTERNAL_NOTES,
		_remap: remap,
		_configPatch: configPlan.patch,
	}
}

/** The plan without its internal fields (what the API returns). */
function publicPlan(plan) {
	const { _remap, _configPatch, ...rest } = plan
	void _remap
	void _configPatch
	return rest
}

module.exports = {
	CHANNEL_KEYED_STATE,
	ROUTE_STATE_RE,
	listProjectFiles,
	planOperatorFirst,
	publicPlan,
}

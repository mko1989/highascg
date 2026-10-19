'use strict'

/**
 * WO-597 — runtime shared-memory video surfaces for native clients (Godot, WO-593).
 *
 * The operator channel's shm consumer is CONFIG (operator_gui destination `videoOutput:'shm'`,
 * config-generator-operator-gui.js). Other channels (PGM/PRV for previs, WO-607) get an shm consumer
 * only while some client needs them: clients POST the set of roles they currently draw every few
 * seconds (declarative lease); a role with no live lease is REMOVEd after the TTL. A crashed or hung
 * client therefore releases on-air channels automatically — no WS coupling needed.
 *
 * Consumer indices (WO-594 §7): 740 = operator surface (config), 741–748 = the pgm/prv roles below,
 * 749 = reserved for diagnostics/spikes, 750+N = `inN` (DeckLink input N's own channel, WO-53) and 800+N = `chN`
 * (any Caspar channel N) — the WO-616 stage-camera sources. Segment: /dev/shm/highascg-<role> (ABI caspar/modules/shm/hshm_abi.h).
 * NOTE: needs a Caspar build with the shm module (WO-594/613); ADD fails harmlessly on older builds.
 */

const SHM_INDEX_BASE = 740
const ROLE_SLOTS = { pgm1: 1, prv1: 2, pgm2: 3, prv2: 4, pgm3: 5, prv3: 6, pgm4: 7, prv4: 8 }
const INPUT_SLOT_BASE = 10 // inN → 750+N (N 1..16)
const CHANNEL_SLOT_BASE = 60 // chN → 800+N (N 1..99)

/** @returns {number|null} the role's consumer index, or null when the name is not a surface role */
function roleIndex(role) {
	const r = String(role || '')
	if (ROLE_SLOTS[r]) return SHM_INDEX_BASE + ROLE_SLOTS[r]
	let m = /^in([1-9]|1[0-6])$/.exec(r)
	if (m) return SHM_INDEX_BASE + INPUT_SLOT_BASE + Number(m[1])
	m = /^ch([1-9][0-9]?)$/.exec(r)
	if (m) return SHM_INDEX_BASE + CHANNEL_SLOT_BASE + Number(m[1])
	return null
}
const LEASE_TTL_MS = 15000
const SWEEP_EVERY_MS = 2000

/**
 * @param {string} role pgm1..pgm4 | prv1..prv4 | in1..in16 | ch1..ch99
 * @param {object} map channel map (getChannelMap)
 * @returns {number|null} Caspar channel, or null when the role has no (distinct) channel
 */
function resolveRoleChannel(role, map) {
	if (roleIndex(role) == null) return null
	const inM = /^in(\d+)$/.exec(role)
	if (inM) {
		const e = (Array.isArray(map?.inputChannels) ? map.inputChannels : []).find((x) => x?.kind === 'decklink' && Number(x.slot) === Number(inM[1]))
		return e && Number(e.channel) > 0 ? Number(e.channel) : null
	}
	const chM = /^ch(\d+)$/.exec(role)
	if (chM) {
		const known = map?.channelResolutionsByChannel
		return known && typeof known === 'object' && known[chM[1]] ? Number(chM[1]) : null // only channels Caspar has
	}
	const m = /^(pgm|prv)([1-4])$/.exec(String(role || ''))
	const idx = Number(m[2]) - 1
	const list = m[1] === 'pgm' ? map?.programChannels : map?.previewChannels
	const ch = Array.isArray(list) ? Number(list[idx]) : NaN
	if (!Number.isFinite(ch) || ch <= 0) return null
	if (m[1] === 'prv' && Number(map?.programChannels?.[idx]) === ch) return null // PGM-only main
	return ch
}

function segmentFor(role) {
	return { shm: `/highascg-${role}`, path: `/dev/shm/highascg-${role}` }
}

/**
 * @param {{ getAmcp: () => any, getChannelMap: () => any, getOperatorSurface?: () => any,
 *   now?: () => number, log?: (lvl: string, msg: string) => void }} deps
 */
function createVideoSurfaceManager(deps) {
	const now = deps.now || Date.now
	const log = deps.log || (() => {})
	/** @type {Map<string, Map<string, number>>} role -> clientId -> expiresAt */
	const leases = new Map()
	/** @type {Map<string, { channel: number, index: number }>} consumers this manager has ADDed */
	const active = new Map()

	async function add(role) {
		const channel = resolveRoleChannel(role, deps.getChannelMap())
		const amcp = deps.getAmcp()
		if (channel == null || !amcp?.basic) return false
		const index = roleIndex(role)
		try {
			const res = await amcp.basic.add(channel, 'SHM', `NAME ${role}`, index)
			if (res && res.ok === false) throw new Error(res.error || 'ADD refused')
			active.set(role, { channel, index })
			log('info', `[video-surfaces] ADD ${channel}-${index} SHM NAME ${role}`)
			return true
		} catch (e) {
			log('warn', `[video-surfaces] ADD ${channel}-${index} SHM ${role} failed: ${e?.message || e}`)
			return false
		}
	}

	async function remove(role) {
		const a = active.get(role)
		active.delete(role)
		const amcp = deps.getAmcp()
		if (!a || !amcp?.basic) return
		try {
			await amcp.basic.remove(a.channel, null, a.index)
			log('info', `[video-surfaces] REMOVE ${a.channel}-${a.index} (${role}: no leases)`)
		} catch (e) {
			log('warn', `[video-surfaces] REMOVE ${a.channel}-${a.index} failed: ${e?.message || e}`)
		}
	}

	/** Declarative lease: `roles` is the FULL set this client needs right now (others are released). */
	async function lease(clientId, roles) {
		const id = String(clientId || '').trim()
		if (!id) throw new Error('clientId required')
		const wanted = new Set((Array.isArray(roles) ? roles : []).map(String).filter((r) => roleIndex(r) != null))
		const t = now()
		for (const [role, holders] of leases) if (!wanted.has(role)) holders.delete(id)
		for (const role of wanted) {
			if (!leases.has(role)) leases.set(role, new Map())
			leases.get(role).set(id, t + LEASE_TTL_MS)
			if (!active.has(role)) await add(role)
		}
		await sweep()
		return list()
	}

	async function sweep() {
		const t = now()
		for (const [role, holders] of [...leases]) {
			for (const [id, exp] of [...holders]) if (exp <= t) holders.delete(id)
			if (holders.size === 0) {
				leases.delete(role)
				if (active.has(role)) await remove(role)
			}
		}
	}

	/** Caspar (re)connected: runtime consumers died with it — re-ADD every role that still has leases. */
	async function onCasparReady() {
		active.clear()
		for (const role of leases.keys()) await add(role)
	}

	function list() {
		const map = deps.getChannelMap() || {}
		const surfaces = []
		const op = deps.getOperatorSurface ? deps.getOperatorSurface() : null
		if (op) surfaces.push({ role: op.role, kind: 'operator', channel: op.channel, index: SHM_INDEX_BASE, active: true, leases: 0, ...segmentFor(op.role) })
		// pgm/prv always; inN for each DeckLink input; chN only while leased (99 idle rows would be noise)
		const roles = Object.keys(ROLE_SLOTS)
		for (const e of Array.isArray(map.inputChannels) ? map.inputChannels : []) if (e?.kind === 'decklink' && roleIndex(`in${e.slot}`)) roles.push(`in${e.slot}`)
		for (const r of new Set([...leases.keys(), ...active.keys()])) if (/^ch\d+$/.test(r)) roles.push(r)
		for (const role of roles) {
			surfaces.push({
				role,
				kind: 'runtime',
				channel: resolveRoleChannel(role, map),
				index: roleIndex(role),
				active: active.has(role),
				leases: leases.get(role)?.size || 0,
				...segmentFor(role),
			})
		}
		return surfaces
	}

	return { lease, sweep, onCasparReady, list, _state: { leases, active } }
}

let singleton = null

/** App-wide manager bound to ctx (lazy; sweeps every SWEEP_EVERY_MS). */
function getVideoSurfaceManager(ctx) {
	if (singleton) return singleton
	const { getChannelMap } = require('../config/routing')
	const { buildChannelResolutionMap } = require('../config/server-info-config')
	const { operatorGuiDestination, resolveOperatorGuiChannel } = require('./operator-gui-channel-geometry')
	singleton = createVideoSurfaceManager({
		getAmcp: () => ctx.amcp,
		// chN needs the channels Caspar actually runs (INFO CONFIG); the config map alone does not list them
		getChannelMap: () => {
			const xml = String(ctx.gatheredInfo?.infoConfig || '')
			return { ...getChannelMap(ctx.config || {}), channelResolutionsByChannel: xml.trim() ? buildChannelResolutionMap(xml) : {} }
		},
		getOperatorSurface: () => {
			const dest = operatorGuiDestination(ctx.config || {})
			if (!dest || dest.videoOutput !== 'shm') return null
			const r = resolveOperatorGuiChannel(ctx.config || {})
			return { role: dest.shmName || 'opgui', channel: r ? r.ch : null }
		},
		log: (lvl, msg) => (typeof ctx.log === 'function' ? ctx.log(lvl, msg) : undefined),
	})
	const timer = setInterval(() => void singleton.sweep(), SWEEP_EVERY_MS)
	if (typeof timer.unref === 'function') timer.unref()
	return singleton
}

module.exports = {
	createVideoSurfaceManager,
	getVideoSurfaceManager,
	resolveRoleChannel,
	roleIndex,
	SHM_INDEX_BASE,
	ROLE_SLOTS,
	LEASE_TTL_MS,
}

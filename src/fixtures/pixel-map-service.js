'use strict'

/**
 * WO-807 — region-to-fixture-pixel mapping, wired into the follow engine (follow-service.js creates it):
 *   project.pixelMappings (pixel-map-model.js) → for each Caspar channel used, a leased shm surface of its output
 *   (src/system/video-surfaces.js; role pgmN / prvN when the channel is one, so a Godot previs lease shares the
 *   consumer, else chN) → each engine tick (44 Hz) the regions of every NEW frame are averaged (pixel-map-frame.js) →
 *   `write(buf, fx)` puts the colours into the engine's universe buffer right after the head's own channels, so the
 *   ArtDMX / sACN packet the engine already sends carries them, under all of its rules (DMX master + universe list,
 *   visualiser, self-loop guard, WO-712 lighting duty). The map writes colour channels only: dimmer / shutter stay
 *   with the programmer or the GDTF default.
 * No mappings → nothing is leased and a tick costs one check. A channel with no new frame for HOLD_MS (Caspar gone,
 * lease lost) drives its mapped pixels black — the "extension of the screen" goes dark with the screen.
 * While no mapped head is on the wire and nobody read /live for WATCH_MS, ticks skip the sampling (state "idle"; the
 * lease stays, so the first frame after the DMX master opens is sampled on the next tick).
 */

const { onProjectChanged } = require('../engine/project-events')
const { normalizeMappings, checkMapping, validateMappings, writePixel, slotsOf } = require('./pixel-map-model')
const { createRegionSampler } = require('./pixel-map-frame')

const LEASE_ID = 'wo807-pixelmap'
const LEASE_EVERY_MS = 5000
const HOLD_MS = 1000
// sampling idles while no mapped head is on the wire (DMX master off, universe not listed, visualiser) unless a /live
// reader (the Godot editor's swatches, 2 Hz) asked within WATCH_MS — 896 strips cost ~5 ms per frame on the box
const WATCH_MS = 5000

/** Default channel map (as video-surfaces.js resolves roles): program / preview lists + the channels Caspar runs. */
function liveChannelMap(ctx) {
	const { getChannelMap } = require('../config/routing')
	const { buildChannelResolutionMap } = require('../config/server-info-config')
	const xml = String(ctx?.gatheredInfo?.infoConfig || '')
	return { ...getChannelMap(ctx?.config || {}), channelResolutionsByChannel: xml.trim() ? buildChannelResolutionMap(xml) : {} }
}

/** The surface role for Caspar channel ch: pgmN / prvN when it is that bus, else chN. */
function roleFor(ch, map) {
	const pgm = (map?.programChannels || []).map(Number).indexOf(ch)
	if (pgm >= 0 && pgm < 4) return `pgm${pgm + 1}`
	const prv = (map?.previewChannels || []).map(Number).indexOf(ch)
	if (prv >= 0 && prv < 4 && Number(map.programChannels?.[prv]) !== ch) return `prv${prv + 1}`
	return `ch${ch}`
}

/**
 * @param {object} ctx app context
 * @param {import('./follow-engine').FollowEngine} engine
 * @param {{ log?: Function, now?: () => number, channelMap?: () => object, lease?: (roles: string[]) => Promise<any>,
 *   surfacePath?: (role: string) => string, loadProject?: () => object | null, persist?: (mappings: object[]) => Promise<object>,
 *   fsImpl?: object, subscribe?: boolean }} [deps]
 */
function createPixelMapService(ctx, engine, deps = {}) {
	const log = deps.log || (() => {})
	const now = deps.now || (() => Date.now())
	const channelMap = deps.channelMap || (() => liveChannelMap(ctx))
	const lease = deps.lease || ((roles) => require('../system/video-surfaces').getVideoSurfaceManager(ctx).lease(LEASE_ID, roles))
	// the segment path the surface manager announces: /dev/shm/highascg-<role>, or <root>/shm/ in a WO-719 sandbox (the
	// e2e found the sandbox sampling the LIVE Caspar's segment through a hard-coded /dev/shm path)
	const surfacePath = deps.surfacePath || ((role) => require('../system/video-surfaces').segmentFor(role).path)
	let mappings = []
	let resolved = { forFixtures: null, forMappings: null, list: [], byFixture: new Map(), problems: false, sig: '', at: 0 }
	/** @type {Map<number, { role: string, file: string, sampler: object, ids: string[], since: number, state: string, at: number, width: number, height: number }>} */
	let surfaces = new Map()
	const colours = new Map() // mapping id → { rgb, at }
	let leaseTimer = null
	let leasedRoles = ''
	let lastWritten = new Map() // mapping id → [{ slot, value }]
	const stats = { frames: 0, sampleMs: 0, lastSampleUs: 0, idleTicks: 0 }
	let watchedAt = -Infinity
	// a head whose universe the engine has not built yet (before its first tick) counts as on the wire
	const onWire = (fx) => (typeof engine.frameOf === 'function' && !engine.frameOf(fx)) || engine.isLive(fx)
	const wanted = (t) => t - watchedAt < WATCH_MS || typeof engine.isLive !== 'function' ||
		[...resolved.byFixture.values()].some((list) => onWire(list[0].fx))

	const resolutionIn = (map) => (ch) => {
		const r = map?.channelResolutionsByChannel?.[String(ch)]
		return r && r.w > 0 && r.h > 0 ? { w: r.w, h: r.h } : null
	}
	const resolutionOf = (ch) => resolutionIn(channelMap())(ch)

	/**
	 * Re-check every mapping against the engine's current patch and Caspar's channels: when the patch or the list
	 * changes, and every RECHECK_MS while some mapping has a problem (Caspar not up yet, a channel being restarted).
	 */
	function resolve(t = now()) {
		const recheck = resolved.problems && t - resolved.at >= LEASE_EVERY_MS
		if (!recheck && resolved.forFixtures === engine.fixtures && resolved.forMappings === mappings) return resolved
		const map = channelMap()
		const env = { fixtures: engine.fixtures, resolutionOf: resolutionIn(map) }
		const list = mappings.map((m) => ({ m, ...checkMapping(m, env) }))
		const byFixture = new Map()
		for (const r of list) {
			if (!r.m.enabled || r.problem) continue
			if (!byFixture.has(r.fx.id)) byFixture.set(r.fx.id, [])
			byFixture.get(r.fx.id).push(r)
		}
		const problems = list.some((r) => r.m.enabled && r.problem)
		const sig = list.map((r) => `${r.m.id}:${r.problem ? 0 : 1}`).join(',')
		const same = recheck && sig === resolved.sig && resolved.forFixtures === engine.fixtures && resolved.forMappings === mappings
		resolved = { forFixtures: engine.fixtures, forMappings: mappings, list, byFixture, problems, sig, at: t }
		if (!same) rebuildSurfaces(map)
		return resolved
	}

	function rebuildSurfaces(map) {
		const byCh = new Map()
		for (const r of resolved.list) {
			if (!r.m.enabled || r.problem) continue
			if (!byCh.has(r.m.channelNo)) byCh.set(r.m.channelNo, [])
			byCh.get(r.m.channelNo).push(r.m)
		}
		const next = new Map()
		for (const [ch, list] of byCh) {
			const role = roleFor(ch, map)
			next.set(ch, { role, file: surfacePath(role), ids: list.map((m) => m.id), since: 0, state: 'waiting', at: 0, width: 0, height: 0,
				sampler: createRegionSampler(list.map((m) => ({ ...m.rect, mode: m.mode })), { fsImpl: deps.fsImpl }) })
		}
		surfaces = next
		renewLease()
	}

	function renewLease() {
		const roles = [...new Set([...surfaces.values()].map((s) => s.role))].sort()
		const key = roles.join(',')
		if (!roles.length && !leasedRoles) return
		leasedRoles = key
		Promise.resolve()
			.then(() => lease(roles))
			.catch((e) => log('warn', `[pixelmap] surface lease ${key || '(release)'}: ${e?.message || e}`))
		if (roles.length && !leaseTimer) {
			leaseTimer = setInterval(() => renewLease(), LEASE_EVERY_MS)
			if (typeof leaseTimer.unref === 'function') leaseTimer.unref()
		} else if (!roles.length && leaseTimer) {
			clearInterval(leaseTimer)
			leaseTimer = null
			leasedRoles = ''
		}
	}

	function load(project) {
		const next = normalizeMappings(project?.pixelMappings)
		if (JSON.stringify(next) === JSON.stringify(mappings)) return
		mappings = next
		colours.clear()
		resolve()
		const bad = resolved.list.filter((r) => r.m.enabled && r.problem)
		log('info', `[pixelmap] ${mappings.length} mapping(s), ${resolved.list.length - bad.length} outputtable, channels ${[...surfaces.keys()].join(',') || '-'}`)
		for (const r of bad.slice(0, 10)) log('warn', `[pixelmap] ${r.m.id}: ${r.problem}`)
	}

	/** Engine tick start: average the regions of every channel that has a new frame. */
	function sample(t = now()) {
		if (!mappings.length) return
		resolve()
		if (!surfaces.size) return
		if (!wanted(t)) {
			stats.idleTicks++
			for (const s of surfaces.values()) s.state = 'idle'
			return
		}
		const t0 = process.hrtime.bigint()
		for (const s of surfaces.values()) {
			let res
			try {
				res = s.sampler.read(s.file, { since: s.since })
			} catch (e) {
				res = { state: 'invalid', error: e?.message || String(e) }
			}
			if (res.state === 'frame') {
				s.since = res.seq
				s.at = t
				s.width = res.width
				s.height = res.height
				s.ids.forEach((id, i) => colours.set(id, { rgb: res.colours[i], at: t }))
				stats.frames++
			}
			s.state = res.state === 'frame' || (res.state === 'none' && t - s.at < HOLD_MS) ? 'live' : res.state === 'none' ? 'stalled' : res.state
		}
		const us = Number(process.hrtime.bigint() - t0) / 1000
		stats.lastSampleUs = Math.round(us)
		stats.sampleMs += us / 1000
	}

	/** Engine, per fixture after its own channels: the mapped pixels' colours (black when the channel has no signal). */
	function write(buf, fx, t = now()) {
		if (!mappings.length) return
		const list = resolve().byFixture.get(fx.id)
		if (!list) return
		for (const r of list) {
			const c = colours.get(r.m.id)
			const rgb = c && t - c.at < HOLD_MS ? c.rgb : null
			lastWritten.set(r.m.id, writePixel(buf, fx, r.px, rgb, r.m.colourOrder))
		}
	}

	function view() {
		const res = resolve()
		return res.list.map((r) => ({ ...r.m, problem: r.problem }))
	}

	/** GET /api/fixtures/pixelmap/live */
	function live(t = now()) {
		watchedAt = t
		const res = resolve()
		return {
			at: t,
			stats: { frames: stats.frames, sample_ms_total: Math.round(stats.sampleMs * 10) / 10, last_sample_us: stats.lastSampleUs, idle_ticks: stats.idleTicks },
			channels: [...surfaces.entries()].map(([ch, s]) => ({ channelNo: ch, role: s.role, state: s.state, width: s.width, height: s.height,
				age_ms: s.at ? t - s.at : null, mappings: s.ids.length })),
			mappings: res.list.map((r) => {
				const c = colours.get(r.m.id)
				const fresh = c && t - c.at < HOLD_MS
				return { id: r.m.id, fixtureId: r.m.fixtureId, pixel: r.m.pixel, enabled: r.m.enabled, problem: r.problem,
					rgb: fresh ? c.rgb : null, age_ms: c ? t - c.at : null,
					...(r.fx && r.px ? { protocol: r.fx.protocol, universe: r.fx.universe, slots: slotsOf(r.fx, r.px), order: r.px.order,
						dmx: lastWritten.get(r.m.id) || [], on_wire: typeof engine.isLive === 'function' ? engine.isLive(r.fx) : false } : {}) }
			}),
		}
	}

	/**
	 * POST /api/fixtures/pixelmap: strict check, then persist (the project change reloads us). `extra`: other server-owned
	 * keys written in the same project write (the edge proposal's accept drops `pixelMappingProposal` with it).
	 */
	async function set(list, { extra } = {}) {
		const check = validateMappings(list, { fixtures: engine.fixtures, resolutionOf: resolutionIn(channelMap()) })
		if (!check.ok) return check
		const persist = deps.persist || ((ms, ex) => persistToProject(ctx, ms, ex))
		await persist(check.mappings, extra)
		load({ pixelMappings: check.mappings })
		return { ok: true, mappings: view() }
	}

	let off = () => {}
	if (deps.subscribe !== false) {
		try {
			const loadProject = deps.loadProject || (() => require('../engine/project-scenes').loadFullProject())
			load(loadProject())
		} catch (e) {
			log('warn', '[pixelmap] initial project load: ' + (e?.message || e))
		}
		off = onProjectChanged(load)
	}

	return {
		load,
		sample,
		write,
		set,
		live,
		mappings: view,
		resolutionOf,
		stop() {
			off()
			if (leaseTimer) clearInterval(leaseTimer)
			leaseTimer = null
			if (leasedRoles) Promise.resolve().then(() => lease([])).catch(() => {})
			leasedRoles = ''
			surfaces = new Map()
			lastWritten = new Map()
		},
	}
}

/** Write `pixelMappings` into the active project (server-owned key) and tell clients + server consumers. */
async function persistToProject(ctx, mappings, extra = {}) {
	const { loadFullProject, persistProject } = require('../engine/project-scenes')
	const { scheduleProjectSyncBroadcast } = require('../api/routes-data-project-sync')
	const project = loadFullProject()
	if (!project || typeof project !== 'object') throw new Error('no active project')
	// an empty list drops the key (JSON omits undefined), so clearing leaves the project as it was before any mapping
	const result = await persistProject(ctx, { ...project, ...extra, pixelMappings: mappings.length ? mappings : undefined }, { writeAutosave: true })
	if (result?.unchanged !== true) scheduleProjectSyncBroadcast(ctx, result.project)
	return result
}

module.exports = { createPixelMapService, roleFor, liveChannelMap, LEASE_ID, HOLD_MS }

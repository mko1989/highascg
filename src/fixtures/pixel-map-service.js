'use strict'

/**
 * WO-807 — region-to-fixture-pixel mapping, wired into the follow engine (follow-service.js creates it):
 *   project.pixelMappings (pixel-map-model.js) → for each Caspar channel used, a leased shm surface of its output
 *   (src/system/video-surfaces.js; role pgmN / prvN when the channel is one, so a Godot previs lease shares the
 *   consumer, else chN) → each engine tick the regions of every NEW frame are averaged (pixel-map-frame.js) →
 *   `write(buf, fx)` puts the colours into the engine's universe buffer right after the head's own channels, so the
 *   ArtDMX / sACN packet the engine already sends carries them, under all of its rules (DMX master + universe list,
 *   visualiser, self-loop guard, WO-712 lighting duty). The map writes colour channels only: dimmer / shutter stay
 *   with the programmer or the GDTF default.
 * No mappings → nothing is leased and a tick costs one check. A channel with no new frame for HOLD_MS (Caspar gone,
 * lease lost) drives its mapped pixels black — the "extension of the screen" goes dark with the screen.
 * WO-893: the averaged colour of every mapping goes through an attack / release smoothing (pixel-map-smooth.js, project
 * key `pixelMapSettings`, 0 / 0 = off) after the averaging, once per tick; write() puts the smoothed value on the wire.
 * WO-897: a watcher reads only the surfaces' header seq every WATCH_POLL_MS and kicks the engine (engine.kick) when a
 * frame lands, so each frame is sampled once (the engine's own 23 ms clock skipped ~6.5 of 50 frames/s).
 * WO-916: always on while mappings exist (no idle when nobody looks / nothing is on the wire). The watcher marks a frame
 * due only when the last due one is ≥ ¾ of 1 / rate_hz old (pixel-map-settings.js; 50 fps at 25 Hz = every 2nd frame);
 * only due frames are read (a surface with none for HOLD_MS is read anyway, so missing / stalled still show). `skipped`
 * counts frames the rate left out, `missed` frames that went by unsampled otherwise. After each sample the colours also
 * go to the lighting console (pixel-map-console.js), independent of the DMX master.
 */

const { onProjectChanged } = require('../engine/project-events')
const { normalizeMappings, checkMapping, validateMappings, writePixel, slotsOf, bindRole, intensityPlan, writeIntensity } = require('./pixel-map-model')
const { createRegionSampler, peekSeq } = require('./pixel-map-frame')
const smoothing = require('./pixel-map-smooth')
const pmSettings = require('./pixel-map-settings')
const { createConsoleOutput, REFRESH_MS: CONSOLE_REFRESH_MS } = require('./pixel-map-console')

const LEASE_ID = 'wo807-pixelmap'
const LEASE_EVERY_MS = 5000
const HOLD_MS = 1000
const WATCH_POLL_MS = 3

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
 *   fsImpl?: object, subscribe?: boolean, send?: (to: object, packet: Buffer) => void,
 *   isSelfLoop?: (to: object, universe: number, protocol: string) => boolean }} [deps]  send / isSelfLoop: the console output (WO-916)
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
	const colours = new Map() // mapping id → { rgb (rounded), means (unrounded), at }
	const smoother = smoothing.createSmoother() // WO-893: mapping id → the float colour write() sends
	let settings = pmSettings.normalizeSettings(null) // project.pixelMapSettings
	const consoleOut = createConsoleOutput({ send: deps.send || (() => {}), isSelfLoop: deps.isSelfLoop }) // WO-916
	let consoleAt = 0
	let stepAt = null // time of the last smoothing step (null: the next one starts fresh)
	let leaseTimer = null
	let pollTimer = null // WO-897: the frame watcher
	let leasedRoles = ''
	let lastWritten = new Map() // mapping id → [{ slot, value }]
	const stats = { frames: 0, missed: 0, skipped: 0, sampleMs: 0, lastSampleUs: 0 }
	const minGap = () => (settings.rate_hz > 0 ? 750 / settings.rate_hz : 0) // WO-916: ¾ period → steady every Nth frame

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
		const list = mappings.map((raw) => {
			const m = bindRole(raw, map) // WO-915: a bus-bound mapping samples the bus's channel of now
			return { m, ...checkMapping(m, env) }
		})
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
				seen: 0, due: false, dueAt: -Infinity, tried: -Infinity, skippedSince: 0,
				sampler: createRegionSampler(list.map((m) => ({ ...m.rect, mode: m.mode })), { fsImpl: deps.fsImpl }) })
		}
		surfaces = next
		renewLease()
		watchFrames()
	}

	/** WO-897: poll the surfaces' seq; a new frame kicks one engine tick — WO-916: only a due one (rate_hz). */
	function watchFrames() {
		if (surfaces.size && !pollTimer && typeof engine.kick === 'function') {
			pollTimer = setInterval(() => {
				const t = now()
				let kick = false
				for (const s of surfaces.values()) {
					const seq = peekSeq(s.file, { fsImpl: deps.fsImpl })
					if (!seq || seq === s.seen) continue
					s.seen = seq
					if (seq === s.since) continue
					if (t - s.dueAt < minGap()) {
						s.skippedSince++
						continue
					}
					s.dueAt = t
					s.due = true
					kick = true
				}
				if (kick) engine.kick()
			}, WATCH_POLL_MS)
			if (typeof pollTimer.unref === 'function') pollTimer.unref()
		} else if (!surfaces.size && pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
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
		settings = pmSettings.normalizeSettings(project?.pixelMapSettings)
		consoleOut.configure(settings.console)
		const next = normalizeMappings(project?.pixelMappings)
		if (JSON.stringify(next) === JSON.stringify(mappings)) return
		mappings = next
		colours.clear()
		smoother.clear()
		resolve()
		const bad = resolved.list.filter((r) => r.m.enabled && r.problem)
		log('info', `[pixelmap] ${mappings.length} mapping(s), ${resolved.list.length - bad.length} outputtable, channels ${[...surfaces.keys()].join(',') || '-'}`)
		for (const r of bad.slice(0, 10)) log('warn', `[pixelmap] ${r.m.id}: ${r.problem}`)
	}

	/** WO-893 snap: a new frame that changed this channel's mappings by `snap` on average is a cut → their states jump to the raw value. */
	function snapChannel(s, means) {
		const prev = s.ids.map((id) => colours.get(id)?.means || null)
		if (smoothing.frameJump(prev, means) < settings.smooth.snap) return
		s.ids.forEach((id, i) => means[i] && smoother.set(id, means[i]))
	}

	/** WO-893: every tick (new frame or not) each mapping's state moves toward its target; stale → toward black (a release, not a cut). */
	function smoothStep(t) {
		const sm = settings.smooth
		const dt = stepAt == null ? 0 : Math.min(smoothing.MAX_DT_S, Math.max(0, (t - stepAt) / 1000))
		stepAt = t
		const off = smoothing.isOff(sm)
		for (const s of surfaces.values()) {
			for (const id of s.ids) {
				const c = colours.get(id)
				if (!c) continue
				// off: the rounded ints of WO-807 (byte for byte); else the unrounded mean
				const target = t - c.at < HOLD_MS ? (off ? c.rgb : c.means) : null
				smoother.update(id, target, dt, sm)
			}
		}
	}

	/** Engine tick start: average the regions of every channel that has a new frame. */
	function sample(t = now()) {
		if (!mappings.length) return
		resolve()
		if (!surfaces.size) return
		const t0 = process.hrtime.bigint()
		let sampled = false
		for (const s of surfaces.values()) {
			// WO-916: at a rate, with the watcher running, only its due frames are read (and a surface with none for HOLD_MS,
			// for its state); rate 0 = every tick reads (a frame not new yet costs the header)
			if (pollTimer && settings.rate_hz > 0 && !s.due && t - s.tried < HOLD_MS) {
				if (s.at && t - s.at >= HOLD_MS) s.state = 'stalled'
				continue
			}
			s.due = false
			s.tried = t
			let res
			try {
				res = s.sampler.read(s.file, { since: s.since })
			} catch (e) {
				res = { state: 'invalid', error: e?.message || String(e) }
			}
			if (res.state === 'frame') {
				// WO-897: frames that went by; WO-916: those the rate left out are `skipped`, not missed
				if (s.since && res.seq > s.since + 1) stats.missed += Math.max(0, res.seq - s.since - 1 - s.skippedSince)
				stats.skipped += s.skippedSince
				s.skippedSince = 0
				s.since = res.seq
				s.at = t
				s.width = res.width
				s.height = res.height
				if (settings.smooth.snap > 0) snapChannel(s, res.means)
				s.ids.forEach((id, i) => colours.set(id, { rgb: res.colours[i], means: res.means[i], at: t }))
				stats.frames++
				sampled = true
			}
			s.state = res.state === 'frame' || (res.state === 'none' && t - s.at < HOLD_MS) ? 'live' : res.state === 'none' ? 'stalled' : res.state
		}
		smoothStep(t)
		// WO-916: the console gets every new sample (its own 1 s refresh while Caspar sends nothing)
		if (sampled || t - consoleAt >= CONSOLE_REFRESH_MS) {
			consoleAt = t
			consoleOut.frame(resolved.list, (id) => smoother.get(id), t)
		}
		const us = Number(process.hrtime.bigint() - t0) / 1000
		stats.lastSampleUs = Math.round(us)
		stats.sampleMs += us / 1000
	}

	const plans = new WeakMap() // WO-917: a fixture's resolved mapping list → its intensity plan
	function planOf(fx, list) {
		let p = plans.get(list)
		if (!p) plans.set(list, (p = intensityPlan(fx, new Set(list.map((r) => r.m.pixel)))))
		return p
	}

	/** Engine, per fixture after its own channels: the mapped pixels' colours (black when the channel has no signal). */
	function write(buf, fx, _t = now()) {
		if (!mappings.length) return
		const list = resolve().byFixture.get(fx.id)
		if (!list) return
		if (settings.intensity.override) writeIntensity(buf, fx, planOf(fx, list), settings.intensity.level / 100) // WO-917
		for (const r of list) {
			lastWritten.set(r.m.id, writePixel(buf, fx, r.px, smoother.get(r.m.id), r.m.colourOrder)) // WO-893: the smoothed colour
		}
	}

	function view() {
		const res = resolve()
		return res.list.map((r) => ({ ...r.m, problem: r.problem }))
	}

	/** GET /api/fixtures/pixelmap/live */
	function live(t = now()) {
		const res = resolve()
		return {
			at: t,
			smooth: settings.smooth,
			rate_hz: settings.rate_hz,
			intensity: settings.intensity,
			console: consoleOut.status(t),
			stats: { frames: stats.frames, missed: stats.missed, skipped: stats.skipped, sample_ms_total: Math.round(stats.sampleMs * 10) / 10, last_sample_us: stats.lastSampleUs },
			channels: [...surfaces.entries()].map(([ch, s]) => ({ channelNo: ch, role: s.role, state: s.state, width: s.width, height: s.height,
				age_ms: s.at ? t - s.at : null, mappings: s.ids.length })),
			mappings: res.list.map((r) => {
				const c = colours.get(r.m.id)
				const fresh = c && t - c.at < HOLD_MS
				const st = smoother.get(r.m.id)
				// rgb = what is written (smoothed, rounded); raw = the region's mean of the last frame; a releasing stale one shows until black
				const shown = st && (fresh || (!smoothing.isOff(settings.smooth) && Math.max(...st) >= 0.5)) ? st.map(Math.round) : null
				return { id: r.m.id, fixtureId: r.m.fixtureId, pixel: r.m.pixel, enabled: r.m.enabled, problem: r.problem,
					rgb: shown, raw: fresh ? c.rgb : null, age_ms: c ? t - c.at : null, console: consoleOut.placeOf(r.m.id),
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
		const map = channelMap()
		const check = validateMappings(list, { fixtures: engine.fixtures, resolutionOf: resolutionIn(map), channelMap: map })
		if (!check.ok) return check
		const persist = deps.persist || ((ms, ex) => persistToProject(ctx, ms, ex))
		await persist(check.mappings, extra)
		load({ pixelMappings: check.mappings, pixelMapSettings: settings })
		return { ok: true, mappings: view() }
	}

	/** GET /api/fixtures/pixelmap/settings */
	const getSettings = () => settings

	/** POST /api/fixtures/pixelmap/settings: strict check (omitted fields keep their value), clamp, persist (the project change reloads us). */
	async function setSettings(raw) {
		const check = pmSettings.validateSettings(raw, settings)
		if (!check.ok) return check
		const persist = deps.persistSettings || ((st) => persistSettingsToProject(ctx, st))
		await persist(check.settings)
		settings = check.settings
		consoleOut.configure(settings.console)
		return { ok: true, settings }
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
		settings: getSettings,
		setSettings,
		live,
		mappings: view,
		resolutionOf,
		stop() {
			off()
			if (leaseTimer) clearInterval(leaseTimer)
			leaseTimer = null
			if (pollTimer) clearInterval(pollTimer)
			pollTimer = null
			if (leasedRoles) Promise.resolve().then(() => lease([])).catch(() => {})
			leasedRoles = ''
			surfaces = new Map()
			lastWritten = new Map()
			smoother.clear()
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

/** Write `pixelMapSettings` into the active project (server-owned key; all-default settings drop it). */
async function persistSettingsToProject(ctx, settings) {
	const { loadFullProject, persistProject } = require('../engine/project-scenes')
	const { scheduleProjectSyncBroadcast } = require('../api/routes-data-project-sync')
	const project = loadFullProject()
	if (!project || typeof project !== 'object') throw new Error('no active project')
	const result = await persistProject(ctx, { ...project, pixelMapSettings: pmSettings.isDefault(settings) ? undefined : settings }, { writeAutosave: true })
	if (result?.unchanged !== true) scheduleProjectSyncBroadcast(ctx, result.project)
	return result
}

module.exports = { createPixelMapService, roleFor, liveChannelMap, LEASE_ID, HOLD_MS }

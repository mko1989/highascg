'use strict'

/**
 * WO-807 — the automatic edge proposal, served (pixel-map-propose.js is the pure rule):
 *   inputs   the active project's LED walls (`previs.stage.objects` type led_wall, each bound by `source.role` pgmN / prvN /
 *            chN to a Caspar channel that runs — the screen destination's raster) and the engine's patch (the linear
 *            pixel fixtures, their pixel positions from the GDTF rig, gdtf-store.js visual()).
 *   pending  on a project change (debounced) whose inputs — the MVR id (`previs.mvr`), the bound walls, the linear pixel
 *            fixtures' positions — hash to a signature other than the one stored in `project.pixelMappingProposal` (a
 *            SERVER-owned key, project-client-slices.js): an MVR loaded, a wall bound to a destination or moved, heads
 *            re-patched. The project needs an MVR, a bound wall and a linear pixel fixture. Unless the stored
 *            pixelMappings already hold the result, it is stored { state: "pending", sig, … } — never applied; the client
 *            shows "N fixture mappings proposed". Content-based, so a restart or the first event after boot cannot miss
 *            or repeat it; an in-memory last signature keeps autosaves with unchanged inputs from recomputing.
 *   accept   the pending proposal (or a fresh one when options are given) replaces the mappings of the fixtures it
 *            covers (other fixtures' mappings are kept unless `replace`), through pixelMap.set — the POST's validation —
 *            and records { state: "accepted", sig } in the same project write; dismiss records "dismissed". Either one
 *            stops the same inputs from being proposed again; manual edits of the mappings afterwards are left alone.
 */

const crypto = require('crypto')
const { onProjectChanged } = require('../engine/project-events')
const { proposePixelMappings, wallOf, fixtureOf, normalizeOptions } = require('./pixel-map-propose')

const KEY = 'pixelMappingProposal'
const DEBOUNCE_MS = 500
const OPTION_KEYS = ['inset_px', 'depth_px', 'threshold_m', 'mode']

/** Surface role → Caspar channel through the channel map (the inverse of pixel-map-service.js roleFor), or null. */
function channelForRole(role, map) {
	const m = /^(pgm|prv|ch)(\d+)$/.exec(String(role || ''))
	if (!m) return null
	const n = Number(m[2])
	if (m[1] === 'ch') return n > 0 ? n : null
	const ch = Number((m[1] === 'pgm' ? map?.programChannels : map?.previewChannels)?.[n - 1])
	return ch > 0 ? ch : null
}

const sameRect = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
/** Every proposed mapping is already stored (same fixture pixel, channel, rect, mode, enabled). */
function isApplied(proposed, stored) {
	if (!proposed.length) return false
	const by = new Map((stored || []).map((m) => [`${m.fixtureId}#${m.pixel}`, m]))
	return proposed.every((p) => {
		const s = by.get(`${p.fixtureId}#${p.pixel}`)
		return s && s.enabled !== false && s.channelNo === p.channelNo && s.mode === p.mode && sameRect(s.rect, p.rect)
	})
}

/** The proposal's inputs → a short hash (stored with the proposal; equal inputs are never proposed twice). */
function signature(project, inp) {
	const o = { mvr: project?.previs?.mvr?.id || null, walls: inp.walls,
		fixtures: inp.fixtures.map((f) => [f.id, f.problem, f.centre.map((v) => Math.round(v * 1000)), f.pixels.length]) }
	return crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16)
}

/** Summaries with each fixture's rects taken from the mappings (the stored pending keeps the rects once). */
function withRects(fixtures, mappings) {
	const by = new Map()
	for (const m of mappings || []) {
		if (!by.has(m.fixtureId)) by.set(m.fixtureId, [])
		by.get(m.fixtureId).push(m.rect)
	}
	return (fixtures || []).map((f) => (f.mapped ? { ...f, rects: by.get(f.fixtureId) || [] } : f))
}

function optionsFrom(src) {
	const o = {}
	for (const k of OPTION_KEYS) if (src?.[k] !== undefined && src[k] !== '') o[k] = src[k]
	return o
}

/**
 * @param {object} ctx app context
 * @param {import('./follow-engine').FollowEngine} engine
 * @param {object} pixelMap pixel-map-service.js instance
 * @param {{ log?: Function, now?: () => number, channelMap?: () => object, rigOf?: (typeId: string, mode: string) => object | null,
 *   loadProject?: () => object | null, persist?: (value: object | null) => Promise<any>, subscribe?: boolean, debounceMs?: number }} [deps]
 */
function createPixelMapProposalService(ctx, engine, pixelMap, deps = {}) {
	const log = deps.log || (() => {})
	const now = deps.now || (() => Date.now())
	const channelMap = deps.channelMap || (() => require('./pixel-map-service').liveChannelMap(ctx))
	const rigOf = deps.rigOf || ((typeId, mode) => {
		try {
			return require('./gdtf-store').visual(typeId, mode)?.rig || null
		} catch {
			return null
		}
	})
	const loadProject = deps.loadProject || (() => require('../engine/project-scenes').loadFullProject())
	const persist = deps.persist || ((value) => persistProposal(ctx, value))
	let pending = null
	let record = null // the stored key's { state, sig, at } (pending / accepted / dismissed)
	let lastSig = null
	let timer = null

	/** The proposal's inputs from a project + the engine's current patch. */
	function inputs(project) {
		const map = channelMap()
		const skipped = []
		const walls = []
		for (const o of project?.previs?.stage?.objects || []) {
			if (o?.type !== 'led_wall') continue
			const role = o.source?.role || 'pgm1'
			const ch = channelForRole(role, map)
			const r = ch ? map?.channelResolutionsByChannel?.[String(ch)] : null
			const w = wallOf(o, { channelNo: ch, raster: r && r.w > 0 && r.h > 0 ? { w: r.w, h: r.h } : null })
			if (w) walls.push(w)
			else skipped.push({ id: o.id, name: o.name, role, reason: ch ? `channel ${ch} is not running in Caspar` : `role "${role}" is not a screen destination` })
		}
		const fixtures = []
		for (const fx of engine.fixtures || []) {
			if (!fx.gdtf) continue
			const f = fixtureOf(fx, fx.typeId ? rigOf(fx.typeId, fx.mode) : null)
			if (f.linear) fixtures.push(f)
		}
		return { walls, fixtures, skipped, rasters: Object.keys(map?.channelResolutionsByChannel || {}).length }
	}

	function compute(project, options = {}) {
		const inp = inputs(project)
		const p = proposePixelMappings(inp, options)
		return { ...p, sig: signature(project, inp), walls_skipped: inp.skipped, applied: isApplied(p.mappings, project?.pixelMappings) }
	}

	const stamp = (state, sig) => ({ state, sig, at: new Date(now()).toISOString() })

	/** The project changed: propose when the inputs differ from the stored signature (see the header). */
	async function check(project) {
		const stored = project?.[KEY] && typeof project[KEY] === 'object' ? project[KEY] : null
		pending = stored?.state === 'pending' ? stored : null
		record = stored ? { state: stored.state || null, sig: stored.sig || null, at: stored.at || null } : null
		const inp = inputs(project)
		// Caspar's channel sizes not known yet (boot, reconnect): walls cannot bind — nothing to decide on
		if (!inp.rasters || !project?.previs?.mvr || !inp.walls.length || !inp.fixtures.length) return null
		const sig = signature(project, inp)
		if (sig === lastSig || sig === stored?.sig) {
			lastSig = sig
			return null
		}
		lastSig = sig
		const p = proposePixelMappings(inp, {})
		if (!p.mappings.length) return null
		if (isApplied(p.mappings, project.pixelMappings)) {
			if (pending) await persist(stamp('accepted', sig))
			pending = null
			return null
		}
		const value = { ...stamp('pending', sig), mvr: project.previs.mvr.id || null, params: p.params, mapped: p.mapped,
			out_of_range: p.out_of_range, walls: p.walls, fixtures: p.fixtures.map(({ rects: _rects, ...f }) => f), mappings: p.mappings }
		await persist(value)
		pending = value
		log('info', `[pixelmap] edge proposal: ${p.mapped} fixture(s) / ${p.mappings.length} pixel(s) proposed, ${p.out_of_range} out of range (pending)`)
		return value
	}

	function schedule(project) {
		if (timer) clearTimeout(timer)
		timer = setTimeout(() => {
			timer = null
			check(project).catch((e) => log('warn', `[pixelmap] proposal: ${e?.message || e}`))
		}, deps.debounceMs ?? DEBOUNCE_MS)
		if (typeof timer.unref === 'function') timer.unref()
	}

	/** GET /api/fixtures/pixelmap/proposal: the pending proposal (pending: true), else a fresh one. No side effects. */
	function get(query = {}) {
		const opts = optionsFrom(query)
		const fresh = query.fresh === '1' || query.fresh === true || Object.keys(opts).length > 0
		if (pending && !fresh) {
			const project = loadProject()
			return { ok: true, pending: true, ...pending, fixtures: withRects(pending.fixtures, pending.mappings),
				applied: isApplied(pending.mappings, project?.pixelMappings) }
		}
		const p = compute(loadProject(), opts)
		return { ok: true, pending: false, at: new Date(now()).toISOString(), ...p, last: record }
	}

	/** POST /api/fixtures/pixelmap/proposal/accept { inset_px?, depth_px?, threshold_m?, mode?, replace? } */
	async function accept(body = {}) {
		const opts = optionsFrom(body)
		const project = loadProject()
		const p = pending && !Object.keys(opts).length ? pending : compute(project, opts)
		if (!p.mappings?.length) return { ok: false, status: 400, error: `nothing to accept: no linear pixel fixture within ${normalizeOptions(opts).threshold_m} m of a bound LED wall edge` }
		const covered = new Set(p.mappings.map((m) => m.fixtureId))
		const keep = body.replace === true ? [] : pixelMap.mappings().filter((m) => !covered.has(m.fixtureId)).map(({ problem: _problem, ...m }) => m)
		const r = await pixelMap.set([...keep, ...p.mappings], { extra: { [KEY]: stamp('accepted', p.sig) } })
		if (!r.ok) return { ...r, status: 400 }
		pending = null
		log('info', `[pixelmap] edge proposal accepted: ${p.mappings.length} mapping(s), ${keep.length} other kept`)
		return { ok: true, accepted: p.mappings.length, kept: keep.length, fixtures: covered.size, mappings: r.mappings }
	}

	/** POST /api/fixtures/pixelmap/proposal/dismiss — drop the pending proposal (nothing applied, not proposed again). */
	async function dismiss() {
		const had = Boolean(pending)
		if (had) await persist(stamp('dismissed', pending.sig))
		pending = null
		return { ok: true, dismissed: had }
	}

	let off = () => {}
	if (deps.subscribe !== false) {
		try {
			check(loadProject()).catch(() => {})
		} catch (e) {
			log('warn', '[pixelmap] proposal initial load: ' + (e?.message || e))
		}
		off = onProjectChanged(schedule)
	}

	return { get, accept, dismiss, check, compute, pending: () => pending,
		stop() {
			off()
			if (timer) clearTimeout(timer)
			timer = null
		} }
}

/** Write `project.pixelMappingProposal` (pending / accepted / dismissed) in the active project and tell clients. */
async function persistProposal(ctx, value) {
	const { loadFullProject, persistProject } = require('../engine/project-scenes')
	const { scheduleProjectSyncBroadcast } = require('../api/routes-data-project-sync')
	const project = loadFullProject()
	if (!project || typeof project !== 'object') throw new Error('no active project')
	const result = await persistProject(ctx, { ...project, [KEY]: value || undefined }, { writeAutosave: true })
	if (result?.unchanged !== true) scheduleProjectSyncBroadcast(ctx, result.project)
	return result
}

module.exports = { createPixelMapProposalService, channelForRole, isApplied, KEY }

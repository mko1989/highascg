'use strict'

/**
 * WO-1063 — look layers made from a PixelHue layer (`layer.pixelhue.layerId`, WO-1038) FOLLOW that switcher layer while
 * their look is on program: the operator moves / resizes / masks the layer on the switcher and the HighAsCG layer over
 * it (a PIP border, a key + fill overlay) moves with it, without a new take.
 *
 * A tick (FOLLOW_MS) looks at every program channel's live look; only when one holds a linked layer is the switcher
 * read (pixelhue-read.js: one request pair, shared with the layer list). A linked layer whose rectangle differs from
 * the switcher layer's shown rectangle (WO-1062: the mask counts) gets the PGM mixer nudge the look editor uses
 * (/api/preview/mixer-nudge target 'pgm': bank-aware, queued behind takes), and the live entry is updated in place.
 * The stored look is not touched: its rectangle is where the layer starts on the next take.
 *
 * Not followed: a layer the look DRIVES (Devices ▸ PixelHue "looks drive the switcher" on and the layer's own drive
 * not switched off) — there the look is the master, and following would feed the switcher's answer back.
 */

const FOLLOW_MS = 250
const EPS = 2e-4 // ~half a pixel on a 3072-wide canvas: a re-read of an unmoved layer never nudges

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)

/** layerNumber → switcher layerId for the stored look's linked layers that follow. */
function followLinks(storedScene, driveOn) {
	const out = new Map()
	for (const l of Array.isArray(storedScene?.layers) ? storedScene.layers : []) {
		const link = l?.pixelhue
		if (!link || typeof link !== 'object' || !Number.isFinite(Number(link.layerId))) continue
		if (driveOn && link.drive !== false) continue
		out.set(Number(l.layerNumber), Number(link.layerId))
	}
	return out
}

const sameFill = (a, b) =>
	Math.abs(num(a?.x, 0) - b.x) < EPS && Math.abs(num(a?.y, 0) - b.y) < EPS && Math.abs(num(a?.scaleX, 1) - b.scaleX) < EPS && Math.abs(num(a?.scaleY, 1) - b.scaleY) < EPS

/**
 * The live look's layers with every followed layer on its switcher layer's rectangle.
 * @param {object[]} liveLayers the live entry's layer rows
 * @param {Map<number, number>} links followLinks()
 * @param {{ screens: object[] }} snap pixelhue-read snapshot
 * @returns {{ layers: object[], moved: object[] }} moved: the rows that changed (what the nudge sends)
 */
function followedLayers(liveLayers, links, snap) {
	const byId = new Map()
	for (const s of snap?.screens || []) {
		if (s?.enabled === false) continue
		for (const l of s.layers || []) if (l?.enabled && l.fill && l.scene === 'pgm') byId.set(Number(l.layerId), l.fill)
	}
	const moved = []
	const layers = (liveLayers || []).map((row) => {
		const fill = byId.get(links.get(Number(row?.layerNumber)))
		if (!fill || sameFill(row.fill, fill)) return row
		// the rectangle IS the size, as when the layer was matched (pixelhue_match_model.gd patch_for)
		const next = { ...row, fill: { x: fill.x, y: fill.y, scaleX: fill.scaleX, scaleY: fill.scaleY }, contentFit: 'stretch', aspectLocked: false }
		moved.push(next)
		return next
	})
	return { layers, moved }
}

/**
 * @param {{ ctx: object, deps?: object }} a deps (tests): settings, reader, getMap, getLive, setLive, resolveScene, nudge
 */
function createPixelhueFollow({ ctx, deps = {} }) {
	let timer = null
	let busy = false
	let lastError = ''
	const stats = { ticks: 0, reads: 0, nudges: 0, at: 0 }
	const log = (level, msg) => (typeof ctx?.log === 'function' ? ctx.log(level, msg) : undefined)
	const routes = () => require('../api/routes-pixelhue')
	const liveState = () => require('../state/live-scene-state')

	function programChannels() {
		const getMap = deps.getMap || ((c) => require('../engine/scene-take-payload').withProgramResolutions(require('../config/routing').getChannelMap(c.config || {}, c.switcherOutputBusByChannel) || {}, c))
		const map = getMap(ctx)
		const list = Array.isArray(map?.programChannels) && map.programChannels.length ? map.programChannels : map?.playbackChannels || []
		return { map, list: list.map((ch, mainIdx) => ({ ch: Number(ch), mainIdx })).filter((x) => Number.isFinite(x.ch) && x.ch > 0) }
	}

	async function tick() {
		stats.ticks++
		const { host, drive } = (deps.settings || routes().readSettings)()
		if (!host) return
		const getLive = deps.getLive || ((ch) => liveState().getChannel(ch))
		const resolveScene = deps.resolveScene || ((id) => require('../engine/project-scenes-transform').resolveLiveSceneById(ctx, id))
		const { map, list } = programChannels()
		const work = []
		for (const { ch, mainIdx } of list) {
			const live = getLive(ch)
			if (!live?.sceneId || !Array.isArray(live.scene?.layers)) continue
			const links = followLinks(resolveScene(live.sceneId), drive)
			if (links.size) work.push({ ch, mainIdx, live, links })
		}
		if (!work.length) return
		const snap = await (deps.reader || routes().readerFor)(host).read()
		stats.reads++
		for (const w of work) {
			const { layers, moved } = followedLayers(w.live.scene.layers, w.links, snap)
			if (!moved.length) continue
			const res = map?.programResolutions?.[w.mainIdx] || {}
			const nudge = deps.nudge || ((b) => require('../api/routes-preview-nudge').handlePreviewMixerNudge(b, ctx))
			const r = await nudge({
				sceneId: String(w.live.sceneId),
				mainIndex: w.mainIdx,
				target: 'pgm',
				layers: moved,
				...(Number(res.w) > 0 && Number(res.h) > 0 ? { composeCanvas: { w: Number(res.w), h: Number(res.h) } } : {}),
			})
			let body = {}
			try {
				body = typeof r?.body === 'string' ? JSON.parse(r.body) : r?.body || {}
			} catch {
				/* not JSON: treated as not applied */
			}
			if (r?.status !== 200 || body.ok !== true) continue // the look left air meanwhile, or Caspar is away: next tick
			// only if the same take is still on air: a take that landed meanwhile owns the entry
			const now = getLive(w.ch)
			if (String(now?.sceneId || '') !== String(w.live.sceneId) || now?.updatedAt !== w.live.updatedAt) continue
			await (deps.setLive || ((c, e) => liveState().setChannel(c, e)))(w.ch, { ...now, scene: { ...now.scene, layers } })
			stats.nudges++
			stats.at = Date.now()
		}
	}

	async function run() {
		if (busy) return
		busy = true
		try {
			await tick()
			if (lastError) log('info', '[pixelhue] following the switcher again')
			lastError = ''
		} catch (e) {
			const msg = String(e?.message || e)
			if (msg !== lastError) log('warn', `[pixelhue] follow: ${msg}`) // once per distinct problem, not 4×/s
			lastError = msg
		} finally {
			busy = false
		}
	}

	return {
		start() {
			if (!timer) timer = setInterval(run, FOLLOW_MS)
		},
		stop() {
			if (timer) clearInterval(timer)
			timer = null
		},
		tick,
		status: () => ({ ...stats, error: lastError || null }),
	}
}

module.exports = { createPixelhueFollow, followLinks, followedLayers, FOLLOW_MS }

'use strict'

/**
 * WO-1126 — a still that both looks show the same way stays on air through the take, whatever layer number it has.
 *
 * Owner 19.11: "when moving from look FastTrack to TLO BAZWE there are png logos on top layers that do a fade out and
 * fade in where they shouldnt be affected at all by the transition". FastTrack had the two logos on L12 / L13, TŁO
 * BAZWE on L11 / L12 (same file, same fill): the take matches layers by NUMBER only, so it loaded LOGO over the list
 * layer, NAZWA over LOGO and faded the old NAZWA out — every logo dissolved against another picture.
 *
 * Here the incoming still is matched to an on-air still with the same picture (same file, same visual fields) on ANY
 * layer number. It gets no take job: the producer that is on air moves to the physical layer the new look wants it on
 * (SWAP … TRANSFORMS, as WO-218 does for kept layers), so nothing reloads and nothing fades.
 *   - up a bank (incoming look on 110+): moved in the PLAY batch, so the incoming bank never covers it;
 *   - down a bank / no bank flip (nothing reloads): moved after the teardown, when the layers under it are gone.
 * Off for + Animate, bank-less (PRV) takes, edits on air and a re-take of the same look (which reloads a replaced file).
 */

const { layerHasContent } = require('./scene-transition')
const { canonValue, keptLayerSwapLines, vacatedOverlayClearLines } = require('./scene-take-edit-on-air')

const STILL_RE = /\.(png|jpe?g|bmp|webp|tga|tiff?)$/i
/** Fields that cannot change what a still shows (transport, audio, list machinery, its number). */
const NOT_VISUAL = new Set([
	'layerNumber', 'source', 'playSeekFrames', 'startBehaviour', 'loop', 'audioRoute', 'routeSourceAudio', 'volume', 'muted',
	'sourceMode', 'playlist', 'playlistTransition', 'playlistLoop', 'playlistAdvance', 'fadeOnEnd', 'speed', 'trimInMs', 'trimOutMs',
])

function isStillLayer(l) {
	if (!layerHasContent(l) || l.sourceMode === 'list') return false
	const t = String(l.source.type || '').toLowerCase()
	return (t === 'media' || t === 'file') && STILL_RE.test(String(l.source.value))
}

function stable(v) {
	if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
	if (v && typeof v === 'object') {
		const keys = Object.keys(v).sort().filter((k) => v[k] != null && !(Array.isArray(v[k]) && v[k].length === 0))
		return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
	}
	return JSON.stringify(v)
}

/** What a still shows: its file (canonical name) + every field that is not transport / audio / list state. */
function stillKey(l, slug, config) {
	const rest = {}
	for (const k of Object.keys(l)) if (!NOT_VISUAL.has(k)) rest[k] = l[k]
	return `${canonValue(l.source.value, slug, config)}|${stable(rest)}`
}

/**
 * Which incoming stills are already on air. Removes the matched on-air layers from `currentMap`: their slot counts
 * as empty for the rest of the take (a job on that number has nothing to fade out, nothing to tear down).
 * @returns {{ from: Map<number, object>, sources: Set<object> }} incoming layer number → on-air layer; the on-air layers
 */
function planCarriedStills({ enabled, incomingSorted, currentMap, self }) {
	const from = new Map()
	const sources = new Set()
	if (!enabled) return { from, sources }
	let slug = null
	try {
		slug = require('../media/project-media-root').getActiveProjectSlug(self?.persistence)
	} catch {}
	const key = (l) => stillKey(l, slug, self?.config)
	const onAir = [...currentMap.values()].filter(isStillLayer).map((l) => ({ l, k: key(l) }))
	const wanted = incomingSorted.filter(isStillLayer).map((l) => ({ l, k: key(l) }))
	// the same number first, so a still that did not move is never handed to a twin of it on another layer
	for (const sameNumber of [true, false]) {
		for (const w of wanted) {
			if (from.has(w.l.layerNumber)) continue
			const hit = onAir.find((c) => !sources.has(c.l) && c.k === w.k && (!sameNumber || c.l.layerNumber === w.l.layerNumber))
			if (!hit) continue
			from.set(w.l.layerNumber, hit.l)
			sources.add(hit.l)
		}
	}
	for (const l of sources) currentMap.delete(l.layerNumber)
	return { from, sources }
}

/** Up a bank: carried stills ride the PLAY batch (first job with a PLAY). Edit on air keeps its own rule (WO-1073). */
function attachCarrySwapsToPlayBatch({ channel, takeJobs, skipped, phys, inactiveBank }) {
	const first = (takeJobs || []).find((j) => j.playPlan)
	const carried = (skipped || []).filter((s) => s.carried)
	if (!first || carried.length === 0 || inactiveBank !== 'b') return
	const lines = []
	for (const sk of carried) {
		const toPhys = phys(sk.layerNumber, inactiveBank)
		if (sk.physicalLayerNow === toPhys) continue
		lines.push(...keptLayerSwapLines(channel, sk, toPhys))
		sk.swappedEarly = true
	}
	if (lines.length) first.swapBeforePlay = [...(first.swapBeforePlay || []), ...lines]
}

/**
 * The kept layers' moves after the teardown: bank flip → every kept layer to the new bank (WO-218); no flip → only
 * carried stills whose number changed, on the bank they are on. Moves may chain (12 → 11, 13 → 12) or cross, so each
 * SWAP is planned against where the earlier ones left things.
 * @returns {{ swapLines: string[], clearLines: string[] }} clearLines: mixer state of the layers left empty
 */
function keptLayerMoveLines({ channel, skipped, flips, phys, inactiveBank }) {
	const moves = []
	for (const sk of skipped || []) {
		const to = flips ? phys(sk.layerNumber, inactiveBank) : sk.carried ? sk.stayPhys : sk.physicalLayerNow
		if (to !== sk.physicalLayerNow) moves.push({ sk, to })
	}
	const swapLines = []
	// WO-1073 / carried up a bank: already moved inside the PLAY batch
	const pos = new Map(moves.map((m) => [m, m.sk.swappedEarly ? m.to : m.sk.physicalLayerNow]))
	const occupant = new Map(moves.map((m) => [pos.get(m), m]))
	for (const m of moves) {
		const p = pos.get(m)
		if (p === m.to) continue
		swapLines.push(...keptLayerSwapLines(channel, { ...m.sk, physicalLayerNow: p }, m.to))
		const other = occupant.get(m.to)
		occupant.set(m.to, m)
		pos.set(m, m.to)
		if (other) {
			occupant.set(p, other)
			pos.set(other, p)
		} else occupant.delete(p)
	}
	const targets = new Set(moves.map((m) => m.to))
	const clearLines = []
	for (const m of moves) {
		if (targets.has(m.sk.physicalLayerNow)) continue
		clearLines.push(`MIXER ${channel}-${m.sk.physicalLayerNow} CLEAR`, ...vacatedOverlayClearLines(channel, m.sk))
	}
	return { swapLines, clearLines }
}

module.exports = { planCarriedStills, attachCarrySwapsToPlayBatch, keptLayerMoveLines }

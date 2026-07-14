'use strict'

/**
 * @param {string} clip
 * @returns {{ channel: number, layer: number|null }|null}
 */
function parseRouteClip(clip) {
	const s = String(clip || '').trim()
	const m = s.match(/^route:\/\/(\d+)(?:-(\d+))?$/i)
	if (!m) return null
	const channel = parseInt(m[1], 10)
	const layer = m[2] != null ? parseInt(m[2], 10) : null
	if (!Number.isFinite(channel) || channel < 1) return null
	return { channel, layer: Number.isFinite(layer) ? layer : null }
}

/**
 * @param {string} clip
 */
function isRouteClip(clip) {
	return String(clip || '').trim().toLowerCase().startsWith('route://')
}

/**
 * @param {object} scene
 * @returns {Set<number>}
 */
function lookLogicalLayerSet(scene) {
	const set = new Set()
	for (const l of scene?.layers || []) {
		const n = parseInt(l?.layerNumber, 10)
		if (Number.isFinite(n)) set.add(n)
	}
	return set
}

/**
 * Direct self-route guard (WO-156). Playing a route that targets its own destination channel
 * (`route://N` onto channel N, or `route://N-L` back onto channel N) creates a self-feedback
 * route producer that wedges the channel in CasparCG — recovery needs `CLEAR <ch>` or a
 * server restart. Cross-channel cycles (A routes B while B routes A) are NOT blocked here —
 * owner decision 2026-07-13: warn-only (see findCrossChannelRouteCycles), may tighten later.
 *
 * @param {string} clip — candidate source value (non-route values never violate)
 * @param {number} destChannel — Caspar channel the clip would PLAY on
 * @param {{ allowSameChannelLayers?: Set<number> }} [opts] — logical layer numbers of the look
 *   being taken; same-channel LAYER routes referencing them are intra-look routes (a supported
 *   feature — remapped by {@link remapIntraLookRoutesForTakeChannel}) and are not violations.
 * @returns {{ channel: number, layer: number|null, clip: string, reason: string } | null}
 */
function findSelfRouteViolation(clip, destChannel, opts = {}) {
	const ch = parseInt(destChannel, 10)
	if (!Number.isFinite(ch) || ch < 1) return null
	const parsed = parseRouteClip(clip)
	if (!parsed || parsed.channel !== ch) return null
	if (
		parsed.layer != null &&
		opts.allowSameChannelLayers instanceof Set &&
		opts.allowSameChannelLayers.has(parsed.layer)
	) {
		return null
	}
	const reason =
		parsed.layer == null
			? `route://${parsed.channel} routes channel ${ch} into itself`
			: `route://${parsed.channel}-${parsed.layer} routes a layer of channel ${ch} back onto channel ${ch}`
	return { channel: parsed.channel, layer: parsed.layer, clip: String(clip).trim(), reason }
}

/**
 * First self-route violation in a scene destined for `destChannel`.
 * Intra-look layer routes (route to one of the scene's own logical layers) are exempt.
 * @param {object} scene
 * @param {number} destChannel
 * @returns {{ layerNumber: number|null, violation: { channel: number, layer: number|null, clip: string, reason: string } } | null}
 */
function findSceneSelfRouteViolation(scene, destChannel) {
	if (!scene || !Array.isArray(scene.layers)) return null
	const allowSameChannelLayers = lookLogicalLayerSet(scene)
	for (const layer of scene.layers) {
		const v = layer?.source?.value
		if (!v || !isRouteClip(v)) continue
		const violation = findSelfRouteViolation(v, destChannel, { allowSameChannelLayers })
		if (violation) return { layerNumber: layer?.layerNumber ?? null, violation }
	}
	return null
}

/**
 * Throws a 400-flavored error when the scene contains a direct self-route for `destChannel`.
 * Called from {@link runSceneTakeLbg} so every take path (API take, preview stage, project
 * sync-push, replication mirror) passes through the same guard.
 * @param {object} scene
 * @param {number} destChannel
 */
function assertSceneHasNoSelfRoutes(scene, destChannel) {
	const found = findSceneSelfRouteViolation(scene, destChannel)
	if (!found) return
	const err = new Error(
		`Self-route blocked on channel ${destChannel}: layer ${found.layerNumber ?? '?'} plays ${found.violation.clip} — ${found.violation.reason}. This would wedge the channel in CasparCG (fix: pick a source from another channel).`,
	)
	// @ts-ignore — surfaced as HTTP status by the take route
	err.statusCode = 400
	// @ts-ignore
	err.code = 'SELF_ROUTE_BLOCKED'
	throw err
}

/**
 * Best-effort multi-hop cycle detection (warn-only, WO-156): scene routes to channel X while
 * X's live scene routes back to `destChannel`. Never blocks — some setups intentionally
 * cross-route buses; the operator warning is for diagnosing feedback/starvation.
 * @param {object} scene
 * @param {number} destChannel
 * @param {(channel: number) => object|null} getSceneForChannel — e.g. live-scene-state lookup
 * @returns {number[]} channels forming a 2-hop cycle with destChannel
 */
function findCrossChannelRouteCycles(scene, destChannel, getSceneForChannel) {
	/** @type {number[]} */
	const out = []
	const dest = parseInt(destChannel, 10)
	if (!scene || !Array.isArray(scene.layers) || typeof getSceneForChannel !== 'function' || !Number.isFinite(dest)) {
		return out
	}
	const seen = new Set()
	for (const layer of scene.layers) {
		const parsed = parseRouteClip(layer?.source?.value)
		if (!parsed || parsed.channel === dest || seen.has(parsed.channel)) continue
		seen.add(parsed.channel)
		let other = null
		try {
			other = getSceneForChannel(parsed.channel)
		} catch {
			other = null
		}
		for (const ol of other?.layers || []) {
			const op = parseRouteClip(ol?.source?.value)
			if (op && op.channel === dest) {
				out.push(parsed.channel)
				break
			}
		}
	}
	return out
}

/**
 * Looks store intra-composition routes against the program bus (e.g. route://1-10).
 * Logical layer N in the route string maps to physical N (bank a) or N+100 (bank b).
 * When staging on another channel or inactive bank, rewrite to route://<takeChannel>-<physical>.
 * @param {object} scene
 * @param {number} takeChannel
 * @param {'a'|'b'} [takeBank='a'] — bank incoming layers load onto for this take
 */
function remapIntraLookRoutesForTakeChannel(scene, takeChannel, takeBank = 'a') {
	if (!scene || !Array.isArray(scene.layers)) return scene
	const ch = parseInt(takeChannel, 10)
	if (!ch || ch < 1) return scene
	const bank = takeBank === 'b' ? 'b' : 'a'
	const { physicalProgramLayer } = require('./scene-transition')
	const logical = lookLogicalLayerSet(scene)
	let changed = false
	const layers = scene.layers.map((layer) => {
		const v = layer?.source?.value
		if (!v || !isRouteClip(v)) return layer
		const parsed = parseRouteClip(v)
		if (!parsed || parsed.layer == null) return layer
		if (!logical.has(parsed.layer)) return layer
		const physicalTarget = physicalProgramLayer(parsed.layer, bank)
		const next = `route://${ch}-${physicalTarget}`
		if (v === next) return layer
		changed = true
		return {
			...layer,
			source: { ...(layer.source || {}), value: next },
		}
	})
	return changed ? { ...scene, layers } : scene
}

/**
 * Same-channel route layers must PLAY after their source layers are on-air.
 * @param {object[]} takeJobs
 * @param {number} channel
 */
function partitionTakeJobsPlayOrder(takeJobs, channel) {
	const ch = parseInt(channel, 10)
	/** @type {object[]} */
	const sources = []
	/** @type {object[]} */
	const routes = []
	for (const job of takeJobs || []) {
		if (!isRouteClip(job?.clip)) {
			sources.push(job)
			continue
		}
		const parsed = parseRouteClip(job.clip)
		if (parsed && parsed.channel === ch && parsed.layer != null) {
			routes.push(job)
		} else {
			sources.push(job)
		}
	}
	return { sources, routes }
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Delay after source PLAY before first route; stagger between route PLAYs (Caspar route producer setup).
 * @returns {{ afterSourcesMs: number, betweenRoutesMs: number }}
 */
function resolveRoutePlayDelays() {
	const afterSourcesMs = Math.max(
		0,
		Math.min(
			2000,
			parseInt(process.env.HIGHASCG_ROUTE_SOURCE_PLAY_DELAY_MS || '120', 10) || 120,
		),
	)
	const betweenRoutesMs = Math.max(
		0,
		Math.min(
			500,
			parseInt(process.env.HIGHASCG_ROUTE_CHAIN_PLAY_DELAY_MS || '50', 10) || 50,
		),
	)
	return { afterSourcesMs, betweenRoutesMs }
}

/**
 * Same-channel route jobs ordered so each route's source layer is on-air first (supports route chains).
 * @param {object[]} routeJobs
 * @param {object[]} allJobs
 * @returns {object[]}
 */
function orderRouteJobsByDependency(routeJobs, allJobs) {
	/** @type {Map<number, object>} */
	const jobByPLayer = new Map()
	for (const job of allJobs || []) {
		const p = parseInt(job?.pLayer, 10)
		if (Number.isFinite(p)) jobByPLayer.set(p, job)
	}

	/** @type {Set<number>} */
	const onAir = new Set()
	for (const job of allJobs || []) {
		if (!isRouteClip(job?.clip)) {
			const p = parseInt(job?.pLayer, 10)
			if (Number.isFinite(p)) onAir.add(p)
		}
	}

	const remaining = [...(routeJobs || [])]
	/** @type {object[]} */
	const ordered = []
	let guard = 0
	while (remaining.length > 0 && guard++ <= remaining.length + 8) {
		let progressed = false
		for (let i = 0; i < remaining.length; i++) {
			const job = remaining[i]
			const parsed = parseRouteClip(job?.clip)
			const depLayer = parsed?.layer
			if (depLayer == null || onAir.has(depLayer)) {
				ordered.push(job)
				const p = parseInt(job?.pLayer, 10)
				if (Number.isFinite(p)) onAir.add(p)
				remaining.splice(i, 1)
				progressed = true
				break
			}
		}
		if (!progressed) {
			ordered.push(...remaining)
			break
		}
	}
	return ordered
}

/**
 * PLAY source layers, then stagger same-channel route layers so route:// producers exist before dependents.
 * @param {object} amcp
 * @param {number} channel
 * @param {object[]} takeJobs
 * @param {(job: object) => string[]} linesForJob
 * @param {{ leadingCommit?: boolean, commitAfterSources?: boolean, commitAfterRoutes?: boolean, suffixAfterSources?: string[] }} [opts]
 */
async function sendStaggeredTakePlays(amcp, channel, takeJobs, linesForJob, opts = {}) {
	const { sendAmcpLinesSequential } = require('../caspar/amcp-batch')
	const delays = resolveRoutePlayDelays()
	const ch = parseInt(channel, 10)
	const commitLine = `MIXER ${ch} COMMIT`
	const leadingCommit = opts.leadingCommit !== false
	const commitAfterSources = opts.commitAfterSources === true
	const commitAfterRoutes = opts.commitAfterRoutes === true
	const suffixAfterSources = Array.isArray(opts.suffixAfterSources) ? opts.suffixAfterSources : []

	const { sources, routes } = partitionTakeJobsPlayOrder(takeJobs, ch)
	const sourceLines = sources.flatMap((job) => linesForJob(job) || [])
	const orderedRoutes = orderRouteJobsByDependency(routes, takeJobs)

	if (sourceLines.length > 0) {
		/** @type {string[]} */
		const block = []
		if (leadingCommit) block.push(commitLine)
		block.push(...sourceLines)
		if (suffixAfterSources.length) block.push(...suffixAfterSources)
		if (commitAfterSources) block.push(commitLine)
		await sendAmcpLinesSequential(block, amcp)
	}

	if (orderedRoutes.length === 0) {
		if (sourceLines.length === 0) {
			if (leadingCommit || commitAfterRoutes) await amcp.mixerCommit(ch)
		}
		return
	}

	if (sourceLines.length > 0) await sleep(delays.afterSourcesMs)

	for (let i = 0; i < orderedRoutes.length; i++) {
		if (i > 0) await sleep(delays.betweenRoutesMs)
		const lines = linesForJob(orderedRoutes[i]) || []
		if (lines.length === 0) continue
		const isLast = i === orderedRoutes.length - 1
		const tail = isLast && commitAfterRoutes ? [commitLine] : []
		await sendAmcpLinesSequential([...lines, ...tail], amcp)
	}
}

/**
 * Incoming bank-B fade-in line for one take job (bank crossfade).
 * @param {object} job
 * @param {number} channel
 * @param {number} fadeDur
 * @param {string} [fadeTw]
 */
function incomingCrossfadeOpacityLine(job, channel, fadeDur, fadeTw) {
	if (!job?.incomingIsAboveOutgoing) return null
	const pIn = parseInt(job.pLayer, 10)
	if (!Number.isFinite(pIn)) return null
	const ch = parseInt(channel, 10)
	let tail = `${job.targetOpacity != null ? job.targetOpacity : 1} ${fadeDur}`
	if (fadeTw) tail += ` ${fadeTw}`
	return `MIXER ${ch}-${pIn} OPACITY ${tail}`
}

/**
 * Staggered route PLAY runs after the source batch. Drop incoming fade-in lines for route
 * physical layers from suffixAfterSources — those fades must follow each route PLAY.
 * @param {string[]} crossfadeLines
 * @param {object[]} takeJobs
 */
function crossfadeSuffixLinesForStaggeredRoutes(crossfadeLines, takeJobs) {
	const routeIncomingPLayers = new Set(
		(takeJobs || [])
			.filter((j) => isRouteClip(j?.clip) && j.incomingIsAboveOutgoing)
			.map((j) => parseInt(j.pLayer, 10))
			.filter((n) => Number.isFinite(n)),
	)
	if (routeIncomingPLayers.size === 0) return crossfadeLines || []

	return (crossfadeLines || []).filter((line) => {
		const m = String(line || '').match(/^MIXER (\d+)-(\d+) OPACITY (\S+)/i)
		if (!m) return true
		const target = parseFloat(m[3])
		const pLayer = parseInt(m[2], 10)
		// Outgoing fades tween to 0; incoming fades use target opacity (usually 1).
		if (target === 0) return true
		return !routeIncomingPLayers.has(pLayer)
	})
}

module.exports = {
	parseRouteClip,
	isRouteClip,
	findSelfRouteViolation,
	findSceneSelfRouteViolation,
	assertSceneHasNoSelfRoutes,
	findCrossChannelRouteCycles,
	remapIntraLookRoutesForTakeChannel,
	partitionTakeJobsPlayOrder,
	orderRouteJobsByDependency,
	resolveRoutePlayDelays,
	sendStaggeredTakePlays,
	incomingCrossfadeOpacityLine,
	crossfadeSuffixLinesForStaggeredRoutes,
}

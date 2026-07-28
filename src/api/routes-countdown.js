/**
 * routes-countdown.js — Companion-facing control API for countdown/timer CG template layers (WO-169).
 *
 * Endpoints (all under /api/countdown):
 *
 *   POST /api/countdown/start   — { cmd: 'start' } CG UPDATE
 *   POST /api/countdown/pause   — { cmd: 'pause' } CG UPDATE
 *   POST /api/countdown/reset   — { cmd: 'reset' } CG UPDATE
 *   POST /api/countdown/set     — full config CG UPDATE (no `cmd` — does not touch run state)
 *   POST /api/countdown/update  — alias of `set`
 *   POST /api/countdown/off     — { cmd: 'off' } CG CLEAR (WO-207 T207.4)
 *   GET  /api/countdown/list    — enumerate countdown template layers across live/current looks
 *
 * STATELESS by design — the anti-pattern to avoid is routes-lower-thirds.js's per-channel
 * singleton (`ensureState`), which is NOT multi-instance-safe (see WO-169 investigation notes).
 * Every request here resolves its own Caspar host layer from the explicit `{ channel, layer }` /
 * `{ mainIdx, layerNumber }` addressing and emits a CG UPDATE directly — no appCtx state is kept,
 * so N countdown layers across N channels/layers are independent by construction (see
 * resolveTemplateCgHostLayer, src/engine/cg-routing.js).
 *
 * CG sub-layer index: scene take (src/engine/scene-template-cg.js buildSceneTemplateCgAmcpLines)
 * always `CG ADD`s template layers at sub-layer index **0**. That is different from
 * routes-lower-thirds.js's own standalone flow, which defaults to sub-layer `1` — that flow never
 * goes through scene take. Countdown layers only ever reach air via scene take (they are look
 * layers), so these routes default `templateHostLayer` to 0 to address the SAME CG producer
 * scene take created; a request that supplies its own `templateHostLayer` is still honored.
 *
 * WO-205: Advisory command registry (server-side)
 * `commandRegistry` keeps a module-level Map keyed `${channel}:${layer}` → {lastCmd, cmdAt, durationSec, targetTime, mode, configAt}.
 * Updated by every POST; advisory only (lost on restart — acceptable; template still owns truth).
 * Included per-item in GET /api/countdown/list as `runtime`. Panel ticks from this registry
 * regardless of which UI issued commands (≤5 s lag for externally-started timers).
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { resolveCgRequestChannel, resolveTemplateCgHostLayer } = require('../engine/cg-routing')
const liveSceneState = require('../state/live-scene-state')
const projectScenesLoad = require('../engine/project-scenes-load')

/** Caspar CG template path — see template/countdown/countdown.html. */
const COUNTDOWN_CG_NAME = 'countdown/countdown'

/** CG sub-layer index scene take always uses for template layers (buildSceneTemplateCgAmcpLines). */
const SCENE_TAKE_CG_SUBLAYER = 0

/** Body keys that are routing, not countdown config — stripped before building the `set` payload. */
const ROUTING_KEYS = new Set([
	'channel', 'layer', 'layerNumber', 'mainIdx', 'mainScreenIndex', 'screenIndex', 'templateHostLayer',
])

/**
 * WO-205 T205.1: Advisory command registry (in-memory, lost on restart).
 * Keyed `${channel}:${layer}` → { lastCmd, cmdAt, durationSec, targetTime, mode, configAt }
 * Every POST handler records cmd + cmdAt for start/pause/reset; config fields for set/update.
 * Panel ticks from this registry to mirror any initiator (inspector, companion, panel, take).
 * @type {Map<string, { lastCmd?: string, cmdAt?: number, durationSec?: number, targetTime?: string, mode?: string, configAt?: number }>}
 */
const commandRegistry = new Map()

/**
 * @param {string} value
 * @returns {boolean}
 */
function isCountdownSourceValue(value) {
	const v = String(value || '').toLowerCase().replace(/\\/g, '/')
	return v.includes('countdown/countdown')
}

/**
 * @param {object} body
 * @param {object} ctx
 * @returns {{ channel: number, hostLayer: number, templateHostLayer: number, logicalLayer: number } | null}
 */
function resolveRouting(body, ctx) {
	const b = body && typeof body === 'object' ? body : {}
	const logicalRaw = b.layer ?? b.layerNumber
	const logicalLayer = parseInt(logicalRaw, 10)
	if (!Number.isFinite(logicalLayer)) return null
	const channel = resolveCgRequestChannel(b, ctx)
	const hostLayer = resolveTemplateCgHostLayer(logicalLayer, COUNTDOWN_CG_NAME)
	const templateHostLayer = b.templateHostLayer != null ? parseInt(b.templateHostLayer, 10) : SCENE_TAKE_CG_SUBLAYER
	return { channel, hostLayer, templateHostLayer, logicalLayer }
}

/**
 * @param {object} ctx
 * @param {{ channel: number, hostLayer: number, templateHostLayer: number }} routing
 * @param {object} payloadObj
 */
async function emitCgUpdate(ctx, routing, payloadObj) {
	if (!ctx?.amcp) return { ok: false, error: 'AMCP not connected' }
	try {
		await ctx.amcp.cg.cgUpdate(routing.channel, routing.hostLayer, routing.templateHostLayer, JSON.stringify(payloadObj))
		return { ok: true }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

/**
 * WO-207 T207.4: Clear a countdown template CG from air via CG CLEAR command.
 * @param {object} ctx
 * @param {{ channel: number, hostLayer: number }} routing
 */
async function emitCgClear(ctx, routing) {
	if (!ctx?.amcp) return { ok: false, error: 'AMCP not connected' }
	try {
		await ctx.amcp.cg.cgClear(routing.channel, routing.hostLayer)
		return { ok: true }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

/* ── GET handlers ──────────────────────────────────────────── */

/**
 * @param {string} p
 * @param {object} ctx
 * @param {object} [query]
 */
function handleGet(p, ctx, query = {}) {
	if (p !== '/api/countdown/list') return null

	// WO-196 T196.3: enumerate all project countdown layers + mark on-air from live state.
	// Items keyed by {channel, layerNumber} to avoid duplicates.
	const itemMap = new Map()

	// Load all project scenes
	// Called via the module object so tests can stub it (destructured binding defeats stubs).
	let project
	try {
		project = projectScenesLoad.loadFullProject()
	} catch {
		project = null
	}
	const allScenes = (project?.scenes?.scenes || [])

	// First pass: add all countdown layers from all project scenes
	for (const scene of allScenes) {
		if (!Array.isArray(scene?.layers)) continue
		for (const layer of scene.layers) {
			const src = layer?.source
			if (!isCountdownSourceValue(src?.value)) continue
			const logicalLayer = parseInt(layer.layerNumber, 10)
			if (!Number.isFinite(logicalLayer)) continue

			// Use a composite key to track unique timer identities (assume single channel for now)
			// In multi-channel setups, this would need channel awareness from the scene.
			const key = `${logicalLayer}`
			if (!itemMap.has(key)) {
				itemMap.set(key, {
					channel: 1, // Default channel (will be overridden by live state if available)
					layerNumber: logicalLayer,
					hostLayer: resolveTemplateCgHostLayer(logicalLayer, COUNTDOWN_CG_NAME),
					sceneId: scene.id || null,
					label: src.label || null,
					config: src.countdownConfig || null,
					onAir: false,
				})
			}
		}
	}

	// Second pass: mark on-air items from live state and override with live channel info
	const liveAll = liveSceneState.getAll()
	for (const chKey of Object.keys(liveAll)) {
		const entry = liveAll[chKey]
		const layers = entry?.scene?.layers
		if (!Array.isArray(layers)) continue
		const ch = parseInt(chKey, 10)
		for (const layer of layers) {
			const src = layer?.source
			if (!isCountdownSourceValue(src?.value)) continue
			const logicalLayer = parseInt(layer.layerNumber, 10)
			if (!Number.isFinite(logicalLayer)) continue

			const key = `${logicalLayer}`
			const existing = itemMap.get(key)
			if (existing) {
				// Update with live state info (live label/config are fresher than the saved project)
				existing.channel = ch
				existing.sceneId = entry.sceneId
				existing.onAir = true
				if (src.label) existing.label = src.label
				if (src.countdownConfig) existing.config = src.countdownConfig
			} else {
				// New item from live state
				itemMap.set(key, {
					channel: ch,
					layerNumber: logicalLayer,
					hostLayer: resolveTemplateCgHostLayer(logicalLayer, COUNTDOWN_CG_NAME),
					sceneId: entry.sceneId,
					label: src.label || null,
					config: src.countdownConfig || null,
					onAir: true,
				})
			}
		}
	}

	// WO-205 T205.1: Augment items with runtime from the command registry (advisory).
	const items = Array.from(itemMap.values()).map(item => {
		const registryKey = `${item.channel}:${item.layerNumber}`
		const runtime = commandRegistry.get(registryKey) || null
		return { ...item, runtime }
	})
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ items }) }
}

/* ── POST handlers ─────────────────────────────────────────── */

/**
 * @param {string} p
 * @param {string|object} body
 * @param {object} ctx
 */
async function handlePost(p, body, ctx) {
	const m = p.match(/^\/api\/countdown\/(start|pause|reset|set|update|off)$/)
	if (!m) return null

	const b = parseBody(body)
	const routing = resolveRouting(b, ctx)
	if (!routing) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'Missing layer (or layerNumber)' }) }
	}

	const cmd = m[1]
	let res

	// WO-207 T207.4: off command clears the CG via CG CLEAR instead of CG UPDATE
	if (cmd === 'off') {
		res = await emitCgClear(ctx, routing)
	} else {
		let payload
		if (cmd === 'set' || cmd === 'update') {
			payload = {}
			for (const [k, v] of Object.entries(b)) {
				if (!ROUTING_KEYS.has(k)) payload[k] = v
			}
		} else {
			payload = { cmd }
		}
		res = await emitCgUpdate(ctx, routing, payload)
	}

	// WO-205 T205.1: Record command or config change in the registry for panel mirroring.
	const registryKey = `${routing.channel}:${routing.logicalLayer}`
	const now = Date.now()
	let registryEntry = commandRegistry.get(registryKey) || {}

	if (cmd === 'start' || cmd === 'pause' || cmd === 'reset' || cmd === 'off') {
		// Record the command + timestamp
		registryEntry.lastCmd = cmd
		registryEntry.cmdAt = now
		// For pause, we'll let the panel compute remainingAtPause from the prior start entry
	} else if (cmd === 'set' || cmd === 'update') {
		// Record config fields + timestamp
		const payload = {}
		for (const [k, v] of Object.entries(b)) {
			if (!ROUTING_KEYS.has(k)) payload[k] = v
		}
		if (payload.durationSec != null) registryEntry.durationSec = payload.durationSec
		if (payload.targetTime != null) registryEntry.targetTime = payload.targetTime
		if (payload.mode != null) registryEntry.mode = payload.mode
		registryEntry.configAt = now
	}

	commandRegistry.set(registryKey, registryEntry)

	return {
		status: res.ok ? 200 : 502,
		headers: JSON_HEADERS,
		body: jsonBody({
			...res,
			channel: routing.channel,
			layer: routing.hostLayer,
			logicalLayer: routing.logicalLayer,
		}),
	}
}

module.exports = { handleGet, handlePost, commandRegistry }

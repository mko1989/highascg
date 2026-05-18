/**
 * Versioned device-wide snapshot (WO-49) — aggregate device graph + GPU/DeckLink-oriented settings slices.
 * @module config/device-snapshot
 */
'use strict'

const os = require('os')
const { normalizeDeviceGraph, validateDeviceGraph } = require('./device-graph')
const { normalizeScreenDestinations } = require('./screen-destinations')
const defaults = require('./defaults')
const { normalizeCasparServerConfigPath } = require('../api/routes-caspar-config')
const { resolveMainScreenCount } = require('./routing')
const { SYSTEM_DISPLAY_KEYS, mergeSystemDisplaySettings } = require('../api/settings-os')

const DEVICE_SNAPSHOT_KIND = 'highascg-device-snapshot'
const DEVICE_SNAPSHOT_VERSION = 1
/** Reject if base64-decoded image exceeds this (10 MiB). */
const MAX_VISUAL_DECODED_BYTES = 10 * 1024 * 1024
/** Reject very large base64 strings before Buffer alloc heuristics (16 MiB text ≈ 12 MiB binary). */
const MAX_VISUAL_BASE64_CHARS = 16 * 1024 * 1024

/**
 * Screen-scoped `casparServer` keys (GPU / DeckLink consumers, modes, PortAudio per screen).
 * @param {object} cs
 * @returns {Record<string, unknown>}
 */
function pickCasparServerSnapshotSlice(cs) {
	const out = {}
	if (!cs || typeof cs !== 'object') return out
	for (const [k, v] of Object.entries(cs)) {
		if (k === 'screen_count' || k === 'transitionModel' || /^screen_[1-4]_/.test(k)) {
			out[k] = v
		}
	}
	return out
}

/**
 * Build serializable payload from on-disk config.
 * @param {object} cfg
 * @returns {{ deviceGraph: object, screenDestinations: object, gpuPhysicalTopology?: object[], settingsPatches: Record<string, unknown> }}
 */
function extractPayloadFromConfig(cfg) {
	const deviceGraph = normalizeDeviceGraph(cfg.deviceGraph)
	const screenDestinations = normalizeScreenDestinations(cfg.screenDestinations)
	const gpuPhysicalTopology = Array.isArray(cfg.gpuPhysicalTopology) && cfg.gpuPhysicalTopology.length
		? cfg.gpuPhysicalTopology
		: undefined

	const settingsPatches = {
		...pickRootDisplayKeys(cfg),
		casparServer: pickCasparServerSnapshotSlice(cfg.casparServer || defaults.casparServer),
	}
	return {
		deviceGraph,
		screenDestinations,
		...(gpuPhysicalTopology ? { gpuPhysicalTopology } : {}),
		settingsPatches,
	}
}

function pickRootDisplayKeys(cfg) {
	/** @type {Record<string, unknown>} */
	const o = {}
	for (const k of SYSTEM_DISPLAY_KEYS) {
		if (cfg[k] !== undefined) o[k] = cfg[k]
	}
	return o
}

/**
 * @param {string} b64
 * @returns {{ ok: boolean, error?: string, byteLength?: number }}
 */
function validateVisualBase64(b64) {
	if (b64 == null || b64 === '') return { ok: true, byteLength: 0 }
	if (typeof b64 !== 'string') return { ok: false, error: 'visual.data must be a string' }
	if (b64.length > MAX_VISUAL_BASE64_CHARS) return { ok: false, error: 'visual.data exceeds maximum size' }
	try {
		const buf = Buffer.from(b64, 'base64')
		if (buf.length > MAX_VISUAL_DECODED_BYTES) return { ok: false, error: 'decoded image exceeds maximum size' }
		return { ok: true, byteLength: buf.length }
	} catch {
		return { ok: false, error: 'invalid base64 in visual.data' }
	}
}

/**
 * @param {unknown} raw
 * @returns {{ ok: boolean, snapshot?: object, error?: string, details?: string[] }}
 */
function parseAndValidateDeviceSnapshot(raw) {
	const details = []
	if (!raw || typeof raw !== 'object') return { ok: false, error: 'Snapshot must be a JSON object' }
	const s = /** @type {Record<string, unknown>} */ (raw)
	if (s.kind !== DEVICE_SNAPSHOT_KIND) {
		details.push(`kind must be "${DEVICE_SNAPSHOT_KIND}"`)
	}
	const ver = Number(s.version)
	if (!Number.isFinite(ver) || ver !== DEVICE_SNAPSHOT_VERSION) {
		details.push(`version must be ${DEVICE_SNAPSHOT_VERSION} (got ${String(s.version)})`)
	}
	if (!s.payload || typeof s.payload !== 'object') details.push('payload missing or not an object')
	else {
		const p = /** @type {Record<string, unknown>} */ (s.payload)
		if (p.deviceGraph != null) {
			const g = normalizeDeviceGraph(p.deviceGraph)
			const v = validateDeviceGraph(g)
			if (!v.ok) details.push(`deviceGraph: ${(v.errors || []).join('; ')}`)
		}
		if (p.screenDestinations != null) {
			normalizeScreenDestinations(p.screenDestinations)
		}
	}
	if (s.visual != null && typeof s.visual === 'object') {
		const vis = /** @type {Record<string, unknown>} */ (s.visual)
		if (vis.data != null && vis.data !== '') {
			const vr = validateVisualBase64(String(vis.data))
			if (!vr.ok) details.push(vr.error || 'visual invalid')
		}
	}
	if (details.length) return { ok: false, error: 'Invalid device snapshot', details }
	return { ok: true, snapshot: s }
}

/**
 * Apply snapshot fields onto a cloned config object (mutates clone).
 * @param {object} next
 * @param {object} snapshot
 * @param {'full' | 'graphOnly'} mode
 */
function applySnapshotToConfigClone(next, snapshot, mode) {
	const p = snapshot.payload || {}
	if (mode === 'full' || mode === 'graphOnly') {
		if (p.deviceGraph != null) {
			next.deviceGraph = normalizeDeviceGraph(p.deviceGraph)
		}
	}
	if (mode !== 'full') return

	if (p.screenDestinations != null) {
		next.screenDestinations = normalizeScreenDestinations(p.screenDestinations)
	}
	if (Array.isArray(p.gpuPhysicalTopology)) {
		next.gpuPhysicalTopology = normalizeGpuPhysicalTopologyInput(p.gpuPhysicalTopology)
	}
	const sp = p.settingsPatches && typeof p.settingsPatches === 'object' ? p.settingsPatches : {}
	const fakeCtx = { config: next }
	mergeSystemDisplaySettings(fakeCtx, sp)
	if (sp.casparServer && typeof sp.casparServer === 'object') {
		next.casparServer = { ...defaults.casparServer, ...(next.casparServer || {}), ...sp.casparServer }
		normalizeCasparServerConfigPath(next.casparServer)
	}
	const mainCount = resolveMainScreenCount(next)
	next.screen_count = mainCount
	if (!next.casparServer) next.casparServer = { ...defaults.casparServer }
	next.casparServer.screen_count = mainCount
}

/** @param {unknown[]} rows @returns {object[]} */
function normalizeGpuPhysicalTopologyInput(rows) {
	return rows
		.map((row, i) => {
			if (!row || typeof row !== 'object') return null
			const physicalPortId = String(row.physicalPortId || '').trim()
			if (!physicalPortId) return null
			const normalizeDp = (v) => String(v || '').trim().toUpperCase().replace(/^CARD\d+-/i, '')
			const dpA = normalizeDp(row.dpA)
			const dpB = normalizeDp(row.dpB)
			return {
				physicalPortId,
				slotOrder: Number.isFinite(Number(row.slotOrder)) ? Number(row.slotOrder) : i,
				dpA,
				dpB,
				connectorNumber: Number.isFinite(Number(row.connectorNumber)) ? Number(row.connectorNumber) : i,
				location: Number.isFinite(Number(row.location)) ? Number(row.location) : i,
			}
		})
		.filter(Boolean)
		.sort((a, b) => a.slotOrder - b.slotOrder)
}

/**
 * Human-readable list of sections touched by an apply.
 * @param {'full' | 'graphOnly'} mode
 * @returns {string[]}
 */
function listSectionsTouched(mode) {
	if (mode === 'graphOnly') return ['deviceGraph']
	return ['deviceGraph', 'screenDestinations', 'gpuPhysicalTopology', 'systemDisplay', 'casparServer (screen-related)']
}

/**
 * @param {object} cfg
 * @param {object} snapshot
 * @param {'full' | 'graphOnly'} mode
 * @returns {string[]}
 */
function diffTopLevelKeys(cfg, snapshot, mode) {
	const p = snapshot.payload || {}
	const changed = []
	if ((mode === 'full' || mode === 'graphOnly') && p.deviceGraph != null) {
		if (JSON.stringify(normalizeDeviceGraph(cfg.deviceGraph)) !== JSON.stringify(normalizeDeviceGraph(p.deviceGraph))) {
			changed.push('deviceGraph')
		}
	}
	if (mode !== 'full') return changed
	if (p.screenDestinations != null) {
		if (JSON.stringify(normalizeScreenDestinations(cfg.screenDestinations)) !== JSON.stringify(normalizeScreenDestinations(p.screenDestinations))) {
			changed.push('screenDestinations')
		}
	}
	if (Array.isArray(p.gpuPhysicalTopology)) {
		const n = normalizeGpuPhysicalTopologyInput(p.gpuPhysicalTopology)
		const cur = Array.isArray(cfg.gpuPhysicalTopology) ? cfg.gpuPhysicalTopology : []
		if (JSON.stringify(cur) !== JSON.stringify(n)) changed.push('gpuPhysicalTopology')
	}
	const sp = p.settingsPatches && typeof p.settingsPatches === 'object' ? p.settingsPatches : {}
	for (const k of SYSTEM_DISPLAY_KEYS) {
		if (sp[k] === undefined) continue
		if (JSON.stringify(cfg[k]) !== JSON.stringify(sp[k])) changed.push(`settings:${k}`)
	}
	if (sp.casparServer && typeof sp.casparServer === 'object') {
		const merged = { ...pickCasparServerSnapshotSlice(cfg.casparServer || {}), ...pickCasparServerSnapshotSlice(sp.casparServer) }
		if (JSON.stringify(pickCasparServerSnapshotSlice(cfg.casparServer || {})) !== JSON.stringify(merged)) {
			changed.push('casparServer (screen fields)')
		}
	}
	return changed
}

function buildEnvelopeFromCtx(ctx) {
	const pkg = safeReadPackageVersion()
	return {
		kind: DEVICE_SNAPSHOT_KIND,
		version: DEVICE_SNAPSHOT_VERSION,
		createdAt: new Date().toISOString(),
		appVersion: pkg,
		host: { hostname: os.hostname() },
		payload: extractPayloadFromConfig(ctx.configManager ? ctx.configManager.get() : ctx.config),
	}
}

function safeReadPackageVersion() {
	try {
		// eslint-disable-next-line import/no-dynamic-require, global-require
		return require('../../package.json').version || '0.0.0'
	} catch {
		return '0.0.0'
	}
}

const SNAPSHOT_JSON_SCHEMA = Object.freeze({
	$schema: 'http://json-schema.org/draft-07/schema#',
	title: 'HighAsCG device snapshot',
	type: 'object',
	required: ['kind', 'version', 'payload'],
	properties: {
		kind: { const: DEVICE_SNAPSHOT_KIND },
		version: { type: 'integer', const: DEVICE_SNAPSHOT_VERSION },
		deviceName: { type: 'string' },
		slug: { type: 'string' },
		createdAt: { type: 'string', format: 'date-time' },
		appVersion: { type: 'string' },
		host: { type: 'object', additionalProperties: true },
		notes: { type: 'string' },
		visual: {
			type: 'object',
			properties: {
				mimeType: { const: 'image/png' },
				encoding: { const: 'base64' },
				width: { type: 'integer' },
				height: { type: 'integer' },
				data: { type: 'string' },
			},
		},
		payload: { type: 'object' },
	},
})

module.exports = {
	DEVICE_SNAPSHOT_KIND,
	DEVICE_SNAPSHOT_VERSION,
	MAX_VISUAL_DECODED_BYTES,
	extractPayloadFromConfig,
	parseAndValidateDeviceSnapshot,
	validateVisualBase64,
	applySnapshotToConfigClone,
	listSectionsTouched,
	diffTopLevelKeys,
	buildEnvelopeFromCtx,
	pickCasparServerSnapshotSlice,
	SNAPSHOT_JSON_SCHEMA,
}

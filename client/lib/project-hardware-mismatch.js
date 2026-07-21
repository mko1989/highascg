/**
 * Compare saved project `hardwareConfig` to live machine probe (Device View / device snapshot).
 * @see from_server/PROJECT_HARDWARE_PERSISTENCE_AND_MISMATCH_MODAL.md
 */
import { api } from './api-client.js'

/** @typedef {'hard' | 'soft' | 'none'} MismatchSeverity */
/** @typedef {{ section: string, message: string, severity: MismatchSeverity }} MismatchItem */

export const OS_DISPLAY_KEY_RE =
	/^(screen_\d+_os_|multiview_os_|screen_count$|x11_horizontal_swap$)/

/**
 * @param {unknown} hw
 * @returns {boolean}
 */
export function hasProjectHardwareConfig(hw) {
	if (!hw || typeof hw !== 'object') return false
	const h = /** @type {Record<string, unknown>} */ (hw)
	return !!(
		h.deviceGraph ||
		h.screenDestinations ||
		h.casparServer ||
		h.gpuPhysicalTopology ||
		h.osDisplay
	)
}

/**
 * @returns {Promise<{ deviceViewSnap: object|null, deviceSnapBuild: object|null, settings: object|null }>}
 */
export async function fetchLiveHardwareContext() {
	const [deviceViewSnap, deviceSnapBuild, settings] = await Promise.all([
		api.get('/api/device-view/snapshot').catch(() => null),
		api.get('/api/device-snapshot/build').catch(() => null),
		api.get('/api/settings').catch(() => null),
	])
	return {
		deviceViewSnap: deviceViewSnap && typeof deviceViewSnap === 'object' ? deviceViewSnap : null,
		deviceSnapBuild: deviceSnapBuild && typeof deviceSnapBuild === 'object' ? deviceSnapBuild : null,
		settings: settings && typeof settings === 'object' ? settings : null,
	}
}

/**
 * @param {object|null|undefined} ctx
 * @returns {object|null}
 */
export function liveGraphFromContext(ctx) {
	const snap = ctx?.deviceViewSnap
	if (snap?.graph && typeof snap.graph === 'object') return snap.graph
	if (snap?.deviceGraph && typeof snap.deviceGraph === 'object') return snap.deviceGraph
	const payload = ctx?.deviceSnapBuild?.payload
	if (payload?.deviceGraph && typeof payload.deviceGraph === 'object') return payload.deviceGraph
	if (ctx?.settings?.deviceGraph && typeof ctx.settings.deviceGraph === 'object') {
		return ctx.settings.deviceGraph
	}
	return null
}

/**
 * @param {object|null|undefined} ctx
 * @returns {unknown[]}
 */
export function liveDisplaysFromContext(ctx) {
	const snap = ctx?.deviceViewSnap
	if (Array.isArray(snap?.gpu?.displays)) return snap.gpu.displays
	if (Array.isArray(snap?.hardware?.displays)) return snap.hardware.displays
	if (Array.isArray(snap?.displays)) return snap.displays
	const payload = ctx?.deviceSnapBuild?.payload
	if (Array.isArray(payload?.displays)) return payload.displays
	return []
}

/**
 * @param {object|null|undefined} graph
 */
function graphSummary(graph) {
	const connectors = Array.isArray(graph?.connectors) ? graph.connectors : []
	const edges = Array.isArray(graph?.edges) ? graph.edges : []
	const externalRefs = new Set()
	for (const c of connectors) {
		const ref = c?.externalRef != null ? String(c.externalRef).trim() : ''
		if (ref) externalRefs.add(ref)
	}
	return { connectorCount: connectors.length, edgeCount: edges.length, externalRefs }
}

/**
 * @param {object} hardwareConfig
 */
export function osDisplayKeysFromHardware(hardwareConfig) {
	const out = {}
	const cs =
		hardwareConfig?.casparServer && typeof hardwareConfig.casparServer === 'object'
			? hardwareConfig.casparServer
			: {}
	for (const [k, v] of Object.entries(cs)) {
		if (OS_DISPLAY_KEY_RE.test(k)) out[k] = v
	}
	if (hardwareConfig?.osDisplay && typeof hardwareConfig.osDisplay === 'object') {
		Object.assign(out, hardwareConfig.osDisplay)
	}
	return out
}

/**
 * @param {object|null|undefined} ctx
 */
function liveOsKeyMap(ctx) {
	const out = {}
	const cs =
		ctx?.settings?.casparServer && typeof ctx.settings.casparServer === 'object'
			? ctx.settings.casparServer
			: {}
	for (const [k, v] of Object.entries(cs)) {
		if (OS_DISPLAY_KEY_RE.test(k)) out[k] = v
	}
	const liveOs =
		ctx?.settings?.osDisplay && typeof ctx.settings.osDisplay === 'object'
			? ctx.settings.osDisplay
			: ctx?.deviceSnapBuild?.payload?.osDisplay && typeof ctx.deviceSnapBuild.payload.osDisplay === 'object'
			? ctx.deviceSnapBuild.payload.osDisplay
			: {}
	for (const [k, v] of Object.entries(liveOs)) {
		out[k] = v
	}
	const displays = liveDisplaysFromContext(ctx)
	if (Array.isArray(displays)) {
		displays.forEach((d, i) => {
			const n = d?.screenIndex ?? d?.screen ?? i + 1
			if (d?.mode != null) out[`screen_${n}_os_mode`] = d.mode
			if (d?.refreshHz != null && out[`screen_${n}_os_rate`] == null) {
				out[`screen_${n}_os_rate`] = d.refreshHz
			}
			if (d?.x != null) out[`screen_${n}_os_x`] = d.x
			if (d?.y != null) out[`screen_${n}_os_y`] = d.y
		})
	}
	return out
}

/**
 * @param {object|null|undefined} hardwareConfig
 * @param {object|null|undefined} liveCtx
 */
/** Hostnames written before the MAC-derived rename (see LEGACY_HOSTNAME_RE server-side). */
const LEGACY_SAVED_HOSTNAME_RE = /^(highascg-nvidia-|casparcg$)/i
/** Hostnames produced by hardwareIdToHostname(). */
const MIGRATED_HOSTNAME_RE = /^highascg\d{4}$/i

export function isLikelySameMachine(hardwareConfig, liveCtx) {
	const fp = hardwareConfig?.fingerprint || hardwareConfig?.hardwareFingerprint || {}
	const liveHost = liveCtx?.deviceSnapBuild?.host || liveCtx?.deviceViewSnap?.host || {}

	/* Prefer the identifiers that survive a rename. ensureHardwareHostname() rewrites the hostname
	 * to highascg#### on first boot after the migration, so comparing hostnames alone reported every
	 * pre-migration project as a foreign machine and popped the reconcile modal on every startup. */
	const savedId = fp.hardwareId != null ? String(fp.hardwareId).trim() : ''
	const liveId = liveHost.hardwareId != null ? String(liveHost.hardwareId).trim() : ''
	if (savedId && liveId) return savedId === liveId

	const savedMac = fp.mac ? String(fp.mac).trim().toLowerCase() : ''
	const liveMac = liveHost.mac ? String(liveHost.mac).trim().toLowerCase() : ''
	if (savedMac && liveMac) return savedMac === liveMac

	const savedHostname = String(
		fp.hostname || hardwareConfig?.host?.hostname || hardwareConfig?.hostname || '',
	).trim()
	const liveHostname = String(liveHost.hostname || liveCtx?.deviceViewSnap?.hostname || '').trim()
	if (!savedHostname || !liveHostname) return false
	if (savedHostname === liveHostname) return true

	/* Projects saved before the rename carry no hardwareId at all, so the checks above cannot help
	 * them. The rename is ours and one-way, so a legacy name against a migrated name is treated as
	 * this machine. Worst case (a project copied from another pre-migration box) this only suppresses
	 * a modal on the server's OWN bootstrap/reconnect — it never applies hardware by itself. */
	return LEGACY_SAVED_HOSTNAME_RE.test(savedHostname) && MIGRATED_HOSTNAME_RE.test(liveHostname)
}

/**
 * @param {object|null|undefined} savedGraph
 * @param {object|null|undefined} liveGraph
 * @returns {MismatchItem[]}
 */
export function diffDeviceGraphs(savedGraph, liveGraph) {
	const items = []
	if (!savedGraph) return items
	if (!liveGraph) {
		items.push({
			section: 'Device graph',
			message: 'Live device graph unavailable — cannot verify cabling on this machine.',
			severity: 'soft',
		})
		return items
	}
	const a = graphSummary(savedGraph)
	const b = graphSummary(liveGraph)
	if (a.connectorCount !== b.connectorCount) {
		items.push({
			section: 'Device graph',
			message: `Connector count differs (${a.connectorCount} in project vs ${b.connectorCount} live).`,
			severity: 'hard',
		})
	}
	if (a.edgeCount !== b.edgeCount) {
		items.push({
			section: 'Device graph',
			message: `Cable count differs (${a.edgeCount} in project vs ${b.edgeCount} live).`,
			severity: 'soft',
		})
	}
	for (const ref of a.externalRefs) {
		if (!b.externalRefs.has(ref)) {
			items.push({
				section: 'Device graph',
				message: `Project uses connector “${ref}” which is not present on this machine.`,
				severity: 'hard',
			})
		}
	}
	return items
}

/**
 * @param {object|null|undefined} savedDest
 * @param {object|null|undefined} liveDest
 * @returns {MismatchItem[]}
 */
function diffScreenDestinations(savedDest, liveDest) {
	const items = []
	const savedList = Array.isArray(savedDest?.destinations) ? savedDest.destinations : []
	const liveList = Array.isArray(liveDest?.destinations) ? liveDest.destinations : []
	if (savedList.length !== liveList.length) {
		items.push({
			section: 'Screen destinations',
			message: `Destination count differs (${savedList.length} saved vs ${liveList.length} live).`,
			severity: 'soft',
		})
	}
	const liveIds = new Set(liveList.map((d) => String(d?.id || '')))
	for (const d of savedList) {
		const id = String(d?.id || '')
		if (id && !liveIds.has(id)) {
			items.push({
				section: 'Screen destinations',
				message: `Saved destination “${d?.label || id}” is not in the live config.`,
				severity: 'soft',
			})
		}
	}
	return items
}

/** OS keys where unset / false / empty are equivalent (server often omits defaults). */
const OS_BOOLEAN_KEYS = new Set(['x11_horizontal_swap'])

/** Live settings often omit these; treat as defaults when comparing. */
function defaultOsValueForKey(key) {
	if (/_os_backend$/.test(key)) return 'xrandr'
	if (/_os_timing_source$/.test(key)) return 'cvt'
	return null
}

/** @param {unknown} rate */
function osRatesEquivalent(a, b) {
	const fa = parseFloat(String(a))
	const fb = parseFloat(String(b))
	if (!Number.isFinite(fa) || !Number.isFinite(fb)) {
		return normalizeOsScalar(a) === normalizeOsScalar(b)
	}
	return Math.abs(fa - fb) < 0.15
}

/**
 * @param {unknown} value
 */
function toOsBool(value) {
	if (value === undefined || value === null || value === '' || value === '—') return false
	if (value === false || value === 0 || value === '0' || value === 'false') return false
	if (value === true || value === 1 || value === '1' || value === 'true') return true
	return !!value
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeOsScalar(value) {
	if (value === undefined || value === null || value === '') return null
	return String(value).trim()
}

/**
 * @param {string} key
 * @param {unknown} a
 * @param {unknown} b
 */
function osDisplayValuesEqual(key, a, b) {
	if (OS_BOOLEAN_KEYS.has(key) || /_override$/.test(key)) {
		return toOsBool(a) === toOsBool(b)
	}
	if (/_os_rate$/.test(key)) {
		return osRatesEquivalent(a, b)
	}
	if (/_os_backend$/.test(key)) {
		const na = normalizeOsScalar(a) || 'xrandr'
		const nb = normalizeOsScalar(b) || 'xrandr'
		return na === nb
	}
	if (/_os_timing_source$/.test(key)) {
		const na = (normalizeOsScalar(a) || 'cvt').toLowerCase().replace(/-/g, '_')
		const nb = (normalizeOsScalar(b) || 'cvt').toLowerCase().replace(/-/g, '_')
		return na === nb
	}
	const na = normalizeOsScalar(a)
	const nb = normalizeOsScalar(b)
	if (na === null && nb === null) return true
	return na === nb
}

/**
 * @param {Record<string, unknown>} savedOs
 * @param {Record<string, unknown>} liveOs
 * @returns {MismatchItem[]}
 */
function diffOsLayout(savedOs, liveOs) {
	const items = []
	for (const k of Object.keys(savedOs)) {
		if (!OS_DISPLAY_KEY_RE.test(k)) continue
		const a = savedOs[k]
		const liveRaw = liveOs[k]
		const liveNorm = normalizeOsScalar(liveRaw)
		// Server often omits OS keys for heads with no live xrandr output — not a conflict.
		if (liveNorm === null && defaultOsValueForKey(k) === null) continue
		const b = liveNorm === null ? defaultOsValueForKey(k) : liveRaw
		if (osDisplayValuesEqual(k, a, b)) continue
		const fmt = (v) => (v === undefined || v === null || v === '' ? '—' : String(v))
		items.push({
			section: 'OS display layout',
			message: `${k}: project “${fmt(a)}” vs live “${fmt(liveNorm === null ? b : liveRaw)}”.`,
			severity: 'soft',
		})
	}
	return items
}

/**
 * @param {object|null|undefined} savedCs
 * @param {object|null|undefined} liveCs
 * @returns {MismatchItem[]}
 */
function diffCasparScreens(savedCs, liveCs) {
	const items = []
	if (!savedCs) return items
	const live = liveCs && typeof liveCs === 'object' ? liveCs : {}
	for (const [k, v] of Object.entries(savedCs)) {
		if (!/^screen_\d+_/.test(k) || OS_DISPLAY_KEY_RE.test(k)) continue
		if (/^screen_\d+_(mode|width|height|refresh)/.test(k) && String(live[k] ?? '') !== String(v ?? '')) {
			items.push({
				section: 'Caspar screen modes',
				message: `${k}: project “${v}” vs live “${live[k] ?? '—'}”.`,
				severity: 'soft',
			})
		}
	}
	const savedCount = Number(savedCs.screen_count)
	const liveCount = Number(live.screen_count)
	if (Number.isFinite(savedCount) && Number.isFinite(liveCount) && savedCount !== liveCount) {
		items.push({
			section: 'Caspar screens',
			message: `Screen count differs (${savedCount} in project vs ${liveCount} live).`,
			severity: 'hard',
		})
	}
	return items
}

/**
 * @param {object|null|undefined} hardwareConfig
 * @param {object|null|undefined} liveCtx
 * @returns {{ severity: MismatchSeverity, items: MismatchItem[], sameMachine: boolean }}
 */
export function detectHardwareMismatch(hardwareConfig, liveCtx) {
	if (!hasProjectHardwareConfig(hardwareConfig)) {
		return { severity: 'none', items: [], sameMachine: false }
	}
	const items = []
	items.push(
		...diffDeviceGraphs(
			hardwareConfig?.deviceGraph,
			liveGraphFromContext(liveCtx) || liveCtx?.settings?.deviceGraph,
		),
	)
	items.push(
		...diffScreenDestinations(
			hardwareConfig?.screenDestinations,
			liveCtx?.settings?.screenDestinations || liveCtx?.deviceSnapBuild?.payload?.screenDestinations,
		),
	)
	items.push(...diffOsLayout(osDisplayKeysFromHardware(hardwareConfig), liveOsKeyMap(liveCtx)))
	items.push(
		...diffCasparScreens(
			hardwareConfig?.casparServer,
			liveCtx?.settings?.casparServer || liveCtx?.deviceSnapBuild?.payload?.casparServer,
		),
	)
	const savedTopo = hardwareConfig?.gpuPhysicalTopology
	const liveTopo =
		liveCtx?.settings?.gpuPhysicalTopology ||
		liveCtx?.deviceSnapBuild?.payload?.gpuPhysicalTopology
	if (savedTopo && liveTopo && JSON.stringify(savedTopo) !== JSON.stringify(liveTopo)) {
		items.push({
			section: 'GPU topology',
			message: 'Physical GPU port map in the project differs from this machine.',
			severity: 'soft',
		})
	} else if (savedTopo && !liveTopo) {
		items.push({
			section: 'GPU topology',
			message: 'Project includes GPU port map; live topology was not reported.',
			severity: 'soft',
		})
	}

	let severity = /** @type {MismatchSeverity} */ ('none')
	for (const it of items) {
		if (it.severity === 'hard') severity = 'hard'
		else if (it.severity === 'soft' && severity !== 'hard') severity = 'soft'
	}
	return {
		severity,
		items,
		sameMachine: isLikelySameMachine(hardwareConfig, liveCtx),
	}
}

/**
 * Build device-snapshot envelope for POST /api/device-snapshot/apply from project hardware slice.
 * @param {object} hardwareConfig
 */
export function buildDeviceSnapshotFromHardwareConfig(hardwareConfig) {
	if (!hardwareConfig || typeof hardwareConfig !== 'object') return null
	/** @type {Record<string, unknown>} */
	const payload = {}
	const copyKeys = [
		'deviceGraph',
		'screenDestinations',
		'casparServer',
		'gpuPhysicalTopology',
		'osDisplay',
		'audioRouting',
		'streamingChannel',
		'dmx',
		'recordOutputs',
		'streamOutputs',
		'audioOutputs',
		'multiviewLayout',
	]
	for (const k of copyKeys) {
		if (hardwareConfig[k] != null) payload[k] = hardwareConfig[k]
	}
	const osKeys = osDisplayKeysFromHardware(hardwareConfig)
	if (Object.keys(osKeys).length) {
		payload.osDisplay = { ...(payload.osDisplay || {}), ...osKeys }
		if (!payload.casparServer) payload.casparServer = { ...osKeys }
		else payload.casparServer = { .../** @type {object} */ (payload.casparServer), ...osKeys }
	}
	if (!Object.keys(payload).length) return null
	return {
		kind: 'highascg-device-snapshot',
		version: 1,
		deviceName: 'Project hardware',
		payload,
	}
}

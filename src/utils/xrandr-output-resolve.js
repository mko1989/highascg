'use strict'

const { getGpuConnectorInventory, getDisplaysXrandrDetailed } = require('./hardware-info')
const { normalizePortName } = require('./gpu-topology-xrandr')
const { aliasNameScore, connectorMediaKind } = require('./gpu-display-alias')

/** @param {string} name */
function looksLikeDrmConnectorName(name) {
	return /^card\d+-/i.test(String(name || '').trim())
}

/**
 * DRM sysfs / modetest connector ids (not NVIDIA-style xrandr names).
 * @param {string} name
 */
function looksLikeDrmStylePortName(name) {
	const s = String(name || '')
		.trim()
		.replace(/^card\d+-/i, '')
	if (!s) return false
	if (/^HDMI-[AB]-\d+$/i.test(s)) return true
	if (/^DisplayPort-/i.test(s)) return true
	return false
}

/** @param {string} name */
function looksLikeXrandrOutputName(name) {
	const s = String(name || '').trim()
	if (!s) return false
	if (looksLikeDrmConnectorName(s)) return false
	if (looksLikeDrmStylePortName(s)) return false
	return /^(DP|HDMI|DVI|VGA|eDP|E-?DP)-/i.test(s)
}

/**
 * Operator-set xrandr alias from Device View gpu_out connectors.
 * @param {object} [config]
 * @returns {Map<string, string>} lower-case id → xrandr output name
 */
function deviceGraphXrandrAliasMap(config) {
	/** @type {Map<string, string>} */
	const out = new Map()
	const connectors = Array.isArray(config?.deviceGraph?.connectors) ? config.deviceGraph.connectors : []
	for (const c of connectors) {
		if (!c || (c.kind !== 'gpu_out' && c.kind !== 'gpu_output')) continue
		const ref = String(c.externalRef || '').trim()
		const alias = String(c.alias || c.caspar?.xrandrName || c.caspar?.runtimePort || '').trim()
		if (!ref || !alias || !looksLikeXrandrOutputName(alias)) continue
		const keys = new Set([ref, ref.replace(/^card\d+-/i, ''), normalizePortName(ref)].filter(Boolean))
		for (const k of keys) out.set(String(k).toLowerCase(), alias)
	}
	return out
}

/**
 * @param {string} raw
 * @param {Map<string, string>} aliasMap
 */
function resolveFromDeviceGraphAlias(raw, aliasMap) {
	if (!aliasMap?.size) return ''
	const keys = [raw, raw.replace(/^card\d+-/i, ''), normalizePortName(raw)].filter(Boolean)
	for (const k of keys) {
		const hit = aliasMap.get(String(k).toLowerCase())
		if (hit) return hit
	}
	return ''
}

/**
 * Physical GPU port pairing (`config.gpuPhysicalTopology`, e.g. `{physicalPortId:"gpu_p2",
 * dpA:"DP-4", dpB:"DP-5"}`): the NVIDIA driver assigns each physical port ONE of its two possible
 * xrandr names per boot/replug, so a name pinned to config on one boot ("DP-5") can legitimately be
 * the SAME physical port as a later boot's "DP-4" — not a different, disconnected output.
 * @param {string} raw e.g. "DP-5"
 * @param {object} [config]
 * @returns {{physicalPortId?: string, dpA?: string, dpB?: string}|null}
 */
function findTopologyPairForName(raw, config) {
	const list = Array.isArray(config?.gpuPhysicalTopology) ? config.gpuPhysicalTopology : []
	const key = String(raw || '').trim().toLowerCase()
	if (!key) return null
	return (
		list.find((p) => String(p?.dpA || '').toLowerCase() === key || String(p?.dpB || '').toLowerCase() === key) || null
	)
}

/**
 * @param {string} raw e.g. "DP-5"
 * @param {object} [config]
 * @param {Array<{ name?: string, connected?: boolean }>} [displays]
 * @returns {string} the pair's OTHER member if it is currently live, else ''
 */
function resolveViaPortPair(raw, config, displays) {
	const pair = findTopologyPairForName(raw, config)
	if (!pair) return ''
	const key = String(raw).trim().toLowerCase()
	const other = String(pair.dpA || '').toLowerCase() === key ? pair.dpB : pair.dpA
	if (!other) return ''
	const list = Array.isArray(displays) ? displays : getDisplaysXrandrDetailed()?.displays || []
	const live = list.some(
		(d) => d?.connected !== false && String(d?.name || '').toLowerCase() === String(other).toLowerCase(),
	)
	return live ? String(other) : ''
}

/**
 * @param {string} drmish
 * @param {Array<{ name?: string, connected?: boolean }>} [displays]
 */
function resolveViaLiveXrandrHeuristic(drmish, displays) {
	const stripped = String(drmish || '')
		.trim()
		.replace(/^card\d+-/i, '')
	if (!stripped) return ''
	const list = Array.isArray(displays) ? displays : getDisplaysXrandrDetailed()?.displays || []
	const connected = list.filter((d) => d?.connected !== false && d?.name)
	if (!connected.length) return ''

	const exact = connected.find(
		(d) =>
			String(d.name).toLowerCase() === drmish.toLowerCase() ||
			normalizePortName(d.name) === normalizePortName(drmish) ||
			normalizePortName(d.name) === normalizePortName(stripped),
	)
	if (exact?.name) return String(exact.name)

	const kind = connectorMediaKind(stripped)
	const sameKind = connected.filter((d) => connectorMediaKind(d.name) === kind && kind !== 'other')
	if (!sameKind.length) return ''
	if (sameKind.length === 1) return String(sameKind[0].name)

	let best = sameKind[0]
	let bestScore = -1
	for (const d of sameKind) {
		const score = aliasNameScore(d.name, stripped)
		if (score > bestScore) {
			bestScore = score
			best = d
		}
	}
	return bestScore > 0 ? String(best.name) : ''
}

/**
 * @param {string} raw
 * @param {string} rawKey
 * @param {ReturnType<typeof getGpuConnectorInventory>} inventory
 */
function inventoryXrandrNameFor(raw, rawKey, inventory) {
	const rawNorm = normalizePortName(raw)
	const stripped = raw.replace(/^card\d+-/i, '')
	const strippedNorm = normalizePortName(stripped)
	for (const c of inventory) {
		const full = String(c?.name || '').trim()
		const short = String(c?.shortName || '').trim()
		const card = String(c?.drmCard || '').trim()
		const cardShort = card && short ? `${card}-${short}` : ''
		const xr = String(c?.xrandrName || '').trim()
		const keys = [full, short, cardShort].filter(Boolean)
		const matched = keys.some((k) => {
			const lk = k.toLowerCase()
			return lk === rawKey || normalizePortName(k) === rawNorm || normalizePortName(k) === strippedNorm
		})
		if (matched && xr) return xr
	}
	return ''
}

/**
 * Pick the layout sysId for a gpu_out connector: operator screen binding wins over DRM externalRef.
 * @param {object} [config]
 * @param {object} [connector]
 * @param {number|null|undefined} screenIndex1 1-based screen index when bound to a program screen
 * @returns {string}
 */
function pickGpuOutLayoutSysId(config, connector, screenIndex1) {
	if (!connector) return ''
	const n = screenIndex1 != null ? parseInt(String(screenIndex1), 10) : NaN
	if (Number.isFinite(n) && n >= 1 && n <= 16) {
		const fromScreen = String(config?.[`screen_${n}_system_id`] || '').trim()
		if (fromScreen) return fromScreen
	}
	const alias = String(connector.alias || connector.caspar?.xrandrName || connector.caspar?.runtimePort || '').trim()
	if (alias && looksLikeXrandrOutputName(alias)) return alias
	return String(connector.externalRef || '').trim()
}

/**
 * Resolve a Device View / config sysId (DRM or xrandr) to a live xrandr output name.
 * @param {string} sysId
 * @param {{ inventory?: ReturnType<typeof getGpuConnectorInventory>, config?: object, displays?: object[] }} [opts]
 * @returns {string}
 */
function resolveSysIdToXrandrOutput(sysId, opts = {}) {
	const raw = String(sysId || '').trim()
	if (!raw) return ''

	const aliasMap = deviceGraphXrandrAliasMap(opts.config)
	const fromAlias = resolveFromDeviceGraphAlias(raw, aliasMap)
	if (fromAlias) return fromAlias

	const rawKey = raw.toLowerCase()
	if (looksLikeXrandrOutputName(raw)) {
		const live = (opts.displays || getDisplaysXrandrDetailed()?.displays || []).some(
			(d) => String(d?.name || '').toLowerCase() === rawKey,
		)
		if (live) return raw
		// Pinned name isn't live under itself — check whether its A/B port-pair sibling is, before
		// falling back to a fuzzy same-kind name match (this is authoritative; the heuristic below is
		// a guess).
		const viaPair = resolveViaPortPair(raw, opts.config, opts.displays)
		if (viaPair) return viaPair
	}

	const inventory = Array.isArray(opts.inventory) ? opts.inventory : getGpuConnectorInventory()
	const fromInventory = inventoryXrandrNameFor(raw, rawKey, inventory)
	if (fromInventory) return fromInventory

	const heuristic = resolveViaLiveXrandrHeuristic(raw, opts.displays)
	if (heuristic) return heuristic

	const stripped = raw.replace(/^card\d+-/i, '')
	if (stripped && stripped !== raw && looksLikeXrandrOutputName(stripped)) return stripped
	return raw
}

/**
 * Resolve all layout head sysIds to xrandr names (mutates copies only).
 * @param {{ sysId: string, [key: string]: unknown }} head
 * @param {{ inventory?: ReturnType<typeof getGpuConnectorInventory>, config?: object }} [opts]
 */
function resolveLayoutHeadSysId(head, opts = {}) {
	if (!head || typeof head !== 'object') return head
	const resolved = resolveSysIdToXrandrOutput(head.sysId, opts)
	if (!resolved || resolved === head.sysId) return head
	return { ...head, sysId: resolved, resolvedFrom: head.sysId }
}

module.exports = {
	looksLikeDrmConnectorName,
	looksLikeDrmStylePortName,
	looksLikeXrandrOutputName,
	deviceGraphXrandrAliasMap,
	pickGpuOutLayoutSysId,
	findTopologyPairForName,
	resolveViaPortPair,
	resolveSysIdToXrandrOutput,
	resolveLayoutHeadSysId,
	normalizePortName,
}

'use strict'

const { normalizeDecklinkIoDirection, DECKLINK_IO_UNASSIGNED } = require('./decklink-io-direction')

function readCasparSetting(cfg, key) {
	if (!cfg || typeof cfg !== 'object') return undefined
	const cs = cfg.casparServer && typeof cfg.casparServer === 'object' ? cfg.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
	if (Object.prototype.hasOwnProperty.call(cfg, key)) return cfg[key]
	return undefined
}

/**
 * @param {object | null | undefined} connector
 * @returns {number}
 */
function decklinkSlotFromConnector(connector) {
	const id = String(connector?.id || '')
	const m = id.match(/^dlsdi_(\d+)$/)
	if (m) {
		const n = parseInt(m[1], 10)
		if (Number.isFinite(n) && n > 0) return n
	}
	const idx = parseInt(String(connector?.index ?? ''), 10)
	if (Number.isFinite(idx) && idx >= 0) return idx + 1
	const dev = parseInt(String(connector?.externalRef ?? 0), 10) || 0
	return dev > 0 ? dev : 0
}

/**
 * Device View graph is SSOT when decklink_io connectors exist: only ports marked input.
 * @param {object | null | undefined} config
 * @returns {number[] | null} null when graph has no decklink_io rows (legacy settings path)
 */
function decklinkInputSlotsFromDeviceGraph(config) {
	const connectors = config?.deviceGraph?.connectors
	if (!Array.isArray(connectors) || !connectors.some((c) => c?.kind === 'decklink_io')) return null
	const slots = []
	for (const c of connectors) {
		if (c?.kind !== 'decklink_io') continue
		if (normalizeDecklinkIoDirection(c?.caspar) !== 'in') continue
		const slot = decklinkSlotFromConnector(c)
		if (slot > 0) slots.push(slot)
	}
	return [...new Set(slots)].sort((a, b) => a - b)
}

/**
 * @param {object | null | undefined} config
 * @param {number} slot — 1-based
 */
function isLegacyImplicitDecklinkInputSlot(config, slot, decklinkCount) {
	if (slot < 1 || slot > decklinkCount) return false
	const dir = normalizeDecklinkIoDirection({ ioDirection: readCasparSetting(config, `decklink_input_${slot}_direction`) })
	return dir !== 'out' && dir !== 'in'
}

/**
 * Slots that receive dedicated Caspar host channels / DeckLink producers.
 * @param {object | null | undefined} config
 * @returns {number[]}
 */
function resolveDecklinkInputSlots(config) {
	const fromGraph = decklinkInputSlotsFromDeviceGraph(config)
	if (fromGraph != null) return fromGraph

	const decklinkCount = Math.min(
		8,
		Math.max(0, parseInt(String(readCasparSetting(config, 'decklink_input_count') ?? 0), 10) || 0),
	)
	if (decklinkCount <= 0) return []

	let anyExplicitDirection = false
	for (let i = 1; i <= 8; i++) {
		const raw = readCasparSetting(config, `decklink_input_${i}_direction`)
		if (raw != null && String(raw).trim() !== '') anyExplicitDirection = true
	}

	const slots = []
	for (let i = 1; i <= decklinkCount; i++) {
		const dir = normalizeDecklinkIoDirection({ ioDirection: readCasparSetting(config, `decklink_input_${i}_direction`) })
		if (dir === 'out') continue
		if (dir === 'in') {
			slots.push(i)
			continue
		}
		if (!anyExplicitDirection) slots.push(i)
	}
	return slots
}

/**
 * Highest slot index configured as DeckLink input (legacy `decklink_input_count` field).
 * @param {object | null | undefined} casparServer
 * @returns {number}
 */
function recomputeDecklinkInputCount(casparServer) {
	if (!casparServer || typeof casparServer !== 'object') return 0
	let maxSlot = 0
	for (let i = 1; i <= 8; i++) {
		const d = parseInt(String(casparServer[`decklink_input_${i}_device`] ?? 0), 10) || 0
		const dir = normalizeDecklinkIoDirection({ ioDirection: casparServer[`decklink_input_${i}_direction`] })
		if (d > 0 && dir === 'in') maxSlot = i
	}
	return maxSlot
}

/**
 * Saved settings decklink_input_count (top-level or casparServer). Null when unset.
 * @param {object | null | undefined} cfg
 * @returns {number | null}
 */
function configuredDecklinkInputCount(cfg) {
	if (!cfg || typeof cfg !== 'object') return null
	const cs = cfg.casparServer && typeof cfg.casparServer === 'object' ? cfg.casparServer : {}
	const raw = cfg.decklink_input_count ?? cs.decklink_input_count
	if (raw == null || raw === '') return null
	return Math.min(8, Math.max(0, parseInt(String(raw), 10) || 0))
}

/**
 * When true, routing/counts come from saved config — not stale running Caspar XML.
 * @param {object | null | undefined} cfg
 */
function decklinkInputsConfiguredInSettings(cfg) {
	return configuredDecklinkInputCount(cfg) !== null
}

module.exports = {
	readCasparSetting,
	decklinkSlotFromConnector,
	decklinkInputSlotsFromDeviceGraph,
	isLegacyImplicitDecklinkInputSlot,
	resolveDecklinkInputSlots,
	recomputeDecklinkInputCount,
	configuredDecklinkInputCount,
	decklinkInputsConfiguredInSettings,
	DECKLINK_IO_UNASSIGNED,
}

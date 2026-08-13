'use strict'

/**
 * Operator-editable labels for non-screen live sources (WO-506).
 *
 * Screens are NOT handled here. A screen's name is the name of the destination that owns it
 * (`screenLabelsFromConfig`, WO-222 → WO-385), and the owner's rule is that it wins over everything:
 * *"the screen labels need to be over anything. if operator changes the label then this is the only
 * thing that shows everywhere."* This module covers what that mechanism does not reach — DeckLink
 * inputs, NDI, v4l2, browser/webpage hosts — so an operator can call `dlsdi_3` "Camera 2 — Wide"
 * instead of the generated "DeckLink 3".
 *
 * Store: `config.sourceLabels` — `{ [stableKey]: label }`. Empty string means ABSENCE (fall back to
 * the generated name), never "render a blank label".
 */

/** Longest label we will store. Free operator text, rendered into HTML/SVG template payloads. */
const MAX_SOURCE_LABEL = 64

/**
 * Stable key for a live source, preferring ids that survive re-cabling and re-mapping.
 *
 * `connectorId` (e.g. `dlsdi_3`) is the device-graph identity and outlives channel/layer moves, so a
 * renamed camera keeps its name when it is re-patched. `value` (`route://6-3`) is the fallback and
 * does NOT survive a move — accepted deliberately: a wrong-but-stable key would be worse than one
 * that visibly reverts to the generated name.
 *
 * @param {object|null|undefined} item an `extraLiveSources` entry
 * @returns {string} '' when nothing stable identifies it
 */
function sourceLabelKey(item) {
	if (!item || typeof item !== 'object') return ''
	const connector = String(item.connectorId || '').trim()
	if (connector) return connector
	const value = String(item.value || '').trim()
	if (value) return value
	return ''
}

/**
 * @param {object|null|undefined} cfg
 * @returns {Record<string, string>} normalized; blank entries dropped
 */
function sourceLabelsFromConfig(cfg) {
	const raw = cfg?.sourceLabels
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
	const out = {}
	for (const [k, v] of Object.entries(raw)) {
		const key = String(k || '').trim()
		const label = String(v ?? '').trim()
		if (key && label) out[key] = label.slice(0, MAX_SOURCE_LABEL)
	}
	return out
}

/**
 * Apply the operator's label to one enriched source, in place of the generated one.
 *
 * Keeps the generated name on `generatedLabel` so the inspector can show what it would revert to,
 * and flags `labelIsCustom` so a UI can distinguish "named by a human" from "named by us".
 *
 * @param {object} item enriched `extraLiveSources` entry (mutated copy returned)
 * @param {Record<string, string>} labels from {@link sourceLabelsFromConfig}
 */
function applySourceLabel(item, labels) {
	if (!item || typeof item !== 'object') return item
	const key = sourceLabelKey(item)
	const custom = key ? String(labels?.[key] ?? '').trim() : ''
	const out = { ...item, sourceLabelKey: key }
	if (!custom) {
		out.labelIsCustom = false
		return out
	}
	out.generatedLabel = String(item.label ?? '')
	out.label = custom
	out.labelIsCustom = true
	return out
}

/**
 * @param {object[]} list
 * @param {object|null|undefined} cfg
 */
function applySourceLabels(list, cfg) {
	if (!Array.isArray(list)) return []
	const labels = sourceLabelsFromConfig(cfg)
	return list.map((item) => applySourceLabel(item, labels))
}

/**
 * Write one label. Empty/whitespace REMOVES the override rather than storing a blank.
 * @param {object|null|undefined} cfg
 * @param {string} key
 * @param {string} label
 * @returns {{ ok: boolean, error?: string, sourceLabels?: Record<string, string> }}
 */
function setSourceLabelInConfig(cfg, key, label) {
	const k = String(key ?? '').trim()
	if (!k) return { ok: false, error: 'sourceId required' }
	const next = { ...sourceLabelsFromConfig(cfg) }
	const value = String(label ?? '').trim()
	if (value) next[k] = value.slice(0, MAX_SOURCE_LABEL)
	else delete next[k]
	return { ok: true, sourceLabels: next }
}

/**
 * Top-bar screen pill text (WO-506, owner 13.08): *"it should be a 3 later shorthand of the label,
 * just first 3 letters, nothing else."*
 *
 * Literally the first three characters of the resolved label — no initials, no vowel-stripping, no
 * case change. "Main" → "Mai", "Stage Left" → "Sta". Shorter labels render as-is. Display only:
 * never stored, and every other surface keeps the full label.
 *
 * @param {string} label
 * @returns {string}
 */
function shortSourcePill(label) {
	return String(label ?? '')
		.trim()
		.slice(0, 3)
}

module.exports = {
	MAX_SOURCE_LABEL,
	sourceLabelKey,
	sourceLabelsFromConfig,
	applySourceLabel,
	applySourceLabels,
	setSourceLabelInConfig,
	shortSourcePill,
}

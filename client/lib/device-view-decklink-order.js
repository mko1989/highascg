/**
 * DeckLink rear-panel port order (Device View) — shared by every client on the node (WO-598 D, client-prefs
 * `decklinkRearOrder`), with this browser's localStorage copy as the fallback.
 */

import { readGlobalPref, writeGlobalPref } from './client-prefs.js'

/** @returns {string[]} */
export function readSavedDecklinkOrder() {
	const p = readGlobalPref('decklinkRearOrder')
	return Array.isArray(p) ? p.map((x) => String(x)) : []
}

/** @param {string[] | null} ids  null clears the saved order */
export function saveDecklinkOrder(ids) {
	writeGlobalPref('decklinkRearOrder', ids ? ids.map((x) => String(x)) : null)
}

/**
 * @param {{ id: string }[]} deckMerged deduped Caspar DeckLink connectors (io + out)
 * @param {string[]} [savedOrder]
 */
export function orderDecklinkConnectors(deckMerged, savedOrder) {
	const order = Array.isArray(savedOrder) ? savedOrder.map(String) : []
	const byId = new Map(deckMerged.map((c) => [String(c.id), c]))
	const ordered = []
	for (const id of order) {
		const c = byId.get(id)
		if (c) {
			ordered.push(c)
			byId.delete(id)
		}
	}
	for (const c of deckMerged) {
		if (byId.has(String(c.id))) ordered.push(byId.get(String(c.id)))
	}
	return { ordered, orderIds: ordered.map((c) => String(c.id)) }
}

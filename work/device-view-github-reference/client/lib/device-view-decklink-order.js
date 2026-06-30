/**
 * DeckLink rear-panel port order (Device View) — persisted in localStorage.
 */

export const DECKLINK_REAR_ORDER_KEY = 'decklink_rear_panel_order'

/** @returns {string[]} */
export function readSavedDecklinkOrder() {
	try {
		const raw = localStorage.getItem(DECKLINK_REAR_ORDER_KEY)
		const p = raw ? JSON.parse(raw) : []
		return Array.isArray(p) ? p.map((x) => String(x)) : []
	} catch {
		return []
	}
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

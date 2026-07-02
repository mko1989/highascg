'use strict'

/**
 * Live program layer banks + scene deck state (WO-100 Phase D).
 * Single owner for `programLayerBankByChannel` and `scene_deck` persistence.
 */

const PERSIST_BANKS_KEY = 'programLayerBankByChannel'
const PERSIST_DECK_KEY = 'scene_deck'

/**
 * @param {unknown} raw
 * @returns {Record<string, object>}
 */
function normalizeProgramLayerBanks(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
	return { ...raw }
}

/**
 * @param {unknown} raw
 * @returns {{ looks: object[], previewSceneId: string|null, layerPresets: object[], lookPresets: object[], sceneSnapshots?: object[] }}
 */
function normalizeSceneDeck(raw) {
	if (!raw || typeof raw !== 'object') {
		return { looks: [], previewSceneId: null, layerPresets: [], lookPresets: [] }
	}
	const preview =
		raw.previewSceneId != null && String(raw.previewSceneId).trim()
			? String(raw.previewSceneId).trim()
			: null
	const deck = {
		looks: Array.isArray(raw.looks) ? raw.looks : [],
		previewSceneId: preview,
		layerPresets: Array.isArray(raw.layerPresets) ? raw.layerPresets : [],
		lookPresets: Array.isArray(raw.lookPresets) ? raw.lookPresets : [],
	}
	if (Array.isArray(raw.sceneSnapshots)) {
		deck.sceneSnapshots = raw.sceneSnapshots
	}
	return deck
}

class LiveDeckState {
	/**
	 * @param {{ get: (key: string) => unknown, set: (key: string, value: unknown) => void }} persistence
	 */
	constructor(persistence) {
		this._persistence = persistence
		this._programLayerBankByChannel = normalizeProgramLayerBanks(persistence.get(PERSIST_BANKS_KEY))
		this._sceneDeck = normalizeSceneDeck(persistence.get(PERSIST_DECK_KEY))
	}

	get programLayerBankByChannel() {
		return this._programLayerBankByChannel
	}

	get sceneDeck() {
		return this._sceneDeck
	}

	/**
	 * @param {Record<string, object>} banks
	 */
	replaceProgramLayerBanks(banks) {
		this._programLayerBankByChannel = normalizeProgramLayerBanks(banks)
	}

	/**
	 * @param {object} deck
	 */
	setSceneDeck(deck) {
		this._sceneDeck = normalizeSceneDeck(deck)
		this.persistSceneDeck()
	}

	persistProgramLayerBanks() {
		try {
			this._persistence.set(PERSIST_BANKS_KEY, this._programLayerBankByChannel)
		} catch {
			/* optional */
		}
	}

	persistSceneDeck() {
		try {
			const d = this._sceneDeck
			this._persistence.set(PERSIST_DECK_KEY, {
				looks: d.looks,
				previewSceneId: d.previewSceneId,
				layerPresets: d.layerPresets,
				lookPresets: d.lookPresets,
				...(Array.isArray(d.sceneSnapshots) ? { sceneSnapshots: d.sceneSnapshots } : {}),
			})
		} catch {
			/* optional */
		}
	}
}

/**
 * Persist `ctx.sceneDeck` when ctx is a plain object (tests); appCtx setter handles liveDeck.
 * @param {{ liveDeck?: LiveDeckState, sceneDeck?: object, persistence?: { set: (k: string, v: unknown) => void } }} ctx
 */
function persistSceneDeckForCtx(ctx) {
	if (ctx?.liveDeck?.persistSceneDeck) return
	const d = ctx?.sceneDeck
	if (!d || typeof d !== 'object') return
	const persistence = ctx.persistence || require('../utils/persistence')
	try {
		persistence.set(PERSIST_DECK_KEY, {
			looks: Array.isArray(d.looks) ? d.looks : [],
			previewSceneId:
				d.previewSceneId != null && String(d.previewSceneId).trim()
					? String(d.previewSceneId).trim()
					: null,
			layerPresets: Array.isArray(d.layerPresets) ? d.layerPresets : [],
			lookPresets: Array.isArray(d.lookPresets) ? d.lookPresets : [],
			...(Array.isArray(d.sceneSnapshots) ? { sceneSnapshots: d.sceneSnapshots } : {}),
		})
	} catch {
		/* optional */
	}
}

/**
 * @param {{ get: (key: string) => unknown, set: (key: string, value: unknown) => void }} persistence
 */
function createLiveDeckState(persistence) {
	return new LiveDeckState(persistence)
}

module.exports = {
	LiveDeckState,
	createLiveDeckState,
	persistSceneDeckForCtx,
	normalizeProgramLayerBanks,
	normalizeSceneDeck,
	PERSIST_BANKS_KEY,
	PERSIST_DECK_KEY,
}

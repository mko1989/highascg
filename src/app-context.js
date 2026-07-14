'use strict'

const { createLiveDeckState } = require('./state/live-deck-state')

/**
 * Application context factory — single construction site for `appCtx` (WO-100 Phase A).
 *
 * @typedef {object} AppContext
 * @property {object} config — runtime config (mutated in place via ConfigManager sync)
 * @property {import('./state/state-manager').StateManager} state — Caspar channels, media, templates
 * @property {object} variables — alias of state.variables
 * @property {object} gatheredInfo — INFO/CLS gather scratch (channelXml, decklink, …)
 * @property {Array<{ id: string, label: string }>} CHOICES_MEDIAFILES — derived view of state.media
 * @property {Array<{ id: string, label: string }>} CHOICES_TEMPLATES — derived view of state.templates
 * @property {Record<string, string>} mediaDetails — CINF text by media id
 * @property {import('./state/live-deck-state').LiveDeckState} liveDeck — PGM banks + scene deck owner
 * @property {Record<string, object>} programLayerBankByChannel — live PGM layer banks (via liveDeck)
 * @property {object|null} _multiviewLayout — persisted multiview layout blob
 * @property {object} sceneDeck — looks / presets deck state (via liveDeck)
 * @property {import('./utils/persistence')} persistence
 * @property {import('./caspar/connection-manager').ConnectionManager|null} amcp
 * @property {import('./engine/timeline-engine').TimelineEngine|null} timelineEngine
 * @property {object|null} oscState
 * @property {{ connected: boolean, host: string, port: number }} _casparStatus
 * @property {import('./config/config-manager').ConfigManager} configManager
 * @property {import('./sampling/dmx-sampling').SamplingManager|null} samplingManager
 * @property {() => object} getState
 * @property {() => object} [getStateWsBootstrap]
 * @property {(level: string, msg: string) => void} log
 * @property {(ctx: AppContext, data: object) => void} setUiSelection
 * @property {() => boolean} resetConfigToDefaults
 * @property {(type: string, payload?: object) => void} [_wsBroadcast]
 */

/**
 * @param {import('./state/state-manager').StateManager} state
 * @returns {Array<{ id: string, label: string }>}
 */
function catalogMediaFromState(state) {
	const media = state?.getState?.()?.media
	if (!Array.isArray(media)) return []
	return media.map((m) => ({
		id: m.id,
		label: m.label || m.id,
		...(m.type ? { type: m.type } : {}),
		...(m.cinf ? { cinf: m.cinf } : {}),
	}))
}

/**
 * @param {import('./state/state-manager').StateManager} state
 * @returns {Array<{ id: string, label: string }>}
 */
function catalogTemplatesFromState(state) {
	const templates = state?.getState?.()?.templates
	if (!Array.isArray(templates)) return []
	return templates.map((t) => ({ id: t.id, label: t.label || t.id }))
}

/**
 * @param {AppContext} ctx
 */
function attachCatalogGetters(ctx) {
	Object.defineProperty(ctx, 'CHOICES_MEDIAFILES', {
		get: () => catalogMediaFromState(ctx.state),
		enumerable: true,
		configurable: true,
	})
	Object.defineProperty(ctx, 'CHOICES_TEMPLATES', {
		get: () => catalogTemplatesFromState(ctx.state),
		enumerable: true,
		configurable: true,
	})
}

function attachLiveDeckAccessors(ctx, liveDeck) {
	ctx.liveDeck = liveDeck
	Object.defineProperty(ctx, 'programLayerBankByChannel', {
		get: () => liveDeck.programLayerBankByChannel,
		set: (v) => liveDeck.replaceProgramLayerBanks(v),
		enumerable: true,
		configurable: true,
	})
	Object.defineProperty(ctx, 'sceneDeck', {
		get: () => liveDeck.sceneDeck,
		set: (v) => liveDeck.setSceneDeck(v),
		enumerable: true,
		configurable: true,
	})
}

/**
 * @param {AppContext} ctx
 */
function sealAppContextBootFields(ctx) {
	for (const key of ['config', 'state', 'persistence', 'configManager']) {
		if (!(key in ctx)) continue
		const val = ctx[key]
		Object.defineProperty(ctx, key, {
			value: val,
			writable: false,
			configurable: false,
			enumerable: true,
		})
	}
}

/**
 * @param {{
 *   config: object,
 *   state: import('./state/state-manager').StateManager,
 *   persistence: object,
 *   configManager: import('./config/config-manager').ConfigManager,
 *   liveDeck?: import('./state/live-deck-state').LiveDeckState,
 *   multiviewLayout: object|null,
 *   log: (level: string, msg: string) => void,
 *   resetConfigToDefaults: () => boolean,
 *   setUiSelection: (ctx: AppContext, data: object) => void,
 *   casparHost: string,
 *   casparPort: number,
 * }} deps
 * @returns {AppContext}
 */
function createAppContext(deps) {
	const liveDeck = deps.liveDeck || createLiveDeckState(deps.persistence)
	/** @type {AppContext} */
	const ctx = {
		config: deps.config,
		state: deps.state,
		variables: deps.state.variables,
		gatheredInfo: {
			channelIds: [],
			channelStatusLines: {},
			channelXml: {},
			infoConfig: '',
			infoPaths: '',
			infoSystem: '',
			decklinkFromConfig: {},
		},
		mediaDetails: {},
		liveDeck,
		_multiviewLayout: deps.multiviewLayout,
		/** WO-156: plural map (n → apply body) is the multiview source of truth; singular kept for old readers. */
		_multiviewLayouts: deps.multiviewLayout ? { 1: deps.multiviewLayout } : {},
		persistence: deps.persistence,
		amcp: null,
		timelineEngine: null,
		oscState: null,
		_casparStatus: {
			connected: false,
			host: deps.casparHost,
			port: deps.casparPort,
		},
		configManager: deps.configManager,
		samplingManager: null,
		log: deps.log,
		setUiSelection: deps.setUiSelection,
		resetConfigToDefaults: deps.resetConfigToDefaults,
	}

	attachCatalogGetters(ctx)
	attachLiveDeckAccessors(ctx, liveDeck)
	sealAppContextBootFields(ctx)
	return ctx
}

module.exports = {
	createAppContext,
	attachCatalogGetters,
	attachLiveDeckAccessors,
	sealAppContextBootFields,
	catalogMediaFromState,
	catalogTemplatesFromState,
}

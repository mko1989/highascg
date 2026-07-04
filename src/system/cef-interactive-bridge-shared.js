'use strict'

const { getCefFocusTarget } = require('./cef-focus-registry')
const { clearStableCefPages } = require('./cef-interactive-cdp')

const S = {
	x11Proc: null,
	cefBrowser: null,
	activeKey: null,
	zoneTargets: new Map(),
	debugPort: 0,
	infoPollTimer: null,
	amcpRef: null,
	pageHint: { needle: null, hasHtml: false, playArg: null },
	pageHintAt: 0,
	keyboardZoneId: null,
	pointerInZone: null,
	warmInFlight: null,
	lastWarmAt: 0,
	bridgeConfigRef: null,
	focusUnsubscribe: null,
	bridgeLogRef: null,
	eventChain: Promise.resolve(),
	PAGE_HINT_TTL_MS: 4000,
	WARM_INTERVAL_MS: 5000,
	ZONE_WARM_DEBOUNCE_MS: 150,
}

function forceLegacyInfoPath() {
	const v = String(process.env.HIGHASCG_CEF_FORCE_LEGACY_INFO || '').trim().toLowerCase()
	return v === '1' || v === 'true' || v === 'yes'
}

function hostFocusActive() {
	return !forceLegacyInfoPath() && !!getCefFocusTarget()?.needle
}

function syncPageHintFromFocus() {
	const focus = getCefFocusTarget()
	if (!focus?.needle) return false
	let playArg = focus.playArg || null
	if (!playArg && S.bridgeConfigRef) {
		const list = Array.isArray(S.bridgeConfigRef.extraLiveSources) ? S.bridgeConfigRef.extraLiveSources : []
		const src = list.find((s) => String(s.sourceId || '') === String(focus.sourceId || ''))
		playArg = src?.playArg || src?.templateOrUrl || null
	}
	if (S.pageHint.needle !== focus.needle || S.pageHint.playArg !== playArg) clearStableCefPages()
	S.pageHint = { needle: focus.needle, hasHtml: true, playArg: playArg || null }
	S.pageHintAt = Date.now()
	return true
}

module.exports = { S, hostFocusActive, syncPageHintFromFocus, forceLegacyInfoPath }

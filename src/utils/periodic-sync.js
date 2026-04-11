/**
 * Periodic AMCP refresh: INFO on program/preview channels, or light CLS/TLS + INFO CONFIG when OSC drives layers.
 * Interval off by default — set `periodic_sync_interval_sec` or `HIGHASCG_PERIODIC_SYNC_SEC`.
 * @see companion-module-casparcg-server/src/periodic-sync.js
 */
'use strict'

const { getChannelMap } = require('../config/routing')
const { reconcileLiveSceneFromGatheredXml } = require('../state/live-scene-reconcile')
const playbackTracker = require('../state/playback-tracker')
const { responseToStr, updateChannelVariablesFromXml } = require('./query-cycle')
const handlers = require('./handlers')

/** @type {ReturnType<typeof setInterval> | null} */
let oscPlaybackInfoTimer = null

/**
 * @param {object} self - app context
 * @returns {number[]}
 */
function getSyncChannelIds(self) {
	const map = getChannelMap(self.config || {})
	const want = new Set()
	for (const ch of map.programChannels || []) want.add(ch)
	for (const ch of map.previewChannels || []) want.add(ch)
	const valid = new Set(self.gatheredInfo?.channelIds || [])
	return [...want].filter((c) => valid.has(c))
}

/** Program channels for AMCP INFO when OSC is on — do not require `gatheredInfo.channelIds` (may be empty before first query cycle). */
function getProgramChannelsForOscInfo(self) {
	const map = getChannelMap(self.config || {})
	const want = (map.programChannels || []).filter((c) => Number.isFinite(c))
	const valid = new Set(self.gatheredInfo?.channelIds || [])
	if (valid.size === 0) return want
	const filtered = want.filter((c) => valid.has(c))
	return filtered.length ? filtered : want
}

function clearPeriodicSyncTimer(self) {
	if (self?.periodicSyncTimer) {
		clearInterval(self.periodicSyncTimer)
		self.periodicSyncTimer = null
	}
	clearOscPlaybackInfoSupplement()
}

/**
 * While OSC drives layers, Caspar may omit `file/time` for some clips — poll AMCP INFO on each
 * **program** channel (e.g. `INFO 1`) so `state.channels[].layers` stays fresh for the PGM header
 * timer / playback merge. This is **separate** from `periodic_sync_interval_sec` (CLS/TLS/INFO CONFIG).
 *
 * Interval: `osc_info_supplement_ms` in config, else env `HIGHASCG_OSC_INFO_MS`, else **off (0)**.
 * Set **`2000`** or higher (≥ **500**) only if you need AMCP `INFO` for codecs that omit `file/time` on OSC.
 * **`0`** = no periodic `INFO` (OSC-only; default when unset).
 */
function clearOscPlaybackInfoSupplement() {
	if (oscPlaybackInfoTimer) {
		clearInterval(oscPlaybackInfoTimer)
		oscPlaybackInfoTimer = null
	}
}

/**
 * @param {object} self
 * @returns {number} interval ms; **0** = disabled
 */
function resolveOscInfoSupplementMs(self) {
	const c = self.config?.osc_info_supplement_ms
	if (c !== undefined && c !== null && String(c).trim() !== '') {
		const ms = parseInt(String(c), 10)
		return Number.isFinite(ms) ? ms : 0
	}
	const e = process.env.HIGHASCG_OSC_INFO_MS
	if (e === undefined || e === '') return 0
	const ms = parseInt(String(e), 10)
	return Number.isFinite(ms) ? ms : 0
}

/**
 * @param {object} self
 */
async function runOscPlaybackInfoSupplementOnce(self) {
	if (!canRunPeriodicSync(self)) return
	if (!playbackTracker.isOscPlaybackActive(self)) return
	const channels = getProgramChannelsForOscInfo(self)
	if (channels.length === 0) return
	for (const ch of channels) {
		try {
			const res = await self.amcp.info(ch)
			const xmlStr = infoResponseToXml(res)
			if (!xmlStr) continue
			self.gatheredInfo = self.gatheredInfo || {}
			self.gatheredInfo.channelXml = self.gatheredInfo.channelXml || {}
			self.gatheredInfo.channelXml[String(ch)] = xmlStr
			self.state.updateFromInfo(ch, xmlStr)
			if (typeof self.updateChannelVariablesFromXml === 'function') self.updateChannelVariablesFromXml(ch, xmlStr)
			else updateChannelVariablesFromXml(self, ch, xmlStr)
		} catch {
			/* ignore */
		}
	}
	if (typeof self._wsBroadcast === 'function') {
		try {
			self._wsBroadcast('change', { path: 'channels', value: self.state.getState().channels })
		} catch {
			/* ignore */
		}
	}
}

/**
 * @param {object} self
 */
function startOscPlaybackInfoSupplement(self) {
	clearOscPlaybackInfoSupplement()
	if (!playbackTracker.isOscPlaybackActive(self)) return
	const ms = resolveOscInfoSupplementMs(self)
	if (ms === 0) return
	if (!Number.isFinite(ms) || ms < 500) return
	void runOscPlaybackInfoSupplementOnce(self)
	oscPlaybackInfoTimer = setInterval(() => {
		runOscPlaybackInfoSupplementOnce(self).catch(() => {})
	}, ms)
	if (oscPlaybackInfoTimer.unref) oscPlaybackInfoTimer.unref()
}

function infoResponseToXml(res) {
	if (res?.data != null) return responseToStr(res.data)
	return ''
}

/**
 * Whether Caspar is reachable for AMCP INFO (socket when present, else amcp).
 */
function canRunPeriodicSync(self) {
	if (self.config?.offline_mode) return false
	if (!self?.amcp || typeof self.amcp.info !== 'function') return false
	if (self.socket && self.socket.isConnected === false) return false
	return true
}

/**
 * Effective interval (seconds). `null` = periodic sync disabled.
 * When OSC is active, floor at 45s unless `periodic_sync_interval_sec_osc` / `HIGHASCG_PERIODIC_SYNC_OSC_SEC` overrides.
 * @param {object} self
 * @returns {number | null}
 */
function resolveIntervalSec(self) {
	const env = process.env
	const raw =
		self.config?.periodic_sync_interval_sec != null && self.config?.periodic_sync_interval_sec !== ''
			? self.config.periodic_sync_interval_sec
			: env.HIGHASCG_PERIODIC_SYNC_SEC
	if (raw === '' || raw == null || raw === undefined) return null
	const sec = parseInt(String(raw), 10)
	if (!Number.isFinite(sec) || sec <= 0) return null
	if (!playbackTracker.isOscPlaybackActive(self)) return sec
	const oscRaw =
		self.config?.periodic_sync_interval_sec_osc != null && self.config?.periodic_sync_interval_sec_osc !== ''
			? self.config.periodic_sync_interval_sec_osc
			: env.HIGHASCG_PERIODIC_SYNC_OSC_SEC
	if (oscRaw !== '' && oscRaw != null && oscRaw !== undefined) {
		const o = parseInt(String(oscRaw), 10)
		if (Number.isFinite(o) && o > 0) return o
	}
	return Math.max(sec, 45)
}

/**
 * CLS + TLS without full CINF sweep (media/template lists refresh).
 * @param {object} self
 */
async function runMediaClsTlsRefresh(self) {
	if (!self.amcp?.query) return
	try {
		const clsRes = await self.amcp.query.cls()
		handlers.handleCLS(self, clsRes?.data)
		self.state.updateFromCLS(clsRes?.data)
		const n = self.state?.getState?.()?.media?.length ?? self.CHOICES_MEDIAFILES?.length ?? 0
		if (typeof self.log === 'function') self.log('info', `Media library CLS/TLS: ${n} media item(s) from server`)
		const tlsRes = await self.amcp.query.tls()
		if (self.state && self.mediaDetails) self.state.updateMediaDetails(self.mediaDetails || {})
		handlers.handleTLS(self, tlsRes?.data)
		self.state.updateFromTLS(tlsRes?.data)
	} catch (e) {
		if (typeof self.log === 'function') self.log('warn', 'Media CLS/TLS refresh failed: ' + (e?.message || e))
	}
}

/**
 * INFO CONFIG for decklink/config-compare (rare changes — same cadence as light sync).
 * @param {object} self
 */
async function runPeriodicInfoConfigRefresh(self) {
	if (!self.amcp?.query?.infoConfig) return
	try {
		const res = await self.amcp.query.infoConfig()
		const xmlStr = responseToStr(res?.data)
		if (!xmlStr) return
		self.gatheredInfo = self.gatheredInfo || {}
		self.gatheredInfo.infoConfig = xmlStr
		if (self.variables) self.variables.info_config = xmlStr
		if (typeof self.setVariableValues === 'function') self.setVariableValues({ info_config: xmlStr })
		if (typeof self.summarizeConsumersFromConfig === 'function' && xmlStr) {
			self.summarizeConsumersFromConfig(xmlStr, (summary) => {
				if (self.variables) self.variables.server_consumers_summary = summary
				if (typeof self.setVariableValues === 'function') self.setVariableValues({ server_consumers_summary: summary })
			})
		}
		if (typeof self.parseInfoConfigForDecklinks === 'function') {
			self.parseInfoConfigForDecklinks(xmlStr, (dl) => {
				self.gatheredInfo.decklinkFromConfig = dl || {}
			})
		}
		const tpMatch = xmlStr.match(/<template-path>\s*(.*?)\s*<\/template-path>/i)
		if (tpMatch?.[1]) self._resolvedTemplatePath = tpMatch[1].replace(/[\\/]+$/, '')
		if (typeof self.refreshConfigComparison === 'function') self.refreshConfigComparison(self)
		if (typeof self.samplingManager?.updateConfig === 'function' && self.config?.dmx?.enabled) {
			self.samplingManager.updateConfig(self.config.dmx).catch((err) => {
				if (typeof self.log === 'function') self.log('debug', '[DMX] Periodic INFO CONFIG: ' + (err?.message || err))
			})
		}
	} catch (e) {
		if (typeof self.log === 'function') self.log('debug', 'Periodic INFO CONFIG: ' + (e?.message || e))
	}
}

/**
 * Full INFO per sync channel + reconcile (no OSC).
 * @param {object} self
 */
async function runPeriodicChannelInfoSync(self) {
	const channels = getSyncChannelIds(self)
	if (channels.length === 0) return

	for (const ch of channels) {
		try {
			const res = await self.amcp.info(ch)
			const xmlStr = infoResponseToXml(res)
			if (!xmlStr) continue
			self.gatheredInfo.channelXml[String(ch)] = xmlStr
			self.state.updateFromInfo(ch, xmlStr)
			if (typeof self.updateChannelVariablesFromXml === 'function') self.updateChannelVariablesFromXml(ch, xmlStr)
			else updateChannelVariablesFromXml(self, ch, xmlStr)
		} catch (e) {
			if (typeof self.log === 'function') self.log('debug', `Periodic sync INFO ${ch}: ${e?.message || e}`)
		}
	}

	if (self.config?.reconcile_live_on_connect !== false) {
		try {
			await reconcileLiveSceneFromGatheredXml(self)
		} catch (e) {
			if (typeof self.log === 'function') self.log('debug', 'Periodic live scene reconcile: ' + (e?.message || e))
		}
	}

	try {
		await playbackTracker.reconcilePlaybackMatrixFromGatheredXml(self)
	} catch (e) {
		if (typeof self.log === 'function') self.log('debug', 'Periodic playback matrix reconcile: ' + (e?.message || e))
	}
}

/**
 * OSC path: no per-channel INFO (layers from UDP); refresh media lists + server config.
 * @param {object} self
 */
async function runPeriodicOscLightSync(self) {
	await runMediaClsTlsRefresh(self)
	await runPeriodicInfoConfigRefresh(self)
}

/**
 * Refresh INFO XML, variables, optional live-scene reconcile, playback matrix — or light sync when OSC is on.
 * @param {object} self - app context
 */
async function runPeriodicSync(self) {
	if (!canRunPeriodicSync(self)) return

	if (playbackTracker.isOscPlaybackActive(self)) {
		await runPeriodicOscLightSync(self)
	} else {
		await runPeriodicChannelInfoSync(self)
	}

	try {
		if (typeof self.updateDynamicVariables === 'function') self.updateDynamicVariables(self)
	} catch (_) {}
	if (typeof self.checkFeedbacks === 'function') self.checkFeedbacks('program_tally', 'preview_tally')
}

/**
 * Start or restart the interval after connection / channel list is known.
 * Disabled when `periodic_sync_interval_sec` and `HIGHASCG_PERIODIC_SYNC_SEC` are unset or ≤0.
 * @param {object} self
 */
function startPeriodicSync(self) {
	clearPeriodicSyncTimer(self)
	const intervalSec = resolveIntervalSec(self)
	if (intervalSec == null || intervalSec <= 0) return
	if (!playbackTracker.isOscPlaybackActive(self) && getSyncChannelIds(self).length === 0) return

	const intervalMs = intervalSec * 1000
	self.periodicSyncTimer = setInterval(() => {
		runPeriodicSync(self).catch((e) => {
			if (typeof self.log === 'function') self.log('debug', 'Periodic sync: ' + (e?.message || e))
		})
	}, intervalMs)
	if (self.periodicSyncTimer.unref) self.periodicSyncTimer.unref()
}

module.exports = {
	runPeriodicSync,
	startPeriodicSync,
	clearPeriodicSyncTimer,
	clearOscPlaybackInfoSupplement,
	startOscPlaybackInfoSupplement,
	resolveOscInfoSupplementMs,
	getSyncChannelIds,
	resolveIntervalSec,
	runMediaClsTlsRefresh,
}

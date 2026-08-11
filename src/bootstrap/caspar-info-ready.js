'use strict'

/**
 * @param {object} opts
 * @param {object} opts.appCtx
 * @param {object} opts.config
 * @param {Function} opts.getChannelMap
 * @param {Function} opts.handleCasparConnected
 * @param {Function} opts.setupAllRouting
 * @param {Function} opts.reconcileAfterInfoGather
 */
function createOnAfterInfoConfigReady({ appCtx, config, getChannelMap, handleCasparConnected, setupAllRouting, reconcileAfterInfoGather }) {
	return () => {
		handleCasparConnected()
		void setupAllRouting(appCtx).catch((e) => {
			appCtx.log('warn', 'Routing setup: ' + (e?.message || e))
		})
		// WO-209 T209.4: normalize preview channel pointers to 'a' (bank-less mode).
		// A stale 'b' pointer from previous session must not survive into the playlist path.
		try {
			const map = getChannelMap(config || {})
			const previews = (map.previewChannels || []).map((p) => Number(p)).filter((n) => Number.isFinite(n) && n > 0)
			if (appCtx.liveDeck && previews.length > 0) {
				appCtx.liveDeck.normalizePreviewChannelBanksToA(previews)
			}
		} catch (e) {
			appCtx.log('debug', `[WO-209] preview channel normalization: ${e?.message || e}`)
		}
		// Restart fix (todos19.07.26): after the reconcile settles, re-stage the persisted
		// preview look on each PRV bus (a surviving Caspar otherwise keeps showing the
		// previous run's staged content) and warm the look-deck thumbnail cache so deck
		// thumbs render without a first look play. Sequenced, fire-and-forget — mirrors
		// the Multiview re-apply pattern above (runs on boot AND every Caspar reconnect).
		void reconcileAfterInfoGather(appCtx)
			.catch((e) => {
				appCtx.log('debug', 'Live scene reconcile: ' + (e?.message || e))
			})
			.then(async () => {
				const Setup = require('../config/routing-setup')
				await Setup.restagePersistedPreviewLooks(appCtx).catch((e) => {
					appCtx.log('warn', 'Preview re-stage: ' + (e?.message || e))
				})
				await Setup.warmLookDeckThumbnails(appCtx).catch((e) => {
					appCtx.log('warn', 'Look thumb warm: ' + (e?.message || e))
				})
			})
		// WO-207 T207.3: startup/reconnect sweep for orphaned template CG hosts (band 700-789)
		// WO-210 T210.4: restore screen timers (band 980-989)
		void (async () => {
			try {
				const { sweepTemplateCgOrphansOnCasparConnected } = require('../engine/template-cg-orphan-sweep')
				const liveSceneState = require('../state/live-scene-state')
				const map = getChannelMap(config || {})
				const programChannels = []
				for (let i = 0; i < map.screenCount; i++) {
					programChannels.push(map.programCh(i + 1))
				}
				await sweepTemplateCgOrphansOnCasparConnected({
					amcp: appCtx.amcp,
					liveState: liveSceneState.getAll(),
					/* WO-482: the connect gather's INFO XML — lets the sweep clear only occupied hosts. */
					channelXml: appCtx.gatheredInfo?.channelXml || {},
					channels: programChannels,
					log: (level, msg) => appCtx.log(level, msg),
				})
			} catch (e) {
				appCtx.log('debug', `[template-cg-orphan-sweep] startup: ${e?.message || e}`)
			}

			// WO-210 T210.4: restore registered screen timers on startup/reconnect
			try {
				const screenTimers = require('../engine/screen-timers')
				screenTimers.loadRegistry()
				const reAddLines = screenTimers.linesForReAdd()
				if (reAddLines.length > 0 && appCtx.amcp && typeof appCtx.amcp.batchSendChunked === 'function') {
					await appCtx.amcp.batchSendChunked(reAddLines, { skipMixerPreCommit: true })
					appCtx.log('info', `[screen-timers] restored ${reAddLines.length / 2} timer(s) from registry`)
				}
			} catch (e) {
				appCtx.log('debug', `[screen-timers] startup restore: ${e?.message || e}`)
			}
		})()
	}
}

module.exports = { createOnAfterInfoConfigReady }

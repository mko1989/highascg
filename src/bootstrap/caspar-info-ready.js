'use strict'

const { loopScreens } = require('../config/screen-channels')

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
	/* WO-1013 follow-up: built once at boot, before Caspar connects — take the operator card's stored on-state
	 * provisionally (a node restart must not forget a card Caspar still shows); checked on the first connect below. */
	try {
		require('../engine/restore-on-screens').primeLedTestCardFromPersisted(appCtx)
	} catch (e) {
		appCtx.log?.('warn', '[restore-on-screens] test card prime: ' + (e?.message || e))
	}
	return () => {
		/* WO-1013: the first connect of this node process is a boot (nothing of ours was on that Caspar); every later
		 * one is a reconnect — after Devices ▸ Apply & restart node still knows what was on the screens. */
		appCtx._casparInfoReadyCount = (appCtx._casparInfoReadyCount || 0) + 1
		const reconnect = appCtx._casparInfoReadyCount > 1
		const answeredAt = Date.now()
		/* WO-1029: what the config Caspar just started with means per channel (the air snapshot maps by role) and
		 * which casparcg.config it read (GET /api/caspar-config/dirty: written but not restarted). */
		require('../engine/air-snapshot').rememberConnectRoles(appCtx, getChannelMap)
		require('../config/caspar-config-dirty').rememberConfigAtConnect(appCtx)
		handleCasparConnected()
		/* First connect: is the primed card really on air? (after the boot splash, which fetch-server-info-config ran) */
		const cardChecked = reconnect
			? Promise.resolve()
			: require('../engine/restore-on-screens')
					.verifyPrimedLedTestCard(appCtx)
					.catch((e) => appCtx.log('warn', '[restore-on-screens] test card check: ' + (e?.message || e)))
		const routingDone = Promise.resolve()
			.then(() => setupAllRouting(appCtx))
			.catch((e) => {
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
				/* WO-1013 / WO-1029: put back what was on the screens — one owner per connect (restore-on-screens.js
				 * `restoreOnConnect`): program looks (after routing, so route:// sources and audio buses exist), the
				 * preview re-stage, with an Apply's air snapshot every other layer at its position, the timeline, then
				 * the test card LAST so layer 999 sits on top. Capped wait inside: a hung routing setup must not hold
				 * the restore forever. */
				await cardChecked
				await require('../engine/restore-on-screens')
					.restoreOnConnect(appCtx, { reconnect, answeredAt, routingDone, setup: Setup })
					.catch((e) => {
						appCtx.log('warn', '[restore-on-screens] ' + (e?.message || e))
					})
				await Setup.warmLookDeckThumbnails(appCtx).catch((e) => {
					appCtx.log('warn', 'Look thumb warm: ' + (e?.message || e))
				})
			})
		/* WO-483: a Caspar restart spawns brand-new consumer windows, and Openbox places them by its
		 * own policy — a PGM consumer that should sit at 6144,0 was parked centre-canvas while its
		 * monitor stayed blank. Put each one where the generated config says. Delayed and retried
		 * once because the windows appear a moment after AMCP does; a plain windowmove sticks
		 * (measured), so no fight with the WM is needed. */
		void (async () => {
			try {
				const { placeScreenConsumers } = require('../system/screen-consumer-placement')
				for (const waitMs of [1500, 4000]) {
					await new Promise((r) => setTimeout(r, waitMs))
					const res = await placeScreenConsumers({
						config: appCtx.config,
						log: (level, msg) => appCtx.log(level, msg),
					})
					if (res.missing === 0) break
				}
			} catch (e) {
				appCtx.log('debug', `[Screen placement] ${e?.message || e}`)
			}
		})()

		// WO-207 T207.3: startup/reconnect sweep for orphaned template CG hosts (band 700-789)
		// WO-210 T210.4: restore screen timers (band 980-989)
		void (async () => {
			try {
				const { sweepTemplateCgOrphansOnCasparConnected } = require('../engine/template-cg-orphan-sweep')
				const liveSceneState = require('../state/live-scene-state')
				const map = getChannelMap(config || {})
				const programChannels = []
				// WO-1029 C1b: the screens on this server only (a hole has no channel — never `CG null-…`)
				for (const i of loopScreens(map)) programChannels.push(map.programCh(i + 1))
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

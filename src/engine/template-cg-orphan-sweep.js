/**
 * WO-207 T207.3: Startup/reconnect sweep for orphaned template CG hosts.
 * On highascg start or Caspar reconnect, clear the CG host band 700-899 on every program channel
 * EXCEPT hosts declared by the restored live look's template layers (computed from liveSceneState).
 * This kills restart-orphans deterministically without needing manual intervention.
 */

'use strict'

const { resolveTemplateCgHostLayer } = require('./cg-routing')
const { isSceneTemplateLayer } = require('./scene-template-cg')

/**
 * WO-207 T207.3: Clear orphaned template CG hosts on startup/reconnect.
 * @param {object} opts
 * @param {object} opts.amcp — AMCP client
 * @param {object} opts.liveState — live scene state (from live-scene-state.js getAll())
 * @param {number[]} opts.channels — program channel numbers to sweep
 * @param {Function} [opts.log] — logger function (level, msg)
 * @returns {Promise<{ clearedCount: number, declaredCount: number }>}
 */
async function sweepTemplateCgOrphansOnCasparConnected(opts) {
	const { amcp, liveState, channels = [], log } = opts || {}

	if (!amcp || typeof amcp.batchSendChunked !== 'function') {
		return { clearedCount: 0, declaredCount: 0 }
	}
	/* WO-492 A: a sweep against a dead socket cannot clear an orphan — it can only log
	 * `clear batch failed: Not connected` and, on the blind path below, burn 90 lines per channel
	 * building a batch nothing will receive (observed 11.08 15:54:13). The reconnect that follows
	 * re-runs this sweep with INFO XML in hand, which is the run that actually does the work.
	 * `=== false` on purpose: test doubles omit the getter, and they must still sweep. */
	if (amcp.isConnected === false) {
		log?.('debug', '[template-cg-orphan-sweep] skipped — AMCP not connected (the reconnect sweep will run it)')
		return { clearedCount: 0, declaredCount: 0 }
	}

	const declaredHosts = new Set()
	const clearLines = []

	// Compute declared hosts from current live scene layers
	for (const ch of channels) {
		const chKey = String(ch)
		const entry = liveState?.[chKey]
		const layers = entry?.scene?.layers || []

		for (const layer of layers) {
			if (!isSceneTemplateLayer(layer, layer.source?.value)) continue
			const hostLayer = resolveTemplateCgHostLayer(layer.layerNumber, layer.source?.value)
			declaredHosts.add(`${ch}-${hostLayer}`)
		}
	}

	/* WO-482: clear only hosts that are actually OCCUPIED and undeclared.
	 *
	 * The band is 90 hosts per program channel, so the blanket form emitted ~186 `CG n-m CLEAR`
	 * lines on every startup and every Caspar reconnect — on a box with nothing on those layers,
	 * 186 commands to clear 186 empty layers. Batched (below), so it is 3 round-trips rather than
	 * 186, but Caspar logs each line and the owner rightly asked what all of it was for.
	 *
	 * The connect gather has already run INFO on each channel, and
	 * `parseLayerFgProducerTypesFromChannelXml` turns that into layer → producer type — the same
	 * source WO-268 uses to decide whether a quarantined host survived. A host with an empty (or
	 * absent) producer needs no CLEAR. On a clean channel that is zero commands.
	 *
	 * Fallback is deliberate: with no XML for a channel (INFO not gathered yet, parse failure) the
	 * old blanket sweep runs for that channel. An orphan left on air is worse than a redundant
	 * clear, so uncertainty must fail toward sweeping. */
	const { parseLayerFgProducerTypesFromChannelXml } = require('../state/live-scene-reconcile')
	const channelXml = opts?.channelXml || {}
	let sweptBlind = 0
	for (const ch of channels) {
		let types = null
		const xml = channelXml[String(ch)]
		if (xml && String(xml).trim()) {
			try {
				types = await parseLayerFgProducerTypesFromChannelXml(xml)
			} catch {
				types = null
			}
		}
		/* WO-503: `gatheredInfo.channelXml` is a SNAPSHOT taken when this sweep is scheduled, and on
		 * the connect path `periodic-sync` has not filled it yet — so the blind branch below fired on
		 * every reconnect and put 90 `CG n-7xx CLEAR` lines per program channel into Caspar's log,
		 * which is what made the log unreadable. Ask for the XML instead of guessing: ONE `INFO <ch>`
		 * replaces 90 CLEARs and is strictly more accurate than sweeping blind. Only a genuine INFO
		 * failure now reaches the fallback, which keeps WO-482's deliberate fail-toward-sweeping. */
		if (!types && amcp?.isConnected) {
			try {
				const info = await amcp.info(ch)
				const xmlNow = typeof info?.data === 'string' ? info.data : Array.isArray(info?.data) ? info.data.join('\n') : ''
				if (xmlNow.trim()) types = await parseLayerFgProducerTypesFromChannelXml(xmlNow)
			} catch {
				types = null
			}
		}
		if (!types) sweptBlind++
		for (let host = 700; host <= 789; host++) {
			const key = `${ch}-${host}`
			if (declaredHosts.has(key)) continue
			if (types) {
				const t = String(types[String(host)] || '')
				if (!t || t === 'empty') continue
			}
			clearLines.push(`CG ${ch}-${host} CLEAR`)
		}
	}

	let clearedCount = 0
	if (clearLines.length > 0) {
		try {
			/* forceBatch is not optional here. The global `config.amcp_batch` flag is off, so without it
			 * batchSendChunked degrades to one _send per line: 90 hosts x N program channels, each a
			 * separate serialized AMCP round-trip on _amcpSendQueue. On a CPU-bound box that measured
			 * ~450ms per command, i.e. ~90s of saturated AMCP on EVERY startup and reconnect, during
			 * which every other caller (Device View polls, INFO, TLS) queues behind it. Chunked
			 * BEGIN...COMMIT turns the sweep into 3 round-trips. Same opt-in the take path uses (WO-259),
			 * and it does not flip the global flag for anyone else. */
			await amcp.batchSendChunked(clearLines, { skipMixerPreCommit: true, forceBatch: true })
			clearedCount = clearLines.length
		} catch (e) {
			if (typeof log === 'function') {
				log('warn', `[template-cg-orphan-sweep] clear batch failed: ${e?.message || e}`)
			}
		}
	}

	if (typeof log === 'function') {
		log(
			'info',
			`[template-cg-orphan-sweep] ch=${channels.join(',')} cleared=${clearedCount} declared=${declaredHosts.size}` +
				(sweptBlind ? ` (no INFO xml for ${sweptBlind} channel(s) — full band swept there)` : ''),
		)
	}

	return { clearedCount, declaredCount: declaredHosts.size }
}

module.exports = { sweepTemplateCgOrphansOnCasparConnected }

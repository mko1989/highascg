'use strict'

const {
	listHostLiveChannelEntries,
	amcpCommandsForHostLiveSource,
	isHostLiveSource,
	isBrowserDisplayCandidate,
} = require('./host-live-sources')
const { ensureBrowserDisplaySourceReady } = require('./host-live-sources-browser-runtime')

/**
 * @param {object} self — app context (amcp, config, log)
 */
async function setupHostLiveSources(self) {
	const entries = listHostLiveChannelEntries(self.config)
	if (!self.amcp || entries.length === 0) {
		self._hostLiveSourcesStatus = {
			updatedAt: Date.now(),
			enabled: false,
			reason: !self.amcp ? 'amcp_disconnected' : 'no_host_live_sources',
			count: 0,
		}
		return
	}

	const played = []
	const failed = []
	// WO-406/WO-410 (03.08, live-proven): a stored hostChannel can point at a channel the map
	// has since reassigned — the NDI source pinned ch 5 and its replay clobbered the monitor
	// bus's solo layer on every reconnect. Never replay onto the monitor channel; the real
	// renumbering fix is the WO-377/381 planned-vs-stored family.
	const { getChannelMap } = require('./routing-map')
	const monitorCh = getChannelMap(self.config).monitorCh
	for (const entry of entries) {
		if (monitorCh != null && Number(entry.channel) === Number(monitorCh)) {
			self.log?.(
				'warn',
				`Host live sources: "${entry.sourceId}" stored hostChannel ${entry.channel} is the MONITOR channel — replay skipped (re-create the source to renumber it)`,
			)
			failed.push({ sourceId: entry.sourceId, channel: entry.channel, cmd: '(skipped)', message: 'monitor_channel_collision' })
			continue
		}
		if (isBrowserDisplayCandidate(entry.item)) {
			const ready = await ensureBrowserDisplaySourceReady(self, entry.item)
			if (!ready.ok) {
				failed.push({
					sourceId: entry.sourceId,
					channel: entry.channel,
					cmd: '(browser-source pipeline)',
					message: ready.reason || 'browser_source_not_ready',
				})
				continue
			}
		}
		const cmds = amcpCommandsForHostLiveSource(entry.item)
		for (const cmd of cmds) {
			try {
				await self.amcp.raw(cmd)
			} catch (e) {
				failed.push({ sourceId: entry.sourceId, channel: entry.channel, cmd, message: e?.message || String(e) })
				break
			}
		}
		if (!failed.some((f) => f.sourceId === entry.sourceId)) {
			played.push({ sourceId: entry.sourceId, channel: entry.channel, kind: entry.kind })
		}
	}

	if (played.length > 0) {
		self.log(
			'info',
			`Host live sources: ${played.length} started (${played.map((p) => `${p.kind} ch${p.channel}`).join(', ')})`,
		)
	}
	if (failed.length > 0 && typeof self.log === 'function') {
		self.log('warn', `Host live sources: ${failed.length} failed — ${failed[0]?.message || 'see status'}`)
		const { hostLiveCasparChannelsOutOfDate, applyCasparConfigForHostLiveIfNeeded } = require('./host-live-sources-caspar')
		const caspar = hostLiveCasparChannelsOutOfDate(self)
		if (caspar.needed) {
			self.log(
				'warn',
				`Host live sources: casparcg.config is missing channel(s) through ch${caspar.required} (applied max ch${caspar.applied})`,
			)
			if (!self._hostLiveCasparAutoApplyAttempted) {
				self._hostLiveCasparAutoApplyAttempted = true
				try {
					const applied = await applyCasparConfigForHostLiveIfNeeded(self)
					if (applied.applied && applied.ok) {
						self.log('info', 'Host live sources: regenerated casparcg.config for missing host channel(s)')
						return setupHostLiveSources(self)
					}
				} catch (e) {
					self.log('warn', `Host live sources: caspar auto-apply failed: ${e?.message || e}`)
				}
			}
		}
	}

	self._hostLiveSourcesStatus = {
		updatedAt: Date.now(),
		enabled: true,
		count: entries.length,
		played,
		failed,
	}
}

/**
 * @param {object} ctx
 * @param {object} item — normalized host live source
 */
async function playHostLiveSourceNow(ctx, item) {
	if (!ctx?.amcp || !isHostLiveSource(item)) return { ok: false, reason: 'not_host_source' }
	if (isBrowserDisplayCandidate(item)) {
		const ready = await ensureBrowserDisplaySourceReady(ctx, item)
		if (!ready.ok) return { ok: false, reason: ready.reason || 'browser_source_not_ready' }
	}
	const cmds = amcpCommandsForHostLiveSource(item)
	for (const cmd of cmds) {
		await ctx.amcp.raw(cmd)
	}
	return { ok: true, commands: cmds }
}

module.exports = {
	setupHostLiveSources,
	playHostLiveSourceNow,
}

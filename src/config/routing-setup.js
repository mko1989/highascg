/**
 * Channel routing setup and template syncing.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const Map = require('./routing-map')
const {
	listConfiguredLiveAudioSlots,
	resolveLiveAudioRouteString,
	resolveLiveAudioPgmTargetScreens,
} = require('./live-audio-input')
const {
	normalizeAudioPreview,
	resolveAudioPreviewChannel,
	resolveAudioPreviewDefaultRoute,
} = require('./audio-preview')
const { ensureAllMeterNullConsumers } = require('../audio/meter-null-consumer')
const { startLiveInputMeterHealthWatch, repairLiveInputMetersIfStale } = require('../audio/meter-health')
const { playLiveAlsaClipWithRecovery } = require('../audio/live-audio-health')

async function setupInputsChannel(self) {
	const map = Map.getChannelMap(self.config)
	const decklinkEntries = (Array.isArray(map.inputChannels) ? map.inputChannels : []).filter((e) => e.kind === 'decklink')
	if (!map.decklinkCount || !map.inputsEnabled || decklinkEntries.length === 0 || !self.amcp) {
		self._decklinkInputsStatus = {
			updatedAt: Date.now(),
			enabled: false,
			reason: !self.amcp
				? 'amcp_disconnected'
				: !map.decklinkCount
					? 'decklink_inputs_disabled'
					: decklinkEntries.length === 0
						? 'no_inputs_channel'
						: 'inputs_disabled',
		}
		return
	}
	// WO-53: each DeckLink input has its own dedicated full-quality channel (isolated audio meter).
	self.log('info', `DeckLink inputs: ${decklinkEntries.length} dedicated channel(s) (${decklinkEntries.map((e) => e.channel).join(', ')})`)

	const outputDevices = new Set(); for (let n = 1; n <= map.screenCount; n++) {
		const dlOut = parseInt(String(Map.readCasparSetting(self.config, `screen_${n}_decklink_device`) ?? '0'), 10)
		if (dlOut > 0) outputDevices.add(dlOut)
	}
	const mvDlOut = parseInt(String(Map.readCasparSetting(self.config, 'multiview_decklink_device') ?? '0'), 10); if (mvDlOut > 0) outputDevices.add(mvDlOut)

	const usedDevices = new Map(); const inputDevice = []; const skippedConflicts = []; const skippedDuplicates = []
	for (const entry of decklinkEntries) {
		const i = entry.slot
		const device = Map.resolveDecklinkInputDeviceIndex(self.config, i)
		if (outputDevices.has(device)) { skippedConflicts.push({ input: i, device }); continue }
		if (usedDevices.has(device)) { skippedDuplicates.push({ input: i, device, firstUser: usedDevices.get(device) }); continue }
		usedDevices.set(device, i); inputDevice.push({ channel: entry.channel, layer: entry.layer, slot: i, device })
	}

	const failed = []; let playOk = 0
	for (const { channel, layer, device } of inputDevice) {
		try { await self.amcp.raw(`PLAY ${channel}-${layer} DECKLINK ${device}`); playOk++ }
		catch (e) {
			const msg = e?.message || String(e); if (/already playing|404|PLAY FAILED/i.test(msg)) playOk++
			else failed.push({ channel, layer, device, message: msg })
		}
	}
	self._decklinkInputsStatus = { updatedAt: Date.now(), enabled: true, channels: decklinkEntries.map((e) => e.channel), inputsOnMvr: false, requestedSlots: map.decklinkCount, scheduledPlays: inputDevice.length, playSucceeded: playOk, skippedConflicts, skippedDuplicates, failed }
}

async function setupLiveAudioInputs(self) {
	const { count, slots } = listConfiguredLiveAudioSlots(self.config)
	const playable = slots.filter((s) => Number.isFinite(Number(s.channel)))
	if (!self.amcp || count <= 0 || playable.length === 0) {
		self._liveAudioInputsStatus = {
			updatedAt: Date.now(),
			enabled: false,
			reason: !self.amcp ? 'amcp_disconnected' : count <= 0 ? 'live_audio_disabled' : 'no_inputs_channel',
		}
		return
	}
	// WO-53: each ALSA input plays on its own cheap channel so its audio meter is isolated.
	const failed = []
	let playOk = 0
	for (const slot of playable) {
		const res = await playLiveAlsaClipWithRecovery(self, slot, { log: true })
		if (res.ok) playOk++
		else {
			failed.push({
				slot: slot.slot,
				channel: slot.channel,
				layer: slot.layer,
				clip: slot.clip,
				message: res.reason || 'play_failed',
			})
		}
	}
	self._liveAudioInputsStatus = {
		updatedAt: Date.now(),
		enabled: true,
		requestedSlots: count,
		scheduledPlays: playable.length,
		playSucceeded: playOk,
		slots: playable.map((s) => ({ slot: s.slot, channel: s.channel, layer: s.layer, clip: s.clip, route: s.route })),
		failed,
	}
	self.log('info', `Live ALSA inputs: ${playOk}/${playable.length} PLAY on dedicated channel(s) ${playable.map((s) => s.channel).join(', ')}`)
}

async function setupLiveAudioPgmRoutes(self) {
	const map = Map.getChannelMap(self.config)
	if (!self.amcp) return
	const alwaysOn =
		Map.readCasparSetting(self.config, 'live_audio_pgm_always_on') !== false &&
		Map.readCasparSetting(self.config, 'live_audio_pgm_always_on') !== 'false'
	if (!alwaysOn) return
	const { slots } = listConfiguredLiveAudioSlots(self.config)
	if (!slots.length) return

	const screens = resolveLiveAudioPgmTargetScreens(self.config)
	const baseLayer = Math.min(
		9,
		Math.max(1, parseInt(String(Map.readCasparSetting(self.config, 'live_audio_pgm_layer') ?? 2), 10) || 2),
	)
	const audioOnly =
		Map.readCasparSetting(self.config, 'live_audio_pgm_audio_only') === true ||
		Map.readCasparSetting(self.config, 'live_audio_pgm_audio_only') === 'true'
	const routes = []

	for (const screen of screens) {
		const pgmCh = map.programCh(screen)
		if (!Number.isFinite(pgmCh) || pgmCh < 1) continue
		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i]
			const route =
				slot.route || resolveLiveAudioRouteString(self.config, slot.slot)
			if (!route) continue
			const layer = baseLayer + i
			if (layer > 9) {
				self.log('warn', `Live audio PGM route skipped slot ${slot.slot} screen ${screen}: layer ${layer} exceeds audio track range 1–9`)
				continue
			}
			const cl = `${pgmCh}-${layer}`
			try {
				await self.amcp.raw(`PLAY ${cl} ${route}`)
				if (audioOnly) {
					try {
						await self.amcp.raw(`MIXER ${cl} OPACITY 0`)
						await self.amcp.raw(`MIXER ${cl} VOLUME 1`)
					} catch (_) {}
				}
				routes.push({ screen, channel: pgmCh, layer, route, audioOnly })
			} catch (e) {
				self.log('warn', `Live audio PGM route ${cl} ${route}: ${e?.message || e}`)
			}
		}
	}
	if (routes.length) {
		const chs = [...new Set(routes.map((r) => r.channel))].join(', ')
		self.log('info', `Live ALSA: routed ${slots.length} input(s) to PGM channel(s) ${chs} (${routes.length} route(s))`)
	}
	if (self._liveAudioInputsStatus) {
		self._liveAudioInputsStatus.pgmRoutes = routes
	}
}

async function setupAudioPreviewBus(self) {
	const map = Map.getChannelMap(self.config)
	const ap = normalizeAudioPreview(self.config)
	if (!ap.enabled || !self.amcp) return
	const ch = resolveAudioPreviewChannel(self.config, map)
	if (ch == null) return
	const defaultRoute = resolveAudioPreviewDefaultRoute(self.config, map)
	if (!defaultRoute) return
	try {
		await self.amcp.play(ch, ap.soloLayerStart, defaultRoute)
		for (let L = ap.soloLayerStart + 1; L < ap.soloLayerStart + ap.soloLayerCount; L++) {
			try {
				await self.amcp.clear(ch, L)
			} catch (_) {}
		}
		self.log('info', `Audio preview: ch ${ch} (${ap.bus}) default ${defaultRoute} on layer ${ap.soloLayerStart}`)
	} catch (e) {
		self.log('warn', `Audio preview bus setup: ${e?.message || e}`)
	}
}

async function setupPreviewChannel(self, screenIdx) {
	const map = Map.getChannelMap(self.config); if (!self.amcp) return
	const pgmCh = map.programCh(screenIdx); const prvCh = map.previewCh(screenIdx)
	if (prvCh == null || prvCh === pgmCh) return
	if (Map.readCasparSetting(self.config, 'preview_black_cg') === true || String(Map.readCasparSetting(self.config, 'preview_black_cg') ?? '').toLowerCase() === 'true') {
		try { await self.amcp.cgAdd(pgmCh, 9, 0, 'black', 1, '') } catch {}
		try { await self.amcp.cgAdd(prvCh, 9, 0, 'black', 1, '') } catch {}
	}
}

async function setupMultiview(self, layout) {
	const map = Map.getChannelMap(self.config); if (!map.multiviewEnabled || map.multiviewCh == null || !self.amcp) return
	const ch = map.multiviewCh
	const finalLayout = (layout && layout.length > 0) ? layout : [
		{ layer: 11, x: 0, y: 0, w: 0.5, h: 0.5, route: Map.getRouteString(map.programCh(1)) },
		{ layer: 12, x: 0.5, y: 0, w: 0.5, h: 0.5, route: Map.getRouteString(map.previewCh(1) || map.programCh(1)) }
	]
	for (const cell of finalLayout) {
		await self.amcp.play(ch, cell.layer, cell.route || cell.source)
		await self.amcp.mixerFill(ch, cell.layer, cell.x, cell.y, cell.w, cell.h)
	}
	await self.amcp.mixerCommit(ch)
}

function syncAllTemplatesToDestination(self, destDir, label) {
	if (!destDir || !fs.existsSync(destDir)) return 0
	const srcRoot = path.join(REPO_ROOT, 'templates'); if (!fs.existsSync(srcRoot)) return 0
	let n = 0; for (const ent of fs.readdirSync(srcRoot, { withFileTypes: true })) {
		if (!ent.isFile() || ent.name.startsWith('.')) continue
		try { fs.copyFileSync(path.join(srcRoot, ent.name), path.join(destDir, ent.name)); n++ } catch {}
	}
	if (n > 0) self.log('info', `Template sync: ${n} file(s) → ${destDir} (${label})`)
	return n
}

async function setupAllRouting(self) {
	const { PIP_OVERLAY_TEMPLATE_FILES } = require('../engine/pip-overlay'); const map = Map.getChannelMap(self.config)
	const tBase = (self.config?.local_template_path || '').trim(); const mBase = (self.config?.local_media_path || '').trim()
	if (tBase) syncAllTemplatesToDestination(self, tBase, 'local_template_path')
	else if (mBase) { syncAllTemplatesToDestination(self, mBase, 'local_media_path'); self.log('info', 'Templates synced to local_media_path') }

	const deployRoot = tBase || mBase; if (deployRoot) {
		const blackDest = path.join(deployRoot, 'black.html')
		if (!fs.existsSync(blackDest)) {
			try { fs.writeFileSync(blackDest, '<!DOCTYPE html><html><head><style>*{margin:0;padding:0}html,body{width:100%;height:100%;background:#000}</style></head><body></body></html>') } catch {}
		}
	}
	if (self.amcp) {
		try {
			const tls = await self.amcp.raw('TLS'); const tlsData = Array.isArray(tls?.data) ? tls.data.join('\n') : String(tls?.data || '')
			for (const tplFile of PIP_OVERLAY_TEMPLATE_FILES) {
				const tplName = tplFile.replace(/\.html$/, ''); if (!tlsData.toLowerCase().includes(tplName.toLowerCase())) self.log('warn', `PIP overlay template "${tplName}" not found in TLS list.`)
			}
		} catch {}
	}
	if (map.inputsEnabled) {
		if (map.decklinkCount > 0) await setupInputsChannel(self)
		await setupLiveAudioInputs(self)
		await setupLiveAudioPgmRoutes(self)
	}
	await setupAudioPreviewBus(self)
	for (let n = 1; n <= map.screenCount; n++) await setupPreviewChannel(self, n)
	if (map.switcherBusMode && self.amcp) {
		if (!self.switcherOutputBusByChannel) self.switcherOutputBusByChannel = {}
		for (let i = 0; i < map.screenCount; i++) {
			const outCh = map.programChannels?.[i]
			const bus1 = map.switcherBus1Channels?.[i] ?? map.previewChannels?.[i]
			if (outCh == null || bus1 == null) continue
			try {
				await self.amcp.play(outCh, 1, Map.getRouteString(bus1))
				self.switcherOutputBusByChannel[String(outCh)] = bus1
			} catch (_) {}
		}
	}
	if (map.multiviewEnabled && self._multiviewLayout?.layout?.length > 0) {
		try {
			const { applyMultiviewLayout } = require('../engine/multiview-apply')
			await applyMultiviewLayout(self._multiviewLayout, self)
		} catch {}
	}
	if (map.streamingCh != null && self.amcp) {
		// Attach mode: `streamingCh` is an existing program/preview bus — it already has output; do not layer route:// on it.
		if (map.streamingAttachToChannel == null) {
			const cLayer = map.streamingContentLayer; const vRoute = Map.resolveStreamingChannelRouteForRole(self.config, 'video'); const aRoute = Map.resolveStreamingChannelRouteForRole(self.config, 'audio')
			if (vRoute && aRoute && vRoute !== aRoute && cLayer >= 2) {
				const aLayer = cLayer - 1; try {
					await self.amcp.play(map.streamingCh, aLayer, aRoute); await self.amcp.play(map.streamingCh, cLayer, vRoute)
					try { await self.amcp.mixerOpacity(map.streamingCh, aLayer, 0) } catch {}
					try { await self.amcp.mixerVolume(map.streamingCh, cLayer, 0) } catch {}
				} catch { try { await self.amcp.play(map.streamingCh, cLayer, vRoute) } catch {} }
			} else if (vRoute) try { await self.amcp.play(map.streamingCh, cLayer, vRoute) } catch {}
		}
	}
	await setupMappingChannels(self)
	await ensureAllMeterNullConsumers(self)
	await repairLiveInputMetersIfStale(self, { force: true, broadcastOsc: true }).catch(() => {})
	startLiveInputMeterHealthWatch(self)
}

async function setupMappingChannels(_self) {
	// Pixel-map → DeckLink is expressed in generated Caspar XML as one program channel (custom width)
	// plus a single decklink consumer with subregions and synced ports — no extra mapping channels or AMCP mirrors.
	return
}

/**
 * Start ALSA capture PLAY + PGM always-on routes (safe after connect or project load).
 * @param {object} ctx
 */
async function ensureLiveAudioRouting(ctx) {
	if (!ctx?.amcp) return { ok: false, reason: 'amcp_disconnected' }
	await setupLiveAudioInputs(ctx)
	await setupLiveAudioPgmRoutes(ctx)
	await ensureAllMeterNullConsumers(ctx)
	await repairLiveInputMetersIfStale(ctx, { force: true, broadcastOsc: true }).catch(() => {})
	startLiveInputMeterHealthWatch(ctx)
	return { ok: true, status: ctx._liveAudioInputsStatus ?? null }
}

module.exports = {
	setupInputsChannel,
	setupLiveAudioInputs,
	setupLiveAudioPgmRoutes,
	ensureLiveAudioRouting,
	setupAudioPreviewBus,
	setupPreviewChannel,
	setupMultiview,
	setupAllRouting,
	setupMappingChannels,
}

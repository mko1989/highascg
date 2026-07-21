/**
 * Channel routing setup and template syncing.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const routingMap = require('./routing-map')
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
const { listConfiguredV4l2Slots } = require('../capture/v4l2-input-config')
const { playV4l2ClipWithRecovery } = require('../capture/v4l2-input-health')
const { findSelfRouteViolation } = require('../engine/scene-route-deps')
const {
	infoResponseToXml,
	foregroundProducerOnLayer,
	isDecklinkProducerForDevice,
} = require('../caspar/channel-info-xml')

async function setupInputsChannel(self) {
	const channelMap = routingMap.getChannelMap(self.config)
	const decklinkEntries = (Array.isArray(channelMap.inputChannels) ? channelMap.inputChannels : []).filter((e) => e.kind === 'decklink')
	if (!channelMap.decklinkCount || !channelMap.inputsEnabled || decklinkEntries.length === 0 || !self.amcp) {
		self._decklinkInputsStatus = {
			updatedAt: Date.now(),
			enabled: false,
			reason: !self.amcp
				? 'amcp_disconnected'
				: !channelMap.decklinkCount
					? 'decklink_inputs_disabled'
					: decklinkEntries.length === 0
						? 'no_inputs_channel'
						: 'inputs_disabled',
		}
		return
	}
	// WO-53: each DeckLink input has its own dedicated full-quality channel (isolated audio meter).
	self.log('info', `DeckLink inputs: ${decklinkEntries.length} dedicated channel(s) (${decklinkEntries.map((e) => e.channel).join(', ')})`)

	const outputDevices = new Set(); for (let n = 1; n <= channelMap.screenCount; n++) {
		const dlOut = parseInt(String(routingMap.readCasparSetting(self.config, `screen_${n}_decklink_device`) ?? '0'), 10)
		if (dlOut > 0) outputDevices.add(dlOut)
	}
	const mvDlOut = parseInt(String(routingMap.readCasparSetting(self.config, 'multiview_decklink_device') ?? '0'), 10); if (mvDlOut > 0) outputDevices.add(mvDlOut)

	const usedDevices = new globalThis.Map(); const inputDevice = []; const skippedConflicts = []; const skippedDuplicates = []
	for (const entry of decklinkEntries) {
		const i = entry.slot
		const device = routingMap.resolveDecklinkInputDeviceIndex(self.config, i)
		if (outputDevices.has(device)) { skippedConflicts.push({ input: i, device }); continue }
		if (usedDevices.has(device)) { skippedDuplicates.push({ input: i, device, firstUser: usedDevices.get(device) }); continue }
		usedDevices.set(device, i); inputDevice.push({ channel: entry.channel, layer: entry.layer, slot: i, device })
	}

	const failed = []; let playOk = 0; const alreadyOpen = []
	for (const { channel, layer, device } of inputDevice) {
		const res = await tryPlayDecklinkInput(self, { channel, layer, device })
		if (res.ok) {
			playOk++
			// WO-316: distinct from a fresh PLAY. The input is open on the right device; if it also
			// reports has_signal=false the card is fine and the SOURCE is missing — a different
			// operator problem from "the input never opened", and one no retry can fix.
			if (res.alreadyOpen) alreadyOpen.push({ channel, layer, device, hasSignal: res.hasSignal })
		} else failed.push(res.entry)
	}
	self._decklinkInputsStatus = { updatedAt: Date.now(), enabled: true, channels: decklinkEntries.map((e) => e.channel), inputsOnMvr: false, requestedSlots: channelMap.decklinkCount, scheduledPlays: inputDevice.length, playSucceeded: playOk, alreadyOpen, skippedConflicts, skippedDuplicates, failed, retrying: failed.length > 0 }
	for (const a of alreadyOpen) {
		self.log(
			'info',
			`DeckLink ${a.device} input already open on ${a.channel}-${a.layer} — no re-PLAY${a.hasSignal === false ? ' (no signal: check the source is powered and cabled)' : ''}`,
		)
	}
	if (failed.length) {
		for (const f of failed) self.log('warn', `DeckLink input setup: ${f.message} (channel ${f.channel}-${f.layer}) — retrying every ${Math.round(DECKLINK_INPUT_RETRY_MS / 1000)}s`)
	}
	scheduleDecklinkInputRetries(self)
}

/**
 * Read what is currently running on one channel-layer. Returns null on any failure — an
 * unreadable INFO means UNKNOWN, and callers must fall through to attempting the PLAY rather
 * than assuming the layer is empty.
 * @param {object} self
 * @param {number} channel
 * @param {number} layer
 */
async function readForegroundProducer(self, channel, layer) {
	try {
		const res = await self.amcp.raw(`INFO ${channel}`)
		return await foregroundProducerOnLayer(infoResponseToXml(res), layer)
	} catch {
		return null
	}
}

/**
 * PLAY one DeckLink input and classify the outcome.
 *
 * A card input can only be enabled by ONE producer. Caspar builds the new producer BEFORE
 * tearing down the one already on the layer, so re-PLAYing a device that THIS layer already
 * holds fails with `404 PLAY FAILED` every single time — forever, at the retry cadence.
 *
 * That is the live 2026-07-21 case, diagnosed on the box: `PLAY 5-4 DECKLINK 4` retried every
 * 20s and always failed, while INFO showed channel 5 layer 4 ALREADY running
 * `producer=decklink, file.path=4` (has_signal=false — nothing cabled, which is why the first
 * attempt got classified failed and entered the retry set). Nothing else held device 4: no
 * decklink consumer in the running config, and channel 3's output consumer is index 3.
 *
 * So the input was already open and working as far as Caspar was concerned — the retry was
 * fighting its own producer. Check first; only PLAY when the layer does not already hold it.
 *
 * Caspar also reports a genuinely un-openable input (camera powered off, nothing cabled,
 * connector-profile conflict) as `404 PLAY FAILED` — the pre-2026-07-19 code pattern-matched
 * that as SUCCESS, so a dead input was counted healthy and never retried. That classification
 * stays: those failures are transient and MUST keep retrying.
 *
 * @param {object} self
 * @param {{ channel: number, layer: number, device: number }} target
 */
async function tryPlayDecklinkInput(self, { channel, layer, device }) {
	const before = await readForegroundProducer(self, channel, layer)
	if (isDecklinkProducerForDevice(before, device)) {
		return { ok: true, alreadyOpen: true, hasSignal: before.hasSignal }
	}
	try {
		await self.amcp.raw(`PLAY ${channel}-${layer} DECKLINK ${device}`)
		return { ok: true }
	} catch (e) {
		const raw = e?.message || String(e)
		// Race guard: another path may have opened it between the pre-check and the PLAY.
		// If the layer now holds the device we asked for, the PLAY was redundant, not failed.
		const after = await readForegroundProducer(self, channel, layer)
		if (isDecklinkProducerForDevice(after, device)) {
			return { ok: true, alreadyOpen: true, hasSignal: after.hasSignal }
		}
		const message = /404|PLAY FAILED/i.test(raw)
			? `DeckLink ${device} input could not be enabled — source powered off / not cabled, or connector-profile conflict`
			: raw
		return { ok: false, entry: { channel, layer, device, message, raw } }
	}
}

const DECKLINK_INPUT_RETRY_MS = 20000

/**
 * Re-attempt failed DeckLink input PLAYs every {@link DECKLINK_INPUT_RETRY_MS} until they
 * come up (e.g. the operator turns the camera on) — one PLAY per failed device per tick,
 * no storm. Re-arms itself only while failures remain; setupInputsChannel re-runs clear
 * and replace the pending timer so reconnect/config-apply never double-schedules.
 * @param {object} self
 */
function scheduleDecklinkInputRetries(self) {
	if (self._decklinkInputRetryTimer) {
		clearTimeout(self._decklinkInputRetryTimer)
		self._decklinkInputRetryTimer = null
	}
	const status = self._decklinkInputsStatus
	if (!status?.enabled || !Array.isArray(status.failed) || status.failed.length === 0) return
	self._decklinkInputRetryTimer = setTimeout(async () => {
		self._decklinkInputRetryTimer = null
		const cur = self._decklinkInputsStatus
		if (!cur?.enabled || !Array.isArray(cur.failed) || cur.failed.length === 0) return
		if (!self.amcp || self.amcp.isConnected === false) { scheduleDecklinkInputRetries(self); return }
		const stillFailed = []
		let recovered = 0
		for (const entry of cur.failed) {
			const res = await tryPlayDecklinkInput(self, entry)
			if (res.ok) {
				recovered++
				self.log('info', `DeckLink ${entry.device} input recovered (channel ${entry.channel}-${entry.layer})`)
			} else {
				stillFailed.push(res.entry)
			}
		}
		self._decklinkInputsStatus = {
			...cur,
			updatedAt: Date.now(),
			playSucceeded: (cur.playSucceeded || 0) + recovered,
			failed: stillFailed,
			retrying: stillFailed.length > 0,
		}
		scheduleDecklinkInputRetries(self)
	}, DECKLINK_INPUT_RETRY_MS)
	if (typeof self._decklinkInputRetryTimer.unref === 'function') self._decklinkInputRetryTimer.unref()
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

async function setupV4l2Inputs(self) {
	const { count, slots } = listConfiguredV4l2Slots(self.config)
	const playable = slots.filter((s) => Number.isFinite(Number(s.channel)))
	if (!self.amcp || count <= 0 || playable.length === 0) {
		self._v4l2InputsStatus = {
			updatedAt: Date.now(),
			enabled: false,
			reason: !self.amcp ? 'amcp_disconnected' : count <= 0 ? 'v4l2_inputs_disabled' : 'no_device_configured',
		}
		return
	}
	const failed = []
	let playOk = 0
	for (const slot of playable) {
		const res = await playV4l2ClipWithRecovery(self, slot, { log: true })
		if (res.ok) playOk++
		else {
			failed.push({
				slot: slot.slot,
				channel: slot.channel,
				layer: slot.layer,
				device: slot.device,
				message: res.reason || 'play_failed',
			})
		}
	}
	self._v4l2InputsStatus = {
		updatedAt: Date.now(),
		enabled: true,
		requestedSlots: count,
		scheduledPlays: playable.length,
		playSucceeded: playOk,
		slots: playable.map((s) => ({
			slot: s.slot,
			channel: s.channel,
			layer: s.layer,
			device: s.device,
			label: s.label,
			clip: s.clip,
			route: s.route,
		})),
		failed,
	}
	self.log('info', `V4L2 inputs: ${playOk}/${playable.length} PLAY on dedicated channel(s) ${playable.map((s) => s.channel).join(', ')}`)
}

async function setupLiveAudioPgmRoutes(self) {
	const map = routingMap.getChannelMap(self.config)
	if (!self.amcp) return
	const alwaysOn =
		routingMap.readCasparSetting(self.config, 'live_audio_pgm_always_on') !== false &&
		routingMap.readCasparSetting(self.config, 'live_audio_pgm_always_on') !== 'false'
	if (!alwaysOn) return
	const { slots } = listConfiguredLiveAudioSlots(self.config)
	if (!slots.length) return

	const screens = resolveLiveAudioPgmTargetScreens(self.config)
	const baseLayer = Math.min(
		9,
		Math.max(1, parseInt(String(routingMap.readCasparSetting(self.config, 'live_audio_pgm_layer') ?? 2), 10) || 2),
	)
	const audioOnly =
		routingMap.readCasparSetting(self.config, 'live_audio_pgm_audio_only') === true ||
		routingMap.readCasparSetting(self.config, 'live_audio_pgm_audio_only') === 'true'
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
	const map = routingMap.getChannelMap(self.config)
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
	const map = routingMap.getChannelMap(self.config); if (!self.amcp) return
	const pgmCh = map.programCh(screenIdx); const prvCh = map.previewCh(screenIdx)
	if (prvCh == null || prvCh === pgmCh) return
	if (routingMap.readCasparSetting(self.config, 'preview_black_cg') === true || String(routingMap.readCasparSetting(self.config, 'preview_black_cg') ?? '').toLowerCase() === 'true') {
		try { await self.amcp.cgAdd(pgmCh, 9, 0, 'black', 1, '') } catch {}
		try { await self.amcp.cgAdd(prvCh, 9, 0, 'black', 1, '') } catch {}
	}
}

async function setupMultiview(self, layout) {
	const map = routingMap.getChannelMap(self.config); if (!map.multiviewEnabled || map.multiviewCh == null || !self.amcp) return
	const ch = map.multiviewCh
	const finalLayout = (layout && layout.length > 0) ? layout : [
		{ layer: 11, x: 0, y: 0, w: 0.5, h: 0.5, route: routingMap.getRouteString(map.programCh(1)) },
		{ layer: 12, x: 0.5, y: 0, w: 0.5, h: 0.5, route: routingMap.getRouteString(map.previewCh(1) || map.programCh(1)) }
	]
	for (const cell of finalLayout) {
		await self.amcp.play(ch, cell.layer, cell.route || cell.source)
		await self.amcp.mixerFill(ch, cell.layer, cell.x, cell.y, cell.w, cell.h)
	}
	await self.amcp.mixerCommit(ch)
}

function syncAllTemplatesToDestination(self, destDir, label) {
	if (!destDir || !fs.existsSync(destDir)) return 0
	const srcRoot = path.join(REPO_ROOT, 'template'); if (!fs.existsSync(srcRoot)) return 0
	let n = 0; for (const ent of fs.readdirSync(srcRoot, { withFileTypes: true })) {
		if (!ent.isFile() || ent.name.startsWith('.')) continue
		try { fs.copyFileSync(path.join(srcRoot, ent.name), path.join(destDir, ent.name)); n++ } catch {}
	}
	if (n > 0) self.log('info', `Template sync: ${n} file(s) → ${destDir} (${label})`)
	return n
}

async function setupAllRouting(self) {
	const { PIP_OVERLAY_TEMPLATE_FILES } = require('../engine/pip-overlay'); const map = routingMap.getChannelMap(self.config)
	// WO-268: runs on boot AND every Caspar reconnect. Tracked template hosts are quarantined at
	// disconnect (index.js status handler) so they stop vouching for WO-196 continuity; here the
	// per-channel INFO XML from the connect gather decides their fate — restore hosts whose layer
	// still runs a producer (TCP-only blip, Caspar kept the template loaded), drop the rest (a
	// genuinely restarted Caspar has empty layers; UPDATE-only takes 403 against them). The old
	// blanket clear restarted on-air template intros after mere connection blips.
	await require('../engine/scene-template-cg').reconcileQuarantinedTemplateHosts(self)
	// WO-271: re-point stale route:// channel references (config live sources + persisted
	// multiview layouts) at the CURRENT channel map before anything replays them — a channel-map
	// shift (e.g. the operator_gui channel insertion) otherwise leaves them routing the wrong
	// channel (live case: mv cells routed the operator channel into its own holes → black).
	try {
		const heal = require('./live-source-route-heal')
		const { changed } = heal.healExtraLiveSourceChannels(self.config, (l, m) => self.log(l, m))
		if (changed && self.configManager) {
			try {
				self.configManager.save({ ...self.configManager.get(), extraLiveSources: self.config.extraLiveSources })
			} catch (e) {
				self.log('warn', `[route-heal] config persist failed: ${e?.message || e}`)
			}
		}
		const { healedKeys } = heal.healPersistedMultiviewLayouts(self)
		if (healedKeys.length) self.log('info', `[route-heal] multiview layouts healed: ${healedKeys.join(', ')}`)
	} catch (e) {
		self.log('warn', `[route-heal] skipped: ${e?.message || e}`)
	}
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
	// Always run so _decklinkInputsStatus clears when decklink inputs are disabled (e.g. factory reset).
	await setupInputsChannel(self)
	if (map.inputsEnabled) {
		await setupLiveAudioInputs(self)
		await setupV4l2Inputs(self)
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
			// WO-156: never PLAY a bus route onto its own channel (self-feedback wedges the channel).
			const busRoute = routingMap.getRouteString(bus1)
			const selfRoute = findSelfRouteViolation(busRoute, outCh)
			if (selfRoute) {
				self.log('warn', `Switcher bus routing skipped for output ch ${outCh}: ${selfRoute.reason}`)
				continue
			}
			try {
				await self.amcp.play(outCh, 1, busRoute)
				self.switcherOutputBusByChannel[String(outCh)] = bus1
			} catch (_) {}
		}
	}
	if (map.multiviewEnabled) {
		// WO-156: re-apply ALL persisted multiviewers (multiviewLayout, multiviewLayout_<n>,
		// HTTP-applied layouts in ctx._multiviewLayouts) with logged retries — runs on boot and
		// on every Caspar reconnect (status → fetchInfo → onAfterInfoConfigReady → here).
		const { reapplyAllMultiviewLayouts } = require('../engine/multiview-reapply')
		await reapplyAllMultiviewLayouts(self)
	}
	if (map.operatorGuiEnabled) {
		// WO-255: re-feed the shape helper + nudge the client to re-report cell rects on
		// boot/reconnect (the CEF layer this used to re-PLAY is retired — see operator-gui-channel.js).
		// Route holes (10-49) are re-applied by the client's operator-gui-mode.js the next time it
		// reports cell rects.
		const { ensureOperatorGuiChannel } = require('../system/operator-gui-channel')
		try {
			await ensureOperatorGuiChannel(self)
		} catch (e) {
			self.log('warn', `Operator GUI channel: ${e?.message || e}`)
		}
		// WO-264: auto-start the operator GUI browser at boot when defined + monitor resolvable.
		// Fire-and-forget (internal retry loop covers X coming up late); never throws.
		const { maybeAutoLaunchOperatorGui } = require('../system/operator-gui-launcher')
		maybeAutoLaunchOperatorGui(self)
	}
	const { setupHostLiveSources } = require('./host-live-sources-setup')
	await setupHostLiveSources(self)
	if (map.streamingCh != null && self.amcp) {
		// Attach mode: `streamingCh` is an existing program/preview bus — it already has output; do not layer route:// on it.
		if (map.streamingAttachToChannel == null) {
			const cLayer = map.streamingContentLayer; const vRoute = routingMap.resolveStreamingChannelRouteForRole(self.config, 'video'); const aRoute = routingMap.resolveStreamingChannelRouteForRole(self.config, 'audio')
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

/**
 * Boot/reconnect re-stage of the persisted preview look onto each PRV bus (restart fix,
 * todos19.07.26): a highascg restart leaves a surviving Caspar showing the PREVIOUS run's
 * staged PRV content, and the operator GUI preview hole shows that stale channel until a
 * first look action. Mirrors the "Multiview re-apply" pattern — runs after the INFO gather
 * + live-scene reconcile settle (index.js chains it off reconcileAfterInfoGather), and
 * stages via the EXISTING preview-only take path (routes-scene-take handleSceneTake with
 * target:'preview' — same '[scene-take] preview-only path' as an operator preview click).
 *
 * Look selection per main (first candidate that still resolves to a project look with
 * content wins — never force-stages garbage after a reconcile clear or look deletion):
 *   1. project envelope `previewSceneIdByMain[i]` (persisted deck selection per main)
 *   2. envelope `previewSceneId` (scalar legacy field, active main only)
 *   3. `liveSceneState.getChannel(prvCh).sceneId` (what was actually staged on PRV last
 *      run — reconcile only clears program channels, so this survives restarts)
 * @param {object} self - app context
 */
async function restagePersistedPreviewLooks(self) {
	if (!self?.amcp || self.amcp.isConnected === false) return
	const map = routingMap.getChannelMap(self.config)
	const liveSceneState = require('../state/live-scene-state')
	const { resolveSceneById } = require('../engine/project-scenes')
	let envelope
	try {
		envelope = require('../engine/project-scenes-load').loadProjectScenes()
	} catch (e) {
		self.log('debug', `Preview re-stage: project load failed (${e?.message || e}) — skipped`)
		return
	}
	const byMain = Array.isArray(envelope?.previewSceneIdByMain) ? envelope.previewSceneIdByMain : []
	const activeIdx = Number(envelope?.activeScreenIndex) || 0
	for (let i = 0; i < (map.screenCount || 0); i++) {
		const pgmCh = map.programChannels?.[i] ?? map.programCh?.(i + 1)
		const prvCh = map.switcherBus1Channels?.[i] ?? map.previewChannels?.[i]
		if (pgmCh == null || prvCh == null || Number(prvCh) <= 0 || Number(prvCh) === Number(pgmCh)) continue
		const candidates = [
			byMain[i],
			i === activeIdx ? envelope?.previewSceneId : null,
			liveSceneState.getChannel(prvCh)?.sceneId,
		]
		let lookId = null
		let look = null
		for (const c of candidates) {
			const id = c != null ? String(c).trim() : ''
			if (!id) continue
			const s = resolveSceneById(id)
			if (s && Array.isArray(s.layers) && s.layers.some((l) => l?.source?.value)) {
				lookId = id
				look = s
				break
			}
		}
		if (!lookId) {
			self.log('debug', `Preview re-stage: no valid persisted look for prv ${prvCh} — skipped`)
			continue
		}
		try {
			const { handleSceneTake } = require('../api/routes-scene-take')
			const res = await handleSceneTake({ channel: pgmCh, target: 'preview', sceneId: lookId, forceCut: true }, self)
			if (res?.status === 200) {
				self.log('info', `Preview re-stage: look ${look?.name || lookId} staged on prv ${prvCh}`)
			} else {
				let errMsg = `status ${res?.status}`
				try {
					errMsg = JSON.parse(res?.body || '{}').error || errMsg
				} catch {
					/* keep status */
				}
				self.log('warn', `Preview re-stage: look ${look?.name || lookId} on prv ${prvCh} failed: ${errMsg}`)
			}
		} catch (e) {
			self.log('warn', `Preview re-stage: look ${look?.name || lookId} on prv ${prvCh} failed: ${e?.message || e}`)
		}
	}
}

/**
 * Boot warm of the look-deck thumbnail cache (restart fix, todos19.07.26): deck cards are a
 * client canvas composite of `GET /api/thumbnail/<mediaId>?hq=1&w=960&t=0` PNGs
 * (scenes-editor-deck-thumb.js → routes-media handleThumbnail → local ffmpeg extraction
 * cached under data/thumbnails). The deck paints ONCE at render — a cold cache means slow /
 * 404'd extractions (WO-184 in-flight guard + 10 s failedThumbs cooldown) and the only
 * repaint trigger is the `scenes-deck-thumb-redraw` event, which fires AFTER a completed
 * preview push — so thumbs stayed blank until the first look play. Pre-generating the exact
 * cache keys the deck requests (maxW 960; the deck's t=0 resolves server-side to seekSec 2 —
 * `parseFloat('0') || 2` in routes-media) makes the first paint an instant cache hit.
 * @param {object} self - app context
 */
async function warmLookDeckThumbnails(self) {
	let envelope
	try {
		envelope = require('../engine/project-scenes-load').loadProjectScenes()
	} catch {
		return
	}
	const scenes = Array.isArray(envelope?.scenes) ? envelope.scenes : []
	const ids = []
	for (const s of scenes) {
		for (const l of Array.isArray(s?.layers) ? s.layers : []) {
			const src = l?.source
			if (!src || src.isPlaceholder || !src.value) continue
			const t = String(src.type || '').toLowerCase()
			if (t === 'media' || t === 'file') ids.push(String(src.value))
		}
	}
	if (!ids.length) return
	const { ensureLocalThumbnailCacheForMediaIds } = require('../media/local-media-ffmpeg')
	const stats = await ensureLocalThumbnailCacheForMediaIds(self.config || {}, ids, {
		maxItems: ids.length,
		maxW: 960,
		seekSec: 2,
	})
	self.log(
		'info',
		`Look thumb warm: ${stats.generated} generated, ${stats.cached} already cached (${stats.attempted} look media file(s))`,
	)
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

async function ensureV4l2InputRouting(ctx) {
	if (!ctx?.amcp) return { ok: false, reason: 'amcp_disconnected' }
	await setupV4l2Inputs(ctx)
	return { ok: true, status: ctx._v4l2InputsStatus ?? null }
}

module.exports = {
	setupInputsChannel,
	tryPlayDecklinkInput,
	setupLiveAudioInputs,
	setupV4l2Inputs,
	setupLiveAudioPgmRoutes,
	ensureLiveAudioRouting,
	ensureV4l2InputRouting,
	setupAudioPreviewBus,
	setupPreviewChannel,
	setupMultiview,
	setupAllRouting,
	setupMappingChannels,
	restagePersistedPreviewLooks,
	warmLookDeckThumbnails,
}

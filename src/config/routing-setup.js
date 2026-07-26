/**
 * Channel routing setup and template syncing.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const routingMap = require('./routing-map')
const {
	normalizeAudioPreview,
	resolveAudioPreviewChannel,
	resolveAudioPreviewDefaultRoute,
} = require('./audio-preview')
const { ensureAllMeterNullConsumers } = require('../audio/meter-null-consumer')
const { startLiveInputMeterHealthWatch, repairLiveInputMetersIfStale } = require('../audio/meter-health')
const { findSelfRouteViolation } = require('../engine/scene-route-deps')
const { setupInputsChannel, tryPlayDecklinkInput } = require('./routing-setup-decklink-inputs')
const { setupLiveAudioInputs, setupV4l2Inputs, setupLiveAudioPgmRoutes } = require('./routing-setup-live-inputs')

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
	if (!destDir || !fs.existsSync(destDir)) return { copied: 0, skipped: 0 }
	const srcRoot = path.join(REPO_ROOT, 'template'); if (!fs.existsSync(srcRoot)) return { copied: 0, skipped: 0 }
	let copied = 0, skipped = 0; for (const ent of fs.readdirSync(srcRoot, { withFileTypes: true })) {
		if (!ent.isFile() || ent.name.startsWith('.')) continue
		const srcPath = path.join(srcRoot, ent.name)
		const destPath = path.join(destDir, ent.name)
		try {
			let shouldCopy = true
			try {
				const srcStat = fs.statSync(srcPath)
				const destStat = fs.statSync(destPath)
				if (destStat.size === srcStat.size && destStat.mtime >= srcStat.mtime) {
					shouldCopy = false
					skipped++
				}
			} catch {
				// If stat fails, attempt copy anyway
			}
			if (shouldCopy) {
				fs.copyFileSync(srcPath, destPath)
				copied++
			}
		} catch {}
	}
	if (copied > 0 || skipped > 0) self.log('info', `Template sync: ${copied} copied, ${skipped} unchanged → ${destDir} (${label})`)
	return { copied, skipped }
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
	// WO-312: the audio route matrix is config, but the route LAYERS carrying the audio are AMCP
	// state and die with Caspar. Replay them server-side on boot and every reconnect — previously
	// only a client button press recreated them, so with the kiosk closed a restart left the matrix
	// claiming "routed" while nothing played. Runs after the input channels exist above.
	try {
		const { reassertLiveInputAudioRoutes } = require('../engine/live-input-route-reassert')
		await reassertLiveInputAudioRoutes(self)
	} catch (e) {
		self.log('warn', `[Audio reassert] skipped: ${e?.message || e}`)
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
		// WO-339 boot sweep: a crashed client can leave editing chrome CG'd on the bus — strip it
		// before restaging so outlines never survive into normal viewing. Best-effort.
		try {
			const { EDIT_CHROME_LAYER } = require('../engine/look-layer-ranges')
			await self.amcp.cgClear(prvCh, EDIT_CHROME_LAYER)
			await self.amcp.mixerClear(prvCh, EDIT_CHROME_LAYER)
		} catch {
			/* chrome sweep is advisory */
		}
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

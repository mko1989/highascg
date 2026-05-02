/**
 * Channel routing setup and template syncing.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const Map = require('./routing-map')

async function setupInputsChannel(self) {
	const map = Map.getChannelMap(self.config)
	if (!map.inputsEnabled || !map.inputsCh || !self.amcp) {
		self._decklinkInputsStatus = { updatedAt: Date.now(), enabled: false, reason: !self.amcp ? 'amcp_disconnected' : (!map.inputsCh ? 'no_inputs_channel' : 'inputs_disabled') }
		return
	}
	const targetCh = map.inputsCh; let hostLabel = map.inputsOnMvr ? `MVR channel ${targetCh}` : (map.decklinkInputsHost === 'preview_1' ? `Preview 1 channel ${targetCh}` : `dedicated inputs channel ${targetCh}`)
	self.log('info', `DeckLink inputs: hosting on ${hostLabel}`)

	const outputDevices = new Set(); for (let n = 1; n <= map.screenCount; n++) {
		const dlOut = parseInt(String(Map.readCasparSetting(self.config, `screen_${n}_decklink_device`) ?? '0'), 10)
		if (dlOut > 0) outputDevices.add(dlOut)
	}
	const mvDlOut = parseInt(String(Map.readCasparSetting(self.config, 'multiview_decklink_device') ?? '0'), 10); if (mvDlOut > 0) outputDevices.add(mvDlOut)

	const usedDevices = new Map(); const inputDevice = []; const skippedConflicts = []; const skippedDuplicates = []
	for (let i = 1; i <= map.decklinkCount; i++) {
		const device = Map.resolveDecklinkInputDeviceIndex(self.config, i)
		if (outputDevices.has(device)) { skippedConflicts.push({ input: i, device }); continue }
		if (usedDevices.has(device)) { skippedDuplicates.push({ input: i, device, firstUser: usedDevices.get(device) }); continue }
		usedDevices.set(device, i); inputDevice.push({ layer: i, device })
	}

	const failed = []; let playOk = 0
	for (const { layer, device } of inputDevice) {
		try { await self.amcp.raw(`PLAY ${targetCh}-${layer} DECKLINK ${device}`); playOk++ }
		catch (e) {
			const msg = e?.message || String(e); if (/already playing|404|PLAY FAILED/i.test(msg)) playOk++
			else failed.push({ layer, device, message: msg })
		}
	}
	self._decklinkInputsStatus = { updatedAt: Date.now(), enabled: true, hostingChannel: targetCh, hostLabel, inputsOnMvr: map.inputsOnMvr, requestedSlots: map.decklinkCount, scheduledPlays: inputDevice.length, playSucceeded: playOk, skippedConflicts, skippedDuplicates, failed }
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
	const srcRoot = path.join(__dirname, '..', '..', 'templates'); if (!fs.existsSync(srcRoot)) return 0
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
	if (map.inputsEnabled) await setupInputsChannel(self)
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
		try { const { handleMultiviewApply } = require('../api/routes-multiview'); await handleMultiviewApply(self._multiviewLayout, self) } catch {}
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
}

async function setupMappingChannels(self) {
	const map = Map.getChannelMap(self.config)
	if (!map.mappingChannels || !map.mappingChannels.length || !self.amcp) return

	const dg = self.config?.deviceGraph || {}
	const edges = Array.isArray(dg.edges) ? dg.edges : []
	const connectors = Array.isArray(dg.connectors) ? dg.connectors : []
	const devices = Array.isArray(dg.devices) ? dg.devices : []

	for (const mc of map.mappingChannels) {
		const ch = mc.ch
		const node = devices.find(d => d.id === mc.nodeId)
		if (!node) continue

		const inConn = connectors.find(c => c.deviceId === node.id && c.kind === 'pixel_map_in')
		const inEdge = edges.find(e => e.sinkId === inConn?.id)
		if (!inEdge) continue
		const srcId = String(inEdge.sourceId)
		if (!srcId.startsWith('dst_in_')) continue
		const dstId = srcId.slice('dst_in_'.length)

		const top = self.config?.tandemTopology || {}
		const dests = Array.isArray(top.destinations) ? top.destinations : []
		const dst = dests.find(d => d.id === dstId)
		if (!dst) continue
		
		const mainIdx = parseInt(String(dst.mainScreenIndex ?? 0), 10) || 0
		const srcCh = map.programChannels[mainIdx]
		if (!srcCh) continue

		const nodeConn = connectors.find(c => c.id === mc.connectorId)
		const outputId = String(nodeConn?.id || '').split('_').pop() // e.g. "1" or "out_1"
		
		const mappings = Array.isArray(node.settings?.mappings) ? node.settings.mappings : []
		const slice = mappings.find(m => m.type === 'video_slice' && (String(m.templateId) === outputId || String(m.templateId).endsWith(outputId)))
		
		if (!slice) continue

		const cw = Math.max(1, parseInt(dst.width, 10) || 1920)
		const chH = Math.max(1, parseInt(dst.height, 10) || 1080)
		
		const cropX = slice.rect.x / cw
		const cropY = slice.rect.y / chH
		const cropW = slice.rect.w / cw
		const cropH = slice.rect.h / chH
		
		try {
			await self.amcp.play(ch, 1, Map.getRouteString(srcCh))
			await self.amcp.mixerCrop(ch, 1, cropX, cropY, cropW, cropH)
			await self.amcp.mixerFill(ch, 1, 0, 0, 1, 1)
			await self.amcp.mixerCommit(ch)
		} catch (e) {
			self.log('error', `Mapping setup failed for channel ${ch}: ${e.message}`)
		}
	}
}

module.exports = { setupInputsChannel, setupPreviewChannel, setupMultiview, setupAllRouting, setupMappingChannels }

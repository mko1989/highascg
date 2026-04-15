/**
 * Channel routing and DeckLink inputs — route strings, preview CG, multiview, startup wiring.
 * @see companion-module-casparcg-server/src/routing.js
 */
'use strict'

const path = require('path')

/**
 * @param {Record<string, unknown>} config
 * @returns {{
 *   screenCount: number,
 *   multiviewEnabled: boolean,
 *   inputsEnabled: boolean,
 *   decklinkCount: number,
 *   programCh: (n: number) => number,
 *   previewCh: (n: number) => number,
 *   programChannels: number[],
 *   previewChannels: number[],
 *   multiviewCh: number | null,
 *   inputsCh: number | null,
 *   audioOnlyChannels: number[]
 * }}
 */
function getChannelMap(config) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	const screenCount = Math.min(
		4,
		Math.max(1, parseInt(String(config?.screen_count ?? cs.screen_count ?? 1), 10) || 1),
	)
	const mv = config?.multiview_enabled ?? cs.multiview_enabled
	const multiviewEnabled = mv !== false && mv !== 'false'
	const decklinkCount = Math.min(
		8,
		Math.max(0, parseInt(String(config?.decklink_input_count ?? cs.decklink_input_count ?? 0), 10) || 0),
	)
	const inputsEnabled = decklinkCount > 0
	const extraAudioCount = Math.min(
		4,
		Math.max(0, parseInt(String(config?.extra_audio_channel_count ?? cs.extra_audio_channel_count ?? 0), 10) || 0),
	)

	let nextCh = screenCount * 2 + 1
	const multiviewCh = multiviewEnabled ? nextCh++ : null
	const inputsCh = inputsEnabled ? nextCh++ : null

	const audioOnlyChannels = []
	for (let i = 0; i < extraAudioCount; i++) {
		audioOnlyChannels.push(nextCh++)
	}

	const programChFn = (n) => (n - 1) * 2 + 1
	const previewChFn = (n) => (n - 1) * 2 + 2

	return {
		screenCount,
		multiviewEnabled,
		inputsEnabled,
		decklinkCount,
		programCh: programChFn,
		previewCh: previewChFn,
		programChannels: Array.from({ length: screenCount }, (_, i) => programChFn(i + 1)),
		previewChannels: Array.from({ length: screenCount }, (_, i) => previewChFn(i + 1)),
		multiviewCh,
		inputsCh,
		audioOnlyChannels,
	}
}

/**
 * @param {number} channel
 * @param {number} [layer]
 * @returns {string}
 */
function getRouteString(channel, layer) {
	if (layer !== undefined && layer !== null) {
		return `route://${channel}-${layer}`
	}
	return `route://${channel}`
}

/**
 * @param {object} self - app context (amcp, config, log)
 * @param {number} srcChannel
 * @param {number} srcLayer
 * @param {number} dstChannel
 * @param {number} dstLayer
 */
async function routeToLayer(self, srcChannel, srcLayer, dstChannel, dstLayer) {
	const route = getRouteString(srcChannel, srcLayer)
	return self.amcp.play(dstChannel, dstLayer, route)
}

/**
 * @param {object} self
 */
async function setupInputsChannel(self) {
	const map = getChannelMap(self.config)
	if (!map.inputsEnabled || !map.inputsCh || !self.amcp) return

	const usedDevices = new Map()
	const inputDevice = []
	const skippedDuplicates = []

	for (let i = 1; i <= map.decklinkCount; i++) {
		const device = parseInt(String(self.config[`decklink_input_${i}_device`] || i), 10) || i
		if (usedDevices.has(device)) {
			const firstUser = usedDevices.get(device)
			skippedDuplicates.push({ input: i, device, firstUser })
			self.log(
				'warn',
				`DeckLink input ${i}: device ${device} already in use by input ${firstUser}. Each physical device can only be played once — skipping. Use 1:1 mapping (input 1→device 1, input 2→device 2, etc.).`
			)
			continue
		}
		usedDevices.set(device, i)
		inputDevice.push({ layer: i, device })
	}

	const failed = []
	for (const { layer, device } of inputDevice) {
		try {
			await self.amcp.raw(`PLAY ${map.inputsCh}-${layer} DECKLINK ${device}`)
			self.log('debug', `DeckLink input ${layer} (device ${device}): OK`)
		} catch (e) {
			const msg = e?.message || String(e)
			const isAlreadyPlaying = /already playing|404|PLAY FAILED/i.test(msg)
			if (isAlreadyPlaying) {
				self.log('debug', `DeckLink input ${layer} (device ${device}): already playing (reconnect) — OK`)
			} else {
				failed.push({ layer, device })
				const hint = ' Possible causes: device in use elsewhere, unsupported format, or not connected. Check inputs channel mode.'
				self.log('warn', `DeckLink input ${layer} (device ${device}): ${msg}${hint}`)
			}
		}
	}

	if (skippedDuplicates.length > 0 || failed.length > 0) {
		const parts = []
		if (skippedDuplicates.length > 0) parts.push(`${skippedDuplicates.length} skipped (duplicate device)`)
		if (failed.length > 0) parts.push(`${failed.length} failed`)
		self.log('info', `DeckLink setup summary: ${inputDevice.length - failed.length} of ${map.decklinkCount} inputs ready. ${parts.join(', ')}.`)
	}
}

/**
 * @param {object} self
 * @param {number} screenIdx - 1-based
 */
async function setupPreviewChannel(self, screenIdx, _programLayer) {
	const map = getChannelMap(self.config)
	const previewCh = map.previewCh(screenIdx)
	const programCh = map.programCh(screenIdx)

	if (!self.amcp) return

	const blackCg =
		self.config?.preview_black_cg === true || String(self.config?.preview_black_cg || '').toLowerCase() === 'true'
	if (blackCg) {
		try {
			await self.amcp.cgAdd(programCh, 9, 0, 'black', 1, '')
		} catch (e) {
			self.log(
				'warn',
				`Program ch ${programCh} layer 9: black template failed. Deploy black.html to CasparCG's template folder (not only local media path).`
			)
		}
		try {
			await self.amcp.cgAdd(previewCh, 9, 0, 'black', 1, '')
		} catch (e) {
			self.log(
				'warn',
				`Preview ch ${previewCh} layer 9: black template failed. Deploy black.html to CasparCG's template folder (not only local media path).`
			)
		}
	} else {
		self.log(
			'debug',
			`Preview ch ${previewCh} / program ch ${programCh}: skipping black CG (enable option preview_black_cg after deploying black.html to Caspar's template folder).`
		)
	}
}

/**
 * @param {object} self
 * @param {Array<{ layer: number, x: number, y: number, w: number, h: number, source?: string, route?: string }>} [layout]
 */
async function setupMultiview(self, layout) {
	const map = getChannelMap(self.config)
	if (!map.multiviewEnabled || map.multiviewCh == null || !self.amcp) return

	if (!layout || layout.length === 0) {
		const sources = []
		if (map.screenCount >= 1) {
			sources.push({ layer: 1, x: 0, y: 0, w: 0.5, h: 0.5, route: getRouteString(map.programCh(1)) })
			sources.push({ layer: 2, x: 0.5, y: 0, w: 0.5, h: 0.5, route: getRouteString(map.previewCh(1)) })
		}
		if (map.inputsEnabled && map.inputsCh) {
			for (let i = 1; i <= Math.min(map.decklinkCount, 2); i++) {
				sources.push({
					layer: 2 + i,
					x: (i - 1) * 0.5,
					y: 0.5,
					w: 0.5,
					h: 0.5,
					route: getRouteString(map.inputsCh, i),
				})
			}
		}
		layout = sources
	}

	const ch = map.multiviewCh
	for (const cell of layout) {
		await self.amcp.play(ch, cell.layer, cell.route || cell.source)
		await self.amcp.mixerFill(ch, cell.layer, cell.x, cell.y, cell.w, cell.h)
	}
	await self.amcp.mixerCommit(ch)
}

/** Repo `templates/` (next to HighAsCG `web/`, `index.js`). */
function templatesDir() {
	return path.join(__dirname, '..', '..', 'templates')
}

/**
 * Inputs channel, preview black CG per screen, restore persisted multiview if any.
 * Call after Caspar connect when `self.amcp` and `self.log` exist (**T10**).
 *
 * NOTE: `pip-overlay` must be required **lazily** here — a top-level require creates a cycle
 * (`routing` → `pip-overlay` → `scene-native-fill` → `routing`) and `getChannelMap` is undefined
 * on the incomplete `routing` export (breaks GET /api/settings, scene take, etc.).
 * @param {object} self - app context
 */
async function setupAllRouting(self) {
	const { PIP_OVERLAY_TEMPLATE_FILES } = require('../engine/pip-overlay')
	const map = getChannelMap(self.config)

	const templateBase = (self.config?.local_template_path || '').trim()
	const basePath = (self.config?.local_media_path || '').trim()

	/** LED test card: prefer Caspar template-path so assets are not under media-path / CLS. */
	function deployLedTestAssets(destDir, label) {
		if (!destDir) return
		const fs = require('fs')
		const ledSrc = path.join(templatesDir(), 'led_grid_test.html')
		const ledDest = path.join(destDir, 'led_grid_test.html')
		if (fs.existsSync(ledSrc) && !fs.existsSync(ledDest)) {
			fs.copyFileSync(ledSrc, ledDest)
			self.log('info', `Deployed led_grid_test.html to ${ledDest} (${label})`)
		}
		/** Full character frames for led_grid_test (not the header status-eye assets). */
		for (const name of ['both_open.svg', 'left_closed.svg', 'right_closed.svg']) {
			const src = path.join(templatesDir(), name)
			const dest = path.join(destDir, name)
			if (fs.existsSync(src) && !fs.existsSync(dest)) {
				fs.copyFileSync(src, dest)
				self.log('info', `Deployed ${name} to ${dest} (${label})`)
			}
		}
	}

	if (templateBase) {
		try {
			const fs = require('fs')
			if (!fs.existsSync(templateBase)) {
				self.log('warn', `local_template_path does not exist yet: ${templateBase} — create it or fix highascg.config.json`)
			} else {
				deployLedTestAssets(templateBase, 'template-path')
			}
		} catch (e) {
			self.log('debug', 'LED template deploy: ' + (e?.message || e))
		}
	} else if (basePath) {
		try {
			const fs = require('fs')
			deployLedTestAssets(basePath, 'media-path fallback')
			self.log(
				'info',
				'LED test card assets use local_media_path; set local_template_path to Caspar template-path to keep them out of the media browser (CLS).'
			)
		} catch (e) {
			self.log('debug', 'LED media fallback deploy: ' + (e?.message || e))
		}
	}

	if (basePath) {
		try {
			const fs = require('fs')
			const overlayDest = path.join(basePath, 'multiview_overlay.html')
			const overlaySrc = path.join(templatesDir(), 'multiview_overlay.html')
			if (fs.existsSync(overlaySrc) && !fs.existsSync(overlayDest)) {
				fs.copyFileSync(overlaySrc, overlayDest)
				self.log('info', `Deployed multiview_overlay.html to ${overlayDest}`)
			}
			const blackDest = path.join(basePath, 'black.html')
			if (!fs.existsSync(blackDest)) {
				fs.writeFileSync(
					blackDest,
					'<!DOCTYPE html><html><head><style>*{margin:0;padding:0}html,body{width:100%;height:100%;background:#000}</style></head><body></body></html>'
				)
				self.log('info', `Deployed black.html to ${blackDest}`)
			}
		} catch (e) {
			self.log('debug', 'Auto-deploy templates: ' + (e?.message || e))
		}
	}

	// Deploy PIP overlay HTML templates to Caspar's template folder
	const pipDeployDir = templateBase || basePath
	if (pipDeployDir) {
		try {
			const fs = require('fs')
			for (const tplFile of PIP_OVERLAY_TEMPLATE_FILES) {
				const src = path.join(templatesDir(), tplFile)
				const dest = path.join(pipDeployDir, tplFile)
				if (fs.existsSync(src) && !fs.existsSync(dest)) {
					fs.copyFileSync(src, dest)
					self.log('info', `Deployed PIP overlay template ${tplFile} to ${dest}`)
				}
			}
		} catch (e) {
			self.log('debug', 'PIP overlay template deploy: ' + (e?.message || e))
		}
	}

	// Verify PIP overlay templates are reachable via TLS (async, non-blocking)
	if (self.amcp) {
		try {
			const tls = await self.amcp.raw('TLS')
			const tlsData = Array.isArray(tls?.data) ? tls.data.join('\n') : String(tls?.data || '')
			for (const tplFile of PIP_OVERLAY_TEMPLATE_FILES) {
				const tplName = tplFile.replace(/\.html$/, '')
				if (!tlsData.toLowerCase().includes(tplName.toLowerCase())) {
					self.log(
						'warn',
						`PIP overlay template "${tplName}" not found in CasparCG TLS list. ` +
						`Deploy ${tplFile} to the CasparCG template folder (e.g. /opt/casparcg/template/).`
					)
				}
			}
		} catch (e) {
			self.log('debug', 'PIP overlay TLS verify: ' + (e?.message || e))
		}
	}

	if (map.inputsEnabled) {
		await setupInputsChannel(self)
	}

	for (let n = 1; n <= map.screenCount; n++) {
		try {
			await setupPreviewChannel(self, n)
		} catch (e) {
			self.log('warn', `Preview channel ${n} setup: ${e?.message || e}`)
		}
	}

	const mvPersist = self._multiviewLayout
	if (
		map.multiviewEnabled &&
		mvPersist &&
		typeof mvPersist === 'object' &&
		Array.isArray(mvPersist.layout) &&
		mvPersist.layout.length > 0
	) {
		try {
			const { handleMultiviewApply } = require('../api/routes-multiview')
			const result = await handleMultiviewApply(mvPersist, self)
			if (result?.status === 200) {
				self.log('debug', 'Multiview layout restored from persisted state')
			} else {
				self.log(
					'warn',
					`Multiview layout restore returned ${result?.status}: ${JSON.stringify(result?.body || '')} — open Multiview and click Apply to push a layout.`
				)
			}
		} catch (e) {
			self.log('warn', `Multiview layout restore: ${e?.message || e}`)
		}
	}
}

module.exports = {
	getChannelMap,
	getRouteString,
	routeToLayer,
	setupInputsChannel,
	setupPreviewChannel,
	setupMultiview,
	setupAllRouting,
}

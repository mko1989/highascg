'use strict'

const { channelXmlComment } = require('./config-generator-xml-comments')
const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { pushCustomMode } = require('./config-generator-custom-modes')
const { buildChannelPlan } = require('./config-generator-channel-plan')
const {
	buildScreenPairChannels,
	buildMultiviewChannel,
	buildInputsHostChannel,
	buildExtraAudioChannel,
	buildPixelmapChannel,
	buildInputChannel,
	buildHostLiveChannel,
	buildStreamingChannel,
	buildMonitorChannelXml,
} = require('./config-generator-consumer-attach')
const { buildOperatorGuiChannel } = require('./config-generator-operator-gui')
const { parseOptionalPixel } = require('./config-generator-utils')

/**
 * Caspar multiview `<screen>` x — OS layout planner first, then mapping GPU bbox (WO-40a), not PGM channel width strip.
 * When multiview shares a GPU with record-only mains (no Caspar `<screen>` on PGM), use the Caspar consumer strip origin (0).
 * @param {Record<string, unknown>} config
 * @param {ReturnType<import('../utils/os-layout-calculator').calculateLayoutPositions>} layout
 * @param {number} mvIndex 1-based
 * @param {number} cumulativeX fallback when no planner / mapping hint
 * @param {{ screenHasConsumer?: Record<number, boolean> }} [opts]
 */
function resolveMultiviewConsumerX(config, layout, mvIndex, cumulativeX, opts = {}) {
	const n = mvIndex
	const keyed = config[`multiview_${n}_x`] ?? config.multiview_x
	if (keyed !== undefined && keyed !== null && String(keyed).trim() !== '') {
		return parseOptionalPixel(keyed, cumulativeX)
	}
	const mvInfo = layout?.multiview?.[n]
	if (mvInfo && Number.isFinite(mvInfo.x)) {
		const mvSys = String(mvInfo.sysId || '').trim()
		if (mvSys) {
			const sameGpuScreens = Object.entries(layout.screens || {}).filter(
				([, info]) => info && String(info.sysId || '').trim() === mvSys,
			)
			if (sameGpuScreens.length > 0) {
				const anyConsumer = sameGpuScreens.some(([idx]) => opts.screenHasConsumer?.[parseInt(idx, 10)])
				return anyConsumer ? mvInfo.x : cumulativeX
			}
		}
		return mvInfo.x
	}
	const bbox = layout?.mappingGpuBBox
	const hasMapGpu = Array.isArray(layout?.mappingGpuOutputs) && layout.mappingGpuOutputs.length > 0
	if (hasMapGpu && bbox && Number.isFinite(bbox.maxX)) {
		const spanX = bbox.maxX - bbox.minX
		const spanY = bbox.maxY - bbox.minY
		if (spanX >= spanY) return Math.max(0, bbox.maxX)
	}
	return cumulativeX
}

/**
 * Build full `<channels>` XML entries and collect custom video modes.
 * Keeps existing generation behavior while moving channel assembly out of config-generator.js.
 *
 * @param {Record<string, unknown>} config
 * @param {ReturnType<import('./routing').getChannelMap>} routeMap
 */
function buildChannelsSection(config, routeMap) {
	const plan = buildChannelPlan(config, routeMap)

	/** @type {Map<number, string>} */
	const channelXmlByNumber = new Map()
	/** @type {string[]} */
	const customVideoModes = []
	const customModeIds = new Set()
	let cumulativeX = 0
	let nextDevice = 1
	/** @type {Record<number, boolean>} */
	const screenHasConsumer = {}

	const { calculateLayoutPositions } = require('../utils/os-config')
	const layout = calculateLayoutPositions(config)
	const setChannelXml = (channelNum, xml) => {
		const n = parseInt(String(channelNum || ''), 10)
		if (!Number.isFinite(n) || n < 1 || !xml) return
		channelXmlByNumber.set(n, xml)
	}

	for (const s of plan.screens) {
		// WO-242: pixelmap screens skip the generic PGM/PRV screen-consumer build entirely — one
		// PGM-only channel carrying a native <artnet> consumer, no PRV pair, no GPU screen consumer.
		if (s.pixelmap) {
			const pgmChNum = routeMap.programCh(s.n)
			setChannelXml(pgmChNum, buildPixelmapChannel(config, s.pixelmap, s.dims, pgmChNum))
			if (s.dims.isCustom) pushCustomMode(customVideoModes, customModeIds, s.dims)
			continue
		}
		const info = layout.screens[s.n]
		const pair = buildScreenPairChannels(config, routeMap, {
			n: s.n,
			dims: s.dims,
			cumulativeX: info ? info.x : cumulativeX,
			nextDevice,
		})
		const previewOn = Array.isArray(routeMap.previewEnabledByMain) ? routeMap.previewEnabledByMain[s.n - 1] !== false : true
		setChannelXml(routeMap.programCh(s.n), pair.pgmXml)
		if (previewOn) setChannelXml(routeMap.previewCh(s.n), pair.prvXml)
		if (routeMap.switcherBusMode && routeMap.switcherBusChannels?.[s.n - 1] != null) {
			setChannelXml(routeMap.switcherBusChannels[s.n - 1], pair.bus2Xml)
		}
		if (pair.hasScreenConsumer) {
			screenHasConsumer[s.n] = true
			cumulativeX += s.dims.width
			nextDevice++
		}
		/* WO-364: the PRV head's <screen> window claims its own device number. */
		if (pair.hasPrvScreenConsumer && previewOn) {
			cumulativeX += s.dims.width
			nextDevice++
		}
		if (s.dims.isCustom) pushCustomMode(customVideoModes, customModeIds, s.dims)
	}

	if (plan.multiviewEnabled) {
		const mvs = Array.isArray(plan.multiviews) ? plan.multiviews : []
		mvs.forEach((mvPlan, idx) => {
			const mvIndex = idx + 1
			const mvDefaultX = resolveMultiviewConsumerX(config, layout, mvIndex, cumulativeX, { screenHasConsumer })
			const mv = buildMultiviewChannel(config, routeMap, { 
				n: mvIndex,
				dims: mvPlan.dims,
				cumulativeX: mvDefaultX, 
				nextDevice 
			})
			const mvCh = Array.isArray(routeMap.multiviewChannels) ? routeMap.multiviewChannels[idx] : routeMap.multiviewCh
			setChannelXml(mvCh, mv.xml)
			if (mv.usedScreenConsumer) {
				cumulativeX += mvPlan.dims.width
				nextDevice++
			}
			if (mvPlan.dims.isCustom) pushCustomMode(customVideoModes, customModeIds, mvPlan.dims)
		})
	}

	// WO-243: operator_gui utility channel(s) — after screens/multiview (mirrors multiview's
	// placement: doesn't advance cumulativeX/nextDevice since its device/position come from
	// resolveOperatorMonitorPort()/physicalPort, not the sequential virtual-display strip).
	if (plan.operatorGuiEnabled) {
		const ogs = Array.isArray(plan.operatorGuis) ? plan.operatorGuis : []
		for (const ogPlan of ogs) {
			const xml = buildOperatorGuiChannel(config, ogPlan.dest, ogPlan.dims, { cumulativeX, nextDevice, layout }, ogPlan.ch)
			setChannelXml(ogPlan.ch, xml)
			if (ogPlan.dims.isCustom) pushCustomMode(customVideoModes, customModeIds, ogPlan.dims)
		}
	}

	// WO-53: one dedicated channel per live input (DeckLink/ALSA play here over AMCP).
	for (const entry of plan.inputChannels) {
		if (entry.kind === 'webpage_host' || entry.kind === 'ndi_host' || entry.kind === 'browser_display') {
			setChannelXml(entry.channel, buildHostLiveChannel(config, entry))
		} else {
			setChannelXml(entry.channel, buildInputChannel(config, entry))
		}
	}
	// Legacy: empty inputs-host channel only when the host toggle is on with no real inputs.
	if (plan.inputChannels.length === 0) {
		const hostXml = buildInputsHostChannel(
			config,
			plan.decklinkCount,
			plan.liveAudioCount,
			plan.inputsHostChannelEnabled,
			routeMap.inputsOnMvr,
			routeMap.inputsCh,
		)
		if (hostXml) setChannelXml(routeMap.inputsCh, hostXml)
	}

	for (const a of plan.extraAudio) {
		if (a.dims.isCustom) pushCustomMode(customVideoModes, customModeIds, a.dims)
		const audioCh = Array.isArray(routeMap.audioOnlyChannels) ? routeMap.audioOnlyChannels[a.i - 1] : null
		setChannelXml(audioCh, buildExtraAudioChannel(config, a.i, a.dims, audioCh))
	}

	if (plan.streamingChannelDedicatedSlot) setChannelXml(routeMap.streamingCh, buildStreamingChannel(config, routeMap.streamingCh))

	// The solo bus routes from whatever main channels exist — plain screens OR operator-GUI
	// channels (an operator-gui-only box has plan.screens empty; falling back to 576p2500
	// against a 50 fps GUI channel re-creates the WO-237 every-other-frame audio chop).
	const monitorSourceFps = plan.screens?.[0]?.dims?.fps ?? plan.operatorGuis?.[0]?.dims?.fps
	const monitorXml = buildMonitorChannelXml(config, routeMap.monitorCh, monitorSourceFps)
	if (monitorXml) setChannelXml(routeMap.monitorCh, monitorXml)

	const usedNums = [...channelXmlByNumber.keys()]
	const maxChannel = usedNums.length ? Math.max(...usedNums) : 0
	/** @type {string[]} */
	const channelsXml = []
	for (let ch = 1; ch <= maxChannel; ch++) {
		const xml = channelXmlByNumber.get(ch)
		if (xml) channelsXml.push(xml)
		else {
			channelsXml.push(
				`${channelXmlComment(`Caspar channel ${ch}: Placeholder (routing reserved this index but no consumer block was emitted; regenerate from Settings or report)`)}        <channel>
            <video-mode>1080p5000</video-mode>
            <consumers/>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`,
			)
		}
	}

	return { channelsXml, customVideoModes }
}

module.exports = { buildChannelsSection, resolveMultiviewConsumerX }

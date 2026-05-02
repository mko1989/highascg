'use strict'

const { STANDARD_VIDEO_MODES } = require('./config-modes')
const { pushCustomMode } = require('./config-generator-custom-modes')
const { buildChannelPlan } = require('./config-generator-channel-plan')
const {
	buildScreenPairChannels,
	buildMultiviewChannel,
	buildInputsHostChannel,
	buildExtraAudioChannel,
	buildStreamingChannel,
	buildMonitorChannelXml,
} = require('./config-generator-consumer-attach')

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

	const { calculateLayoutPositions } = require('../utils/os-config')
	const layout = calculateLayoutPositions(config)
	const setChannelXml = (channelNum, xml) => {
		const n = parseInt(String(channelNum || ''), 10)
		if (!Number.isFinite(n) || n < 1 || !xml) return
		channelXmlByNumber.set(n, xml)
	}

	for (const s of plan.screens) {
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
			cumulativeX += s.dims.width
			nextDevice++
		}
		if (s.dims.isCustom) pushCustomMode(customVideoModes, customModeIds, s.dims)
	}

	if (plan.multiviewEnabled) {
		const mvs = Array.isArray(plan.multiviews) ? plan.multiviews : []
		mvs.forEach((mvPlan, idx) => {
			const mvIndex = idx + 1
			const mvInfo = layout.multiview[mvIndex]
			const mv = buildMultiviewChannel(config, routeMap, { 
				n: mvIndex,
				dims: mvPlan.dims,
				cumulativeX: mvInfo ? mvInfo.x : cumulativeX, 
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

	const hostXml = buildInputsHostChannel(config, plan.decklinkCount, plan.inputsHostChannelEnabled, routeMap.inputsOnMvr)
	if (hostXml) setChannelXml(routeMap.inputsCh, hostXml)

	for (const a of plan.extraAudio) {
		if (a.dims.isCustom) pushCustomMode(customVideoModes, customModeIds, a.dims)
		const audioCh = Array.isArray(routeMap.audioOnlyChannels) ? routeMap.audioOnlyChannels[a.i - 1] : null
		setChannelXml(audioCh, buildExtraAudioChannel(config, a.i, a.dims))
	}

	if (plan.streamingChannelDedicatedSlot) setChannelXml(routeMap.streamingCh, buildStreamingChannel(config))
	
	const monitorXml = buildMonitorChannelXml(config)
	if (monitorXml) setChannelXml(routeMap.monitorCh, monitorXml)

	const usedNums = [...channelXmlByNumber.keys()]
	const maxChannel = usedNums.length ? Math.max(...usedNums) : 0
	/** @type {string[]} */
	const channelsXml = []
	for (let ch = 1; ch <= maxChannel; ch++) {
		const xml = channelXmlByNumber.get(ch)
		if (xml) channelsXml.push(xml)
		else {
			channelsXml.push(`        <channel>
            <video-mode>1080p5000</video-mode>
            <consumers/>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`)
		}
	}

	return { channelsXml, customVideoModes }
}

module.exports = { buildChannelsSection }

/**
 * CasparCG config XML generator.
 * Video mode presets: ./config-modes.js
 * @see companion-module-casparcg-server/src/config-generator.js
 */
'use strict'

const {
	STANDARD_VIDEO_MODES,
	calculateCadence,
	getModeDimensions,
	AUDIO_LAYOUT_CHOICES,
	getExtraAudioModeDimensions,
	getStandardModeChoices,
	layoutChannelCount,
} = require('./config-modes')
const {
	mergeAudioRoutingIntoConfig,
	buildAudioLayoutsXml,
	buildOscConfigurationXml,
	buildCustomLiveRootXml,
	escapeXml,
	normalizeAudioRouting,
	getProgramChannelAudioLayouts,
	getExtraAudioChannelLayouts,
	defaultFfmpegAudioArgs,
} = require('./config-generator-builders')
const { getChannelMap } = require('./routing')
const { buildChannelsSection } = require('./config-generator-channels')

/**
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
function buildConfigXml(config) {
	config = mergeAudioRoutingIntoConfig(config)
	const routeMap = getChannelMap(config)
	const screenCount = routeMap.screenCount
	const { channelsXml, customVideoModes } = buildChannelsSection(config, routeMap)

	const videoModesXml =
		customVideoModes.length > 0
			? `    <video-modes>
${customVideoModes.join('\n')}
    </video-modes>`
			: '    <video-modes/>'

	// T3.2: Allow manual custom modes from config
	let finalVideoModesXml = videoModesXml
	if (config.video_modes && Array.isArray(config.video_modes)) {
		const manualModes = config.video_modes.map(vm => {
			const id = escapeXml(vm.id)
			const ts = parseInt(vm.time_scale || '50000', 10)
			const dur = parseInt(vm.duration || '1000', 10)
			return `        <video-mode>
            <id>${id}</id>
            <width>${parseInt(vm.width, 10)}</width>
            <height>${parseInt(vm.height, 10)}</height>
            <time-scale>${ts}</time-scale>
            <duration>${dur}</duration>
            <cadence>${escapeXml(vm.cadence || 'progressive')}</cadence>
        </video-mode>`
		})
		if (customVideoModes.length === 0) {
			finalVideoModesXml = `    <video-modes>\n${manualModes.join('\n')}\n    </video-modes>`
		} else {
			finalVideoModesXml = finalVideoModesXml.replace('    </video-modes>', manualModes.join('\n') + '\n    </video-modes>')
		}
	}

	const oscXml = buildOscConfigurationXml(config)
	const controllersXml = `    <controllers><tcp><port>5250</port><protocol>AMCP</protocol></tcp>
    </controllers>`

	const audioSectionXml = buildAudioLayoutsXml(config, screenCount)
	const customLiveRootXml = buildCustomLiveRootXml(config)
	const ndiAutoLoad =
		config.ndi_auto_load === false || config.ndi_auto_load === 'false' ? 'false' : 'true'

	return `<configuration>
    <paths>
        <media-path>media/</media-path>
        <log-path disable="false">log/</log-path>
        <data-path>data/</data-path>
        <template-path>template/</template-path>
    </paths>
    <lock-clear-phrase>secret</lock-clear-phrase>
${customLiveRootXml}${audioSectionXml}    <channels>
${channelsXml.join('\n')}
    </channels>
${finalVideoModesXml}
${controllersXml}
${oscXml}
    <amcp><media-server><host>localhost</host><port>8000</port></media-server></amcp>
    <ndi><auto-load>${ndiAutoLoad}</auto-load></ndi>
    <decklink/>
    <html>
        <enable-gpu>false</enable-gpu>
    </html>
</configuration>`
}

module.exports = {
	buildConfigXml,
	mergeAudioRoutingIntoConfig,
	normalizeAudioRouting,
	buildOscConfigurationXml,
	getStandardModeChoices,
	STANDARD_VIDEO_MODES,
	calculateCadence,
	getModeDimensions,
	AUDIO_LAYOUT_CHOICES,
	getProgramChannelAudioLayouts,
	getExtraAudioChannelLayouts,
	getExtraAudioModeDimensions,
	layoutChannelCount,
	defaultFfmpegAudioArgs,
}

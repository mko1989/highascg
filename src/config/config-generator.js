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
	parseOptionalPixel,
	buildAudioLayoutsXml,
	buildOscConfigurationXml,
	buildStreamingFfmpegConsumerXml,
	buildScreenFfmpegConsumersXml,
	buildExtraAudioFfmpegConsumersXml,
	channelLayoutElementXml,
	buildProgramSystemAudioXml,
	buildPreviewSystemAudioXml,
	buildScreenConsumerExtrasXml,
	buildPortAudioConsumerXml,
	escapeXml,
	normalizeAudioRouting,
	getProgramChannelAudioLayouts,
	getExtraAudioChannelLayouts,
	defaultFfmpegAudioArgs,
} = require('./config-generator-builders')

/**
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
function buildConfigXml(config) {
	config = mergeAudioRoutingIntoConfig(config)
	const screenCount = Math.min(4, Math.max(1, parseInt(String(config.screen_count || 1), 10) || 1))
	const multiviewEnabled = config.multiview_enabled !== false && config.multiview_enabled !== 'false'
	const decklinkCount = Math.min(8, Math.max(0, parseInt(String(config.decklink_input_count || 0), 10) || 0))
	const extraAudioCount = Math.min(4, Math.max(0, parseInt(String(config.extra_audio_channel_count || 0), 10) || 0))

	const channelsXml = []
	const customVideoModes = []
	const customModeIds = new Set()
	let cumulativeX = 0
	let nextDevice = 1

	for (let n = 1; n <= screenCount; n++) {
		const mode = String(config[`screen_${n}_mode`] || '1080p5000')
		const dims = getModeDimensions(mode, config, n)
		const stretch = ['none', 'fill', 'uniform', 'uniform_to_fill'].includes(String(config[`screen_${n}_stretch`] || 'none'))
			? String(config[`screen_${n}_stretch`])
			: 'none'
		const windowed = config[`screen_${n}_windowed`] !== false && config[`screen_${n}_windowed`] !== 'false'
		const vsync = config[`screen_${n}_vsync`] !== false && config[`screen_${n}_vsync`] !== 'false'
		const alwaysOnTop = config[`screen_${n}_always_on_top`] !== false && config[`screen_${n}_always_on_top`] !== 'false'
		const borderless = config[`screen_${n}_borderless`] === true || config[`screen_${n}_borderless`] === 'true'

		const posX = parseOptionalPixel(config[`screen_${n}_x`], cumulativeX)
		const posY = parseOptionalPixel(config[`screen_${n}_y`], 0)

		const screenXml = [
			`<device>${nextDevice}</device>`,
			`<x>${posX}</x><y>${posY}</y>`,
			`<width>${dims.width}</width><height>${dims.height}</height>`,
			`<stretch>${stretch}</stretch>`,
			`<windowed>${windowed}</windowed>`,
			`<vsync>${vsync}</vsync>`,
			`<always-on-top>${alwaysOnTop}</always-on-top>`,
			`<borderless>${borderless}</borderless>`,
		].join('\n                    ')
		const screenExtras = buildScreenConsumerExtrasXml(config, n)
		const screenInner = screenXml + (screenExtras ? `\n                    ${screenExtras}` : '')
		const audioLayoutId = String(config[`screen_${n}_audio_layout`] || 'default')
		const layoutXml = channelLayoutElementXml(audioLayoutId)
		const ffmpegXml = buildScreenFfmpegConsumersXml(config, n)
		const screenSystemAudioXml = buildProgramSystemAudioXml(config, n)
		const portAudioXml = buildPortAudioConsumerXml(config, n)

		// Professional consumers (T3.2)
		let profConsumersXml = ''
		const decklinkDevice = parseInt(String(config[`screen_${n}_decklink_device`] || '0'), 10)
		if (decklinkDevice > 0) {
			profConsumersXml += `\n                <decklink>
                    <device>${decklinkDevice}</device>
                </decklink>`
		}
		const ndiEnabled = config[`screen_${n}_ndi_enabled`] === true || config[`screen_${n}_ndi_enabled`] === 'true'
		if (ndiEnabled) {
			const ndiName = escapeXml(config[`screen_${n}_ndi_name`] || `HighAsCG-CH${n}`)
			profConsumersXml += `\n                <ndi>
                    <name>${ndiName}</name>
                </ndi>`
		}

		// UDP preview streaming for PGM (Ch 1, 4, 7, 10...)
		const streamingBasePort = parseInt(String(config.streaming?.basePort || '10000'), 10) || 10000
		const pgmStreamingXml = buildStreamingFfmpegConsumerXml(config, streamingBasePort + (n - 1) * 3 + 1)

		channelsXml.push(
			`        <channel>
            <video-mode>${dims.modeId}</video-mode>${layoutXml}
            <consumers>
                <screen>
                    ${screenInner}
                </screen>${screenSystemAudioXml}${portAudioXml}${ffmpegXml}${pgmStreamingXml}${profConsumersXml}
            </consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
		)
		cumulativeX += dims.width
		nextDevice++

		// UDP preview streaming for PRV (Ch 2, 5, 8, 11...)
		const prvStreamingXml = buildStreamingFfmpegConsumerXml(config, streamingBasePort + (n - 1) * 3 + 2)
		const prvSystemAudioXml = buildPreviewSystemAudioXml(config, n)

		channelsXml.push(
			`        <channel>
            <video-mode>${dims.modeId}</video-mode>
            <consumers>${prvStreamingXml}${prvSystemAudioXml}</consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
		)

		// Custom <video-mode>: time-scale = fps×1000, duration always 1000, cadence = 48000/fps (see config-modes.calculateCadence).
		if (dims.isCustom && !customModeIds.has(dims.modeId)) {
			customModeIds.add(dims.modeId)
			const timeScale = Math.round(dims.fps * 1000)
			const cad = calculateCadence(dims.fps)
			customVideoModes.push(
				`        <video-mode>
            <id>${dims.modeId}</id>
            <width>${dims.width}</width>
            <height>${dims.height}</height>
            <time-scale>${timeScale}</time-scale>
            <duration>1000</duration>
            <cadence>${cad}</cadence>
        </video-mode>`
			)
		}
	}

	if (multiviewEnabled) {
		const mode = String(config.multiview_mode || '1080p5000')
		const dims = STANDARD_VIDEO_MODES[mode] || { width: 1920, height: 1080, fps: 50 }
		const modeId = mode
		const stretch = 'none'
		const windowed = config.multiview_windowed !== false && config.multiview_windowed !== 'false'
		const vsync = config.multiview_vsync !== false && config.multiview_vsync !== 'false'
		const alwaysOnTop = config.multiview_always_on_top !== false && config.multiview_always_on_top !== 'false'
		const borderless = config.multiview_borderless === true || config.multiview_borderless === 'true'
		const mvX = parseOptionalPixel(config.multiview_x, cumulativeX)
		const mvY = parseOptionalPixel(config.multiview_y, 0)
		const screenXml = [
			`<device>${nextDevice}</device>`,
			`<x>${mvX}</x><y>${mvY}</y>`,
			`<width>${dims.width}</width><height>${dims.height}</height>`,
			`<stretch>${stretch}</stretch>`,
			`<windowed>${windowed}</windowed>`,
			`<vsync>${vsync}</vsync>`,
			`<always-on-top>${alwaysOnTop}</always-on-top>`,
			`<borderless>${borderless}</borderless>`,
		].join('\n                    ')
		/** false = stream-only multiview (no &lt;screen&gt;); requires preview streaming FFmpeg consumer for WebRTC. */
		const mvScreen =
			config.multiview_screen_consumer !== false && config.multiview_screen_consumer !== 'false'

		const streamingBasePort = parseInt(String(config.streaming?.basePort || '10000'), 10) || 10000
		const mvStreamingXml = buildStreamingFfmpegConsumerXml(config, streamingBasePort + 3)
		const screenBlock = mvScreen
			? `
                <screen>
                    ${screenXml}
                </screen>`
			: ''
		if (!mvScreen && !mvStreamingXml.trim()) {
			// Avoid empty <consumers/> when stream-only but preview streaming is off — keep screen so channel is valid.
			channelsXml.push(
				`        <channel>
            <video-mode>${modeId}</video-mode>
            <consumers>
                <screen>
                    ${screenXml}
                </screen>
            </consumers>
            <mixer>
                <audio-osc>false</audio-osc>
            </mixer>
        </channel>`
			)
		} else {
			channelsXml.push(
				`        <channel>
            <video-mode>${modeId}</video-mode>
            <consumers>${screenBlock}${mvStreamingXml}
            </consumers>
            <mixer>
                <audio-osc>false</audio-osc>
            </mixer>
        </channel>`
			)
		}
	}

	if (decklinkCount > 0) {
		const mode = String(config.inputs_channel_mode || '1080p5000')
		const modeId = STANDARD_VIDEO_MODES[mode] ? mode : '1080p5000'
		channelsXml.push(
			`        <channel>
            <video-mode>${modeId}</video-mode>
            <consumers/>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
		)
	}

	for (let i = 1; i <= extraAudioCount; i++) {
		const dims = getExtraAudioModeDimensions(config, i)
		const layoutXml = channelLayoutElementXml(String(config[`extra_audio_${i}_audio_layout`] || 'default'))
		const ffmpegXml = buildExtraAudioFfmpegConsumersXml(config, i)
		const consumersBlock = ffmpegXml
			? `<consumers>${ffmpegXml}
            </consumers>`
			: `<consumers/>`
		// Same custom video-mode rules as main screens (time-scale = fps×1000, duration 1000).
		if (dims.isCustom && !customModeIds.has(dims.modeId)) {
			customModeIds.add(dims.modeId)
			const timeScale = Math.round(dims.fps * 1000)
			const cad = calculateCadence(dims.fps)
			customVideoModes.push(
				`        <video-mode>
            <id>${dims.modeId}</id>
            <width>${dims.width}</width>
            <height>${dims.height}</height>
            <time-scale>${timeScale}</time-scale>
            <duration>1000</duration>
            <cadence>${cad}</cadence>
        </video-mode>`
			)
		}
		channelsXml.push(
			`        <channel>
            <video-mode>${dims.modeId}</video-mode>${layoutXml}
            ${consumersBlock}
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
		)
	}

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
${audioSectionXml}    <channels>
${channelsXml.join('\n')}
    </channels>
${finalVideoModesXml}
${controllersXml}
${oscXml}
    <amcp><media-server><host>localhost</host><port>8000</port></media-server></amcp>
    <ndi><auto-load>${ndiAutoLoad}</auto-load></ndi>
    <decklink/>
    <html><enable-gpu>false</enable-gpu></html>
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

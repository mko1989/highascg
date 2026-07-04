'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
	parseListDevices,
	parseListFormatsExt,
	normalizeInputFormat,
	excludedReasonForName,
} = require('../../src/capture/v4l2-enumerate')
const { listConfiguredV4l2Slots, v4l2InputBridgePlayClip, buildV4l2DirectPlayUri, listV4l2PlayClipVariants } = require('../../src/capture/v4l2-input-config')
const { buildV4l2InputBridgeFfmpegArgs } = require('../../src/capture/v4l2-input-bridge')
const { validateV4l2CasparSlice } = require('../../src/capture/v4l2-input-config-validate')
const { getChannelMap } = require('../../src/config/routing-map')
const { isPassthroughAmcpClip } = require('../../src/media/caspar-cls-id')

describe('v4l2-input', () => {
	it('parseListDevices splits v4l2-ctl blocks', () => {
		const sample = `ATEM SDI Pro ISO: Blackmagic De (usb-0000:00:14.0-13):
\t/dev/video0
\t/dev/video1

CasparCG Out (platform:v4l2loopback-000):
\t/dev/video10
`
		const blocks = parseListDevices(sample)
		assert.equal(blocks.length, 2)
		assert.equal(blocks[0].paths[0], '/dev/video0')
		assert.match(blocks[1].name, /CasparCG Out/)
	})

	it('excludedReasonForName flags loopback outputs', () => {
		assert.equal(excludedReasonForName('CasparCG Out (platform:v4l2loopback-000)'), 'loopback_output')
		assert.equal(excludedReasonForName('ATEM SDI Pro ISO'), null)
	})

	it('normalizeInputFormat maps MJPG to mjpeg', () => {
		assert.equal(normalizeInputFormat('MJPG'), 'mjpeg')
	})

	it('parseListFormatsExt extracts MJPEG 1080p50', () => {
		const sample = `\t[0]: 'MJPG' (Motion-JPEG, compressed)
\t\tSize: Discrete 1920x1080
\t\t\tInterval: Discrete 0.020s (50.000 fps)
`
		const formats = parseListFormatsExt(sample)
		assert.equal(formats[0].pixelFormat, 'MJPG')
		assert.equal(formats[0].width, 1920)
		assert.deepEqual(formats[0].fps, [50])
	})

	it('channel map allocates v4l2 input channels', () => {
		const map = getChannelMap({
			screen_count: 1,
			casparServer: {
				v4l2_input_count: 2,
				v4l2_input_1_device: '/dev/video0',
				v4l2_input_2_device: '/dev/video2',
			},
		})
		assert.equal(map.v4l2InputCount, 2)
		assert.equal(map.v4l2InputChannels.length, 2)
		const v4l2Entries = map.inputChannels.filter((e) => e.kind === 'v4l2')
		assert.equal(v4l2Entries.length, 2)
		assert.equal(v4l2Entries[0].layer, 1)
		assert.match(v4l2Entries[0].route, /^route:\/\/\d+-1$/)
	})

	it('listConfiguredV4l2Slots uses direct v4l2 clip when bridge disabled', () => {
		const cfg = {
			casparServer: {
				v4l2_input_count: 2,
				v4l2_input_1_device: '/dev/video0',
				v4l2_input_2_device: '',
				v4l2_capture_bridge: false,
				v4l2_input_1_format: 'mjpeg',
				v4l2_input_1_width: 1920,
				v4l2_input_1_height: 1080,
				v4l2_input_1_fps: 50,
			},
		}
		const { count, slots } = listConfiguredV4l2Slots(cfg)
		assert.equal(count, 2)
		assert.equal(slots.length, 1)
		assert.equal(slots[0].device, '/dev/video0')
		assert.match(slots[0].clip, /^v4l2:\/\/\/dev\/video0/)
		assert.match(slots[0].clip, /-input_format mjpeg/)
	})

	it('listConfiguredV4l2Slots uses udp bridge clip when bridge enabled', () => {
		const cfg = {
			casparServer: {
				v4l2_input_count: 1,
				v4l2_input_1_device: '/dev/video0',
				v4l2_capture_bridge: true,
			},
		}
		const { slots } = listConfiguredV4l2Slots(cfg)
		assert.match(slots[0].clip, /^udp:\/\/127\.0\.0\.1:52401/)
	})

	it('buildV4l2DirectPlayUri wraps /dev paths', () => {
		assert.equal(buildV4l2DirectPlayUri('/dev/video0'), 'v4l2:///dev/video0')
	})

	it('listV4l2PlayClipVariants includes fallback without input options', () => {
		const cfg = {
			casparServer: {
				v4l2_input_1_device: '/dev/video0',
				v4l2_input_1_format: 'mjpeg',
				v4l2_input_1_width: 1920,
				v4l2_input_1_height: 1080,
				v4l2_input_1_fps: 50,
				v4l2_capture_bridge: false,
			},
		}
		const variants = listV4l2PlayClipVariants(cfg, 1)
		assert.equal(variants.length, 2)
		assert.match(variants[0], /-input_format mjpeg/)
		assert.equal(variants[1], 'v4l2:///dev/video0')
	})

	it('isPassthroughAmcpClip preserves v4l2 and udp URIs', () => {
		assert.equal(isPassthroughAmcpClip('v4l2:///dev/video0'), true)
		assert.equal(isPassthroughAmcpClip('udp://127.0.0.1:52401'), true)
	})

	it('v4l2InputBridgePlayClip uses port base 52400', () => {
		assert.match(v4l2InputBridgePlayClip(1), /52401/)
	})

	it('buildV4l2InputBridgeFfmpegArgs includes v4l2 and h264', () => {
		const cfg = { casparServer: { v4l2_input_1_format: 'mjpeg', v4l2_input_1_fps: 50, v4l2_input_1_width: 1920, v4l2_input_1_height: 1080 } }
		const args = buildV4l2InputBridgeFfmpegArgs(cfg, 1, '/dev/video0')
		assert.ok(args.includes('-f'))
		assert.ok(args.includes('v4l2'))
		assert.ok(args.includes('/dev/video0'))
		assert.ok(args.includes('libx264'))
		assert.ok(args.some((a) => String(a).includes('52401')))
	})

	it('validateV4l2CasparSlice warns on duplicate devices', () => {
		const { warnings } = validateV4l2CasparSlice({
			v4l2_input_count: 2,
			v4l2_input_1_device: '/dev/video0',
			v4l2_input_2_device: '/dev/video0',
		})
		assert.ok(warnings.some((w) => /duplicate/i.test(w)))
	})

	it('validateV4l2CasparSlice warns when v4l2 and live-audio share ALSA hw', () => {
		const { warnings } = validateV4l2CasparSlice({
			v4l2_input_count: 1,
			v4l2_input_1_device: '/dev/video0',
			v4l2_input_1_audio: 'hw:3,0',
			live_audio_input_count: 1,
			live_audio_input_1_device: 'alsa://hw:3,0',
		})
		assert.ok(warnings.some((w) => /live-audio slot 1/i.test(w)))
	})

	it('buildV4l2InputBridgeFfmpegArgs muxes ALSA when configured', () => {
		const cfg = {
			casparServer: {
				v4l2_input_1_format: 'mjpeg',
				v4l2_input_1_fps: 50,
				v4l2_input_1_audio: 'hw:3,0',
			},
		}
		const args = buildV4l2InputBridgeFfmpegArgs(cfg, 1, '/dev/video0')
		assert.ok(args.includes('-f'))
		assert.ok(args.includes('alsa'))
		assert.ok(args.includes('hw:3,0'))
	})

	it('isV4l2LayerHealthy accepts direct v4l2 ffmpeg producer', () => {
		const { isV4l2LayerHealthy } = require('../../src/capture/v4l2-input-health')
		const xml =
			'<foreground><file><name>v4l2:///dev/video0</name><time>2.5</time></file><producer>ffmpeg</producer></foreground>'
		assert.equal(isV4l2LayerHealthy(xml), true)
	})

	it('isV4l2LayerHealthy accepts Caspar producer>ffmpeg INFO for udp bridge', () => {
		const { isV4l2LayerHealthy } = require('../../src/capture/v4l2-input-health')
		const xml =
			'<foreground><file><name>udp://127.0.0.1:52401</name><time>2.5</time></file><producer>ffmpeg</producer></foreground>'
		assert.equal(isV4l2LayerHealthy(xml), true)
	})
})

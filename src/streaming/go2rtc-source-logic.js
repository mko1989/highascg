/**
 * Logic for building go2rtc ffmpeg sources.
 */
'use strict'

const { resolveNdiSourceName } = require('./ndi-resolve')
const { SCALE_HALF_VF, detectLocalCaptureDevice } = require('./go2rtc-config')

const RES_MAP = { '720p': '1280:720', '540p': '960:540', '360p': '640:360' }

function getScaleFilter(resolution) {
	if (resolution === 'half') return `-vf ${SCALE_HALF_VF}`
	if (RES_MAP[resolution]) return `-vf scale=${RES_MAP[resolution]}`
	return ''
}

function buildLocalSource(config) {
	const dev = detectLocalCaptureDevice(config); const br = config.maxBitrate || 2000; const fps = config.fps || 25
	const enc = config.hardwareAccel !== false ? 'h264_nvenc -preset p1 -tune ll' : 'libx264 -preset ultrafast -tune zerolatency'
	const scale = getScaleFilter(config.resolution)
	if (dev === 'kmsgrab') {
		const drm = config.drmDevice || process.env.HIGHASCG_DRM_DEVICE || '/dev/dri/card0'
		return `exec:ffmpeg -device ${drm} -framerate ${fps} -f kmsgrab -i - ${scale} -c:v ${enc} -b:v ${br}k -g ${fps * 2} -f rtsp {output}`
	}
	const disp = config.x11Display || process.env.HIGHASCG_X11_DISPLAY || ':0'
	return `exec:env DISPLAY=${disp} ffmpeg -f x11grab -framerate ${fps} -video_size 1920x1080 -i :0.0 ${scale} -c:v ${enc} -b:v ${br}k -g ${fps * 2} -f rtsp {output}`
}

function buildNdiSource(config, channelNum) {
	const name = resolveNdiSourceName(config, channelNum); const br = config.maxBitrate || 2000; const fps = config.fps || 25
	const enc = config.hardwareAccel !== false ? 'h264_nvenc -preset p1 -tune ll' : 'libx264 -preset ultrafast -tune zerolatency'
	const scale = getScaleFilter(config.resolution)
	return `exec:ffmpeg -f libndi_newtek_input -i "${name}" ${scale} -c:v ${enc} -b:v ${br}k -g ${fps * 2} -c:a aac -b:a 64k -f rtsp {output}`
}

module.exports = { buildLocalSource, buildNdiSource }

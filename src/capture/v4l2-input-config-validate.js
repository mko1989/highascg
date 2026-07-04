'use strict'

const { getChannelMap, readCasparSetting } = require('../config/routing-map')
const { parseAlsaHwIdentity } = require('../config/live-audio-input')
const { normalizeV4l2DevicePath, resolveV4l2InputAudio } = require('./v4l2-input-config')

/**
 * @param {string} raw
 * @returns {string|null}
 */
function parseV4l2AlsaHwIdentity(raw) {
	const s = String(raw || '').trim()
	if (!s || s === 'none') return null
	return parseAlsaHwIdentity(s.replace(/^alsa:/i, 'alsa://'))
}

/**
 * @param {Record<string, unknown>} casparServerSlice
 * @returns {{ warnings: string[] }}
 */
function validateV4l2CasparSlice(casparServerSlice) {
	const warnings = []
	const cs = casparServerSlice && typeof casparServerSlice === 'object' ? casparServerSlice : {}
	const map = getChannelMap({ casparServer: cs })
	const count = map.v4l2InputCount ?? 0
	if (count <= 0) return { warnings }

	const usedVideo = new Map()
	const usedAlsa = new Map()
	for (let i = 1; i <= count; i++) {
		const dev = normalizeV4l2DevicePath(readCasparSetting({ casparServer: cs }, `v4l2_input_${i}_device`))
		if (dev) {
			if (usedVideo.has(dev)) {
				warnings.push(`V4L2 input slots ${usedVideo.get(dev)} and ${i} both use device ${dev} — duplicate will be skipped at startup.`)
			} else {
				usedVideo.set(dev, i)
			}
		}

		const audioRaw = resolveV4l2InputAudio({ casparServer: cs }, i)
		const alsaId = parseV4l2AlsaHwIdentity(audioRaw)
		if (alsaId) {
			if (usedAlsa.has(alsaId)) {
				warnings.push(`V4L2 slots ${usedAlsa.get(alsaId)} and ${i} both mux ALSA hw:${alsaId} — only one FFmpeg bridge can capture that device.`)
			} else {
				usedAlsa.set(alsaId, i)
			}
		}
	}

	const liveAudioCount = Math.min(8, Math.max(0, parseInt(String(cs.live_audio_input_count ?? 0), 10) || 0))
	for (let j = 1; j <= liveAudioCount; j++) {
		const liveDev = readCasparSetting({ casparServer: cs }, `live_audio_input_${j}_device`)
		const liveAlsaId = parseAlsaHwIdentity(liveDev)
		if (!liveAlsaId) continue
		if (usedAlsa.has(liveAlsaId)) {
			warnings.push(
				`V4L2 slot ${usedAlsa.get(liveAlsaId)} and live-audio slot ${j} both use ALSA hw:${liveAlsaId} — use video-only on one side or a different card.`,
			)
		}
	}

	return { warnings }
}

module.exports = { validateV4l2CasparSlice, parseV4l2AlsaHwIdentity }

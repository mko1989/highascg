'use strict'

const fs = require('fs')
const path = require('path')
const { execFile, execFileSync } = require('child_process')
const { promisify } = require('util')
const { normalizeVirtualCameraConfig } = require('./v4l2-bridge-config')
const { resolveAlsaLoopbackConfig, alsaLoopbackCardPresent } = require('./v4l2-bridge-audio-sink')

const execFileAsync = promisify(execFile)

const MODPROBE_BINS = ['modprobe', '/sbin/modprobe', '/usr/sbin/modprobe']
const SUDO_BINS = ['sudo', '/usr/bin/sudo']
const VCAM_MODULES_WRAPPER = '/usr/local/lib/highascg/highascg-vcam-modules-up.sh'
const VCAM_CONF_PATH = '/run/highascg/vcam-modules.conf'

/**
 * @param {string[]} bins
 * @param {string[]} args
 */
async function execFirst(bins, args) {
	let lastErr
	for (const bin of bins) {
		try {
			return await execFileAsync(bin, args, { timeout: 12000, maxBuffer: 256 * 1024 })
		} catch (e) {
			lastErr = e
		}
	}
	throw lastErr || new Error(`none of ${bins.join(', ')} available`)
}

/**
 * @param {object} config
 * @returns {{ videoNr: number, cardLabel: string, device: string }}
 */
function resolveV4l2LoopbackConfig(config) {
	const vc = normalizeVirtualCameraConfig(config?.virtualCamera)
	const device = vc.device
	const videoNr = parseInt(String(device).replace('/dev/video', ''), 10)
	const cardLabel = String(vc.label || 'CasparCG Out').slice(0, 64)
	return {
		videoNr: Number.isFinite(videoNr) ? videoNr : 10,
		cardLabel,
		device,
	}
}

/**
 * @param {number} videoNr
 * @returns {boolean}
 */
function v4l2DevicePresent(videoNr) {
	try {
		return fs.existsSync(`/dev/video${videoNr}`)
	} catch {
		return false
	}
}

/**
 * @param {string} value
 */
function shellConfQuote(value) {
	return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * @param {object} config
 */
function writeVcamModulesConf(config) {
	const vc = normalizeVirtualCameraConfig(config?.virtualCamera)
	const { videoNr, cardLabel } = resolveV4l2LoopbackConfig(config)
	const alsa = resolveAlsaLoopbackConfig(config)
	const dir = path.dirname(VCAM_CONF_PATH)
	fs.mkdirSync(dir, { recursive: true })
	const body = [
		`VIDEO_NR=${videoNr}`,
		`CARD_LABEL=${shellConfQuote(cardLabel)}`,
		`ALSA_INDEX=${alsa.cardIndex}`,
		`ALSA_ID=${alsa.configuredCardId}`,
		`ALSA_PCM=${alsa.pcmDevices}`,
		`AUDIO_ENABLED=${vc.audioEnabled ? 1 : 0}`,
		'',
	].join('\n')
	fs.writeFileSync(VCAM_CONF_PATH, body, { mode: 0o644 })
}

/**
 * @param {object} ctx
 * @param {object} config
 */
async function ensureVcamKernelModules(ctx, config) {
	const vc = normalizeVirtualCameraConfig(config?.virtualCamera)
	const { videoNr, device } = resolveV4l2LoopbackConfig(config)
	const alsa = resolveAlsaLoopbackConfig(config)
	const needVideo = !v4l2DevicePresent(videoNr)
	const needAudio = vc.audioEnabled && !alsaLoopbackCardPresent(alsa.cardId)

	if (!needVideo && !needAudio) {
		return { ok: true, device, videoNr }
	}

	writeVcamModulesConf(config)

	try {
		await execFirst(SUDO_BINS, ['-n', VCAM_MODULES_WRAPPER])
		ctx?.log?.('info', `[v4l2-bridge] kernel modules loaded via ${VCAM_MODULES_WRAPPER}`)
	} catch (e) {
		ctx?.log?.('debug', `[v4l2-bridge] sudo wrapper failed: ${e?.message || e}`)
		if (needVideo) {
			try {
				await execFirst(MODPROBE_BINS, [
					'v4l2loopback',
					'devices=1',
					`video_nr=${videoNr}`,
					`card_label=${resolveV4l2LoopbackConfig(config).cardLabel}`,
				])
			} catch (e2) {
				ctx?.log?.('warn', `[v4l2-bridge] v4l2loopback modprobe failed: ${e2?.message || e2}`)
			}
		}
		if (needAudio) {
			try {
				await execFirst(MODPROBE_BINS, [
					'snd-aloop',
					'enable=1',
					`index=${alsa.cardIndex}`,
					`id=${alsa.cardId}`,
					`pcm=${alsa.pcmDevices}`,
				])
			} catch (e2) {
				ctx?.log?.('warn', `[v4l2-bridge] snd-aloop modprobe failed: ${e2?.message || e2}`)
			}
		}
	}

	await new Promise((r) => setTimeout(r, 200))

	if (!v4l2DevicePresent(videoNr)) {
		return {
			ok: false,
			lastError: `${device} not present — run: sudo bash scripts/setup/12-passwordless-sudo.sh && sudo ${VCAM_MODULES_WRAPPER}`,
		}
	}

	if (vc.audioEnabled && !alsaLoopbackCardPresent(alsa.cardId)) {
		return {
			ok: false,
			lastError: `ALSA loopback ${alsa.cardId} not loaded — see ${VCAM_MODULES_WRAPPER}`,
		}
	}

	return { ok: true, device, videoNr }
}

module.exports = {
	VCAM_CONF_PATH,
	VCAM_MODULES_WRAPPER,
	resolveV4l2LoopbackConfig,
	v4l2DevicePresent,
	writeVcamModulesConf,
	ensureVcamKernelModules,
}

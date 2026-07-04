'use strict'

const fs = require('fs')
const { execFile, execFileSync } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const APLAY_BINS = ['aplay', '/usr/bin/aplay']
const MODPROBE_BINS = ['modprobe', '/sbin/modprobe', '/usr/sbin/modprobe']

/** @type {{ cardId: string | null }} */
let _sinkState = { cardId: null }

/**
 * @param {string[]} bins
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function execFirst(bins, args) {
	let lastErr
	for (const bin of bins) {
		try {
			return await execFileAsync(bin, args, {
				timeout: 8000,
				maxBuffer: 512 * 1024,
			})
		} catch (e) {
			lastErr = e
		}
	}
	throw lastErr || new Error(`none of ${bins.join(', ')} available`)
}

/**
 * @returns {string|null}
 */
function execAplaySync(args) {
	for (const bin of APLAY_BINS) {
		try {
			return execFileSync(bin, args, {
				encoding: 'utf8',
				timeout: 5000,
				stdio: ['ignore', 'pipe', 'pipe'],
			})
		} catch {
			/* next */
		}
	}
	return null
}

/**
 * snd-aloop strips underscores from id= — use the effective id for device paths and detection.
 * @param {string} cardId
 */
function effectiveAlsaCardId(cardId) {
	return String(cardId || '')
		.replace(/_/g, '')
		.trim()
}

/**
 * @param {string} cardId
 * @returns {boolean}
 */
function alsaLoopbackCardPresent(cardId) {
	const want = effectiveAlsaCardId(cardId)
	if (!want) return false

	try {
		const text = fs.readFileSync('/proc/asound/cards', 'utf8')
		for (const line of text.split('\n')) {
			const m = line.match(/^\s*\d+\s+\[([^\]]+)\]/)
			if (m && effectiveAlsaCardId(m[1]) === want) return true
		}
	} catch {
		/* fall through */
	}

	const text = execAplaySync(['-l'])
	if (!text) return false
	for (const line of text.split('\n')) {
		const m = line.match(/^card\s+\d+:\s+(\S+)/)
		if (m && effectiveAlsaCardId(m[1]) === want) return true
	}
	return false
}

/**
 * @param {object} config
 * @returns {{ cardId: string, configuredCardId: string, cardIndex: number, pcmDevices: number, playbackDevice: string, captureDevice: string }}
 */
function resolveAlsaLoopbackConfig(config) {
	const vc = config?.virtualCamera || {}
	const configuredCardId = String(vc.alsaLoopbackCardId || 'HighAsCG_VCam').trim() || 'HighAsCG_VCam'
	const cardId = effectiveAlsaCardId(configuredCardId)
	const cardIndex = Math.max(0, parseInt(String(vc.alsaLoopbackIndex ?? 20), 10) || 20)
	const pcmDevices = Math.max(2, parseInt(String(vc.alsaLoopbackPcm ?? 2), 10) || 2)
	return {
		cardId,
		configuredCardId,
		cardIndex,
		pcmDevices,
		playbackDevice: `plughw:${cardId},0,0`,
		captureDevice: `hw:${cardId},1,0`,
	}
}

/**
 * Ensure snd-aloop card exists for Caspar → virtual mic (ALSA/PortAudio capture side).
 * @param {object} ctx
 * @param {object} config
 */
async function ensureAlsaLoopback(ctx, config) {
	const { cardId, cardIndex, pcmDevices, playbackDevice, captureDevice } = resolveAlsaLoopbackConfig(config)

	if (alsaLoopbackCardPresent(cardId)) {
		ctx?.log?.('debug', `[v4l2-bridge] ALSA loopback ${cardId} already present`)
		_sinkState = { cardId }
		return {
			ok: true,
			casparPath: `-f alsa ${playbackDevice}`,
			captureDevice,
			captureHint: `${cardId} (ALSA capture device 1)`,
		}
	}

	try {
		await execFirst(MODPROBE_BINS, [
			'snd-aloop',
			'enable=1',
			`index=${cardIndex}`,
			`id=${cardId}`,
			`pcm=${pcmDevices}`,
		])
		await new Promise((r) => setTimeout(r, 200))
		if (alsaLoopbackCardPresent(cardId)) {
			ctx?.log?.('info', `[v4l2-bridge] ALSA loopback ${cardId} loaded (index ${cardIndex})`)
			_sinkState = { cardId }
			return {
				ok: true,
				casparPath: `-f alsa ${playbackDevice}`,
				captureDevice,
				captureHint: `${cardId} (ALSA capture device 1)`,
			}
		}
	} catch (e) {
		ctx?.log?.('warn', `[v4l2-bridge] modprobe snd-aloop failed: ${e?.message || e}`)
	}

	return {
		ok: false,
		lastError: `ALSA loopback ${cardId} not loaded — run: sudo modprobe snd-aloop enable=1 index=${cardIndex} id=${cardId} pcm=${pcmDevices}`,
	}
}

async function releaseAlsaLoopback() {
	_sinkState = { cardId: null }
}

function resetAlsaLoopbackState() {
	_sinkState = { cardId: null }
}

function getAlsaLoopbackCardId() {
	return _sinkState.cardId
}

module.exports = {
	effectiveAlsaCardId,
	resolveAlsaLoopbackConfig,
	ensureAlsaLoopback,
	releaseAlsaLoopback,
	resetAlsaLoopbackState,
	getAlsaLoopbackCardId,
	alsaLoopbackCardPresent,
}

'use strict'

const { getDisplaysXrandrDetailed } = require('./hardware-info')

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function parsePositiveInt(name, fallback) {
	const n = parseInt(process.env[name] || '', 10)
	return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Poll until :0 reports connected outputs and has been stable for settleMs.
 * @param {{ settleMs?: number, pollMs?: number, maxAttempts?: number, log?: (level: string, msg: string) => void }} [opts]
 * @returns {Promise<{ ok: boolean, displays?: number, reason?: string }>}
 */
async function waitForDisplayStable(opts = {}) {
	const settleMs = opts.settleMs ?? parsePositiveInt('HIGHASCG_OS_LAYOUT_SETTLE_MS', 1500)
	const pollMs = opts.pollMs ?? parsePositiveInt('HIGHASCG_OS_LAYOUT_POLL_MS', 400)
	const maxAttempts = opts.maxAttempts ?? parsePositiveInt('HIGHASCG_OS_LAYOUT_MAX_ATTEMPTS', 46)
	const log = typeof opts.log === 'function' ? opts.log : () => {}

	let attempts = 0
	let firstSeenAt = 0

	while (attempts < maxAttempts) {
		attempts += 1
		const xr = getDisplaysXrandrDetailed()
		const count = Array.isArray(xr?.displays) ? xr.displays.length : 0
		if (count > 0) {
			if (!firstSeenAt) {
				firstSeenAt = Date.now()
				log('info', `[Display] Xrandr ready (${count} connected); waiting ${settleMs}ms settle`)
			}
			if (Date.now() - firstSeenAt >= settleMs) {
				return { ok: true, displays: count }
			}
		} else {
			firstSeenAt = 0
		}
		await sleep(pollMs)
	}

	return { ok: false, reason: 'timeout', displays: 0 }
}

module.exports = { waitForDisplayStable }

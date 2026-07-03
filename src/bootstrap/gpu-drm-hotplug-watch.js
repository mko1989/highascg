'use strict'

const fs = require('fs')
const path = require('path')

const POLL_MS = Math.max(1000, parseInt(process.env.HIGHASCG_GPU_HOTPLUG_POLL_MS || '2000', 10) || 2000)
const SUBSCRIBER_TTL_MS = Math.max(
	10_000,
	parseInt(process.env.HIGHASCG_GPU_HOTPLUG_TTL_MS || '60000', 10) || 60_000,
)

let subscriberCount = 0
let lastTouchAt = 0
/** @type {NodeJS.Timeout | null} */
let pollTimer = null
/** @type {Map<string, string>} */
let lastStatuses = new Map()

function readConnectorStatuses() {
	const drmPath = '/sys/class/drm'
	/** @type {Map<string, string>} */
	const out = new Map()
	if (!fs.existsSync(drmPath)) return out
	for (const ent of fs.readdirSync(drmPath)) {
		if (!/^card\d+-(DP|HDMI|DVI|VGA|eDP)-\d+$/i.test(ent)) continue
		let status = 'unknown'
		try {
			status = fs.readFileSync(path.join(drmPath, ent, 'status'), 'utf8').trim()
		} catch {
			/* optional */
		}
		out.set(ent, status)
	}
	return out
}

function statusesChanged(prev, next) {
	if (prev.size !== next.size) return true
	for (const [k, v] of next) {
		if (prev.get(k) !== v) return true
	}
	return false
}

function stopPollIfIdle() {
	if (subscriberCount > 0) return
	if (pollTimer) {
		clearInterval(pollTimer)
		pollTimer = null
	}
	lastStatuses = new Map()
}

function ensurePoll(ctx) {
	if (pollTimer) return
	lastStatuses = readConnectorStatuses()
	pollTimer = setInterval(() => {
		if (subscriberCount <= 0 && Date.now() - lastTouchAt > SUBSCRIBER_TTL_MS) {
			stopPollIfIdle()
			return
		}
		const next = readConnectorStatuses()
		if (!statusesChanged(lastStatuses, next)) return
		lastStatuses = next
		try {
			const { invalidateXrandrCache } = require('../utils/hardware-info')
			invalidateXrandrCache()
		} catch {
			/* optional */
		}
		if (typeof ctx._wsBroadcast === 'function') {
			ctx._wsBroadcast('gpu_topology_changed', { at: Date.now() })
		}
	}, POLL_MS)
	if (typeof pollTimer.unref === 'function') pollTimer.unref()
}

/**
 * Keep DRM status polling alive while Device View is open.
 * @param {object} ctx
 */
function touchDeviceViewGpuWatch(ctx) {
	lastTouchAt = Date.now()
	subscriberCount = Math.max(subscriberCount, 1)
	ensurePoll(ctx)
}

function subscribeDeviceViewGpuWatch(ctx) {
	subscriberCount++
	lastTouchAt = Date.now()
	ensurePoll(ctx)
}

function unsubscribeDeviceViewGpuWatch() {
	subscriberCount = Math.max(0, subscriberCount - 1)
	if (subscriberCount <= 0 && Date.now() - lastTouchAt > SUBSCRIBER_TTL_MS) {
		stopPollIfIdle()
	}
}

module.exports = {
	touchDeviceViewGpuWatch,
	subscribeDeviceViewGpuWatch,
	unsubscribeDeviceViewGpuWatch,
}

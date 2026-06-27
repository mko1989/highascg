'use strict'

/** @typedef {{ dirty: boolean, generation: number, lastCaptureAt: number, lastHash: string | null, inFlight: boolean, lastReason?: string }} ChannelPreviewState */

/** @type {Map<number, ChannelPreviewState>} */
const _channels = new Map()

/** @type {Map<number, NodeJS.Timeout>} */
const _coalesceTimers = new Map()

const COALESCE_MS = 50

/**
 * @param {number|string} channel
 * @returns {ChannelPreviewState | null}
 */
function _state(channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return null
	if (!_channels.has(ch)) {
		_channels.set(ch, {
			dirty: false,
			generation: 0,
			lastCaptureAt: 0,
			lastHash: null,
			inFlight: false,
		})
	}
	return _channels.get(ch)
}

/**
 * @param {number|string} channel
 * @param {string} [reason]
 */
function bumpDirty(channel, reason) {
	const st = _state(channel)
	if (!st) return
	if (st.inFlight) {
		st.dirty = true
		if (reason) st.lastReason = reason
		return
	}
	const ch = parseInt(String(channel), 10)
	if (_coalesceTimers.has(ch)) {
		st.dirty = true
		if (reason) st.lastReason = reason
		return
	}
	st.dirty = true
	st.generation += 1
	if (reason) st.lastReason = reason
	_coalesceTimers.set(
		ch,
		setTimeout(() => {
			_coalesceTimers.delete(ch)
		}, COALESCE_MS),
	)
}

/**
 * @param {number|string} channel
 * @param {{ minIntervalMs?: number }} [opts]
 */
function shouldCapture(channel, opts = {}) {
	const st = _state(channel)
	if (!st || !st.dirty || st.inFlight) return false
	const minInterval = Math.max(0, opts.minIntervalMs ?? 0)
	if (minInterval > 0 && Date.now() - st.lastCaptureAt < minInterval) return false
	return true
}

/**
 * @param {number|string} channel
 */
function markCaptureStart(channel) {
	const st = _state(channel)
	if (!st) return
	st.inFlight = true
}

/**
 * @param {number|string} channel
 * @param {string | null | undefined} [hash]
 */
function clearDirty(channel, hash) {
	const st = _state(channel)
	if (!st) return
	st.dirty = false
	st.inFlight = false
	st.lastCaptureAt = Date.now()
	if (hash != null) st.lastHash = hash
}

/**
 * @param {number|string} channel
 * @param {string} [error]
 */
function markCaptureFailed(channel, error) {
	const st = _state(channel)
	if (!st) return
	st.inFlight = false
	if (error) st.lastReason = error
}

/**
 * @param {number|string} channel
 */
function isDirty(channel) {
	const st = _state(channel)
	return !!st?.dirty
}

/**
 * @param {Iterable<number>} channels
 */
function forceAllDirty(channels) {
	for (const ch of channels) bumpDirty(ch, 'manual.refresh')
}

function reset() {
	for (const t of _coalesceTimers.values()) clearTimeout(t)
	_coalesceTimers.clear()
	_channels.clear()
}

function getStats() {
	let dirty = 0
	let inFlight = 0
	for (const st of _channels.values()) {
		if (st.dirty) dirty += 1
		if (st.inFlight) inFlight += 1
	}
	return { tracked: _channels.size, dirty, inFlight }
}

function getLastHash(channel) {
	const st = _state(channel)
	return st?.lastHash ?? null
}

module.exports = {
	bumpDirty,
	shouldCapture,
	markCaptureStart,
	clearDirty,
	markCaptureFailed,
	isDirty,
	getLastHash,
	forceAllDirty,
	reset,
	getStats,
}

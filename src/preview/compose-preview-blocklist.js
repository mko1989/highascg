'use strict'

/**
 * Compose-preview channel blocklist (WO-144).
 *
 * Some Caspar channels reject `ADD <ch>-701 FILE …` with a client error (400/401/403 —
 * e.g. not FILE-consumable or config mismatch). Retrying forever spams AMCP and the
 * caspar log; instead the first rejection blocklists the channel until either the
 * channel's desired consumer signature changes (config change affecting that channel)
 * or the service restarts (state is in-memory only).
 */

/** @type {Map<number, { reason: string, signature: string, at: number }>} */
const _blocklist = new Map()

/**
 * AMCP client-error responses that are deterministic for a given channel + params
 * (retrying without a config change cannot succeed). 5xx / timeouts / disconnects
 * stay retryable.
 */
const PERMANENT_ADD_REJECTION_RE =
	/^\s*40[0-4]\b|\b40[0-4]\s+ERROR\b|COMMAND_UNKNOWN|INVALID_CHANNEL|PARAMETER_MISSING|PARAMETER_ILLEGAL/i

/**
 * True when an ADD failure message indicates a permanent (blocklist-worthy) rejection.
 * @param {string} message
 * @returns {boolean}
 */
function isPermanentAddRejection(message) {
	const msg = String(message || '')
	if (!msg) return false
	return PERMANENT_ADD_REJECTION_RE.test(msg)
}

/**
 * @param {number} channel
 * @param {{ reason?: string, signature?: string }} [info]
 * @returns {boolean} true when the channel was newly blocklisted
 */
function blocklistComposeChannel(channel, info = {}) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return false
	const wasBlocked = _blocklist.has(ch)
	_blocklist.set(ch, {
		reason: String(info.reason || 'ADD rejected'),
		signature: String(info.signature || ''),
		at: Date.now(),
	})
	return !wasBlocked
}

/**
 * Blocked only while the desired signature matches the one that was rejected —
 * a config change affecting the channel re-arms a single probe.
 * @param {number} channel
 * @param {string} [signature] — current desired consumer signature for the channel
 * @returns {boolean}
 */
function isComposeChannelBlocklisted(channel, signature) {
	const entry = _blocklist.get(parseInt(String(channel), 10))
	if (!entry) return false
	if (signature === undefined) return true
	return entry.signature === String(signature)
}

/**
 * @param {number} channel
 * @returns {{ reason: string, signature: string, at: number } | null}
 */
function getComposeBlocklistEntry(channel) {
	return _blocklist.get(parseInt(String(channel), 10)) || null
}

/**
 * @param {number} channel
 * @returns {boolean} true when an entry was removed
 */
function clearComposeChannelBlocklist(channel) {
	return _blocklist.delete(parseInt(String(channel), 10))
}

/** @returns {number[]} */
function getComposeBlocklistedChannels() {
	return [..._blocklist.keys()].sort((a, b) => a - b)
}

/** Status payload for `/api/compose-preview/stats` + UI. */
function getComposeBlocklistStats() {
	const byChannel = {}
	for (const [ch, entry] of _blocklist) {
		byChannel[ch] = { reason: entry.reason, at: entry.at }
	}
	return { channels: getComposeBlocklistedChannels(), byChannel }
}

function resetComposeBlocklist() {
	_blocklist.clear()
}

/**
 * Clear the entire blocklist on Caspar (re)connect (WO-159 T159.3 follow-up).
 *
 * A "channel doesn't exist" 400 is only valid for the lifetime of the Caspar instance
 * that produced it. WO-159's live-box investigation found the ADD FILE 400s on ch2/3/5/6
 * were a Caspar-restart race — the app probed channels before they existed in the
 * just-started instance — but the WO-144 blocklist is keyed on (channel, ADD-params
 * signature) and never re-probes on its own, so a transient startup race became
 * permanent for the rest of the process lifetime. Since every reconnect is potentially
 * a *different* Caspar instance (restart, config reload, crash recovery), the blocklist
 * must not survive across the connection edge — callers should invoke this before the
 * compose-preview consumer re-sync so the fresh instance gets a fresh probe.
 * @param {object} [ctx] — passed through to the WS broadcast + logger; safe to omit.
 * @returns {number[]} channels that were cleared (empty when nothing was blocklisted)
 */
function resetComposeBlocklistOnReconnect(ctx) {
	const channels = getComposeBlocklistedChannels()
	if (channels.length) {
		resetComposeBlocklist()
		for (const ch of channels) broadcastComposeBlocklistChange(ctx, ch, false)
	}
	ctx?.log?.(
		'info',
		channels.length
			? `[compose-preview] blocklist cleared on Caspar reconnect (ch ${channels.join(',')} will be reprobed)`
			: '[compose-preview] Caspar reconnected — blocklist already empty, nothing to reprobe',
	)
	return channels
}

/**
 * Push blocklist change to the webUI (same `compose.preview` WS event the frame
 * push uses — payload is disambiguated by the `blocklisted` field).
 * @param {object} ctx
 * @param {number} channel
 * @param {boolean} blocklisted
 * @param {string} [reason]
 */
function broadcastComposeBlocklistChange(ctx, channel, blocklisted, reason) {
	if (typeof ctx?._wsBroadcast !== 'function') return
	ctx._wsBroadcast('compose.preview', {
		channel: parseInt(String(channel), 10),
		blocklisted: !!blocklisted,
		reason: blocklisted ? String(reason || 'ADD rejected') : null,
		blocklistedChannels: getComposeBlocklistedChannels(),
	})
}

module.exports = {
	isPermanentAddRejection,
	blocklistComposeChannel,
	isComposeChannelBlocklisted,
	getComposeBlocklistEntry,
	clearComposeChannelBlocklist,
	getComposeBlocklistedChannels,
	getComposeBlocklistStats,
	resetComposeBlocklist,
	resetComposeBlocklistOnReconnect,
	broadcastComposeBlocklistChange,
}

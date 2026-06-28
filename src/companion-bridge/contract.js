'use strict'

/**
 * HighAsCG ↔ companion-module-highpass-highascg bridge contract.
 * Keep in sync with companion-module-highpass-highascg/src/bridge/contract.js
 */

/** @typedef {'tl' | 'tr' | 'bl' | 'br'} ComposePreviewQuadrant */

const MODULE_ID = 'highpass-highascg'

const WS = {
	COMPANION_HELLO: 'companion.hello',
	VARIABLE_UPDATE: 'variable_update',
	COMPOSE_PREVIEW: 'compose.preview',
	STATE: 'state',
}

const PREVIEW = {
	/** Unprefixed server variable keys (Companion adds highascg_ prefix). */
	COMPOSE_IMAGE_RE: /^compose_preview_ch(\d+)_image$/,
	COMPOSE_QUAD_RE: /^compose_preview_ch(\d+)_quad_(tl|tr|bl|br)$/,
	LOOK_AIR_FRAME_RE: /^look_air_frame_[a-zA-Z0-9_-]+$/,
}

/**
 * @param {string} lookId
 * @returns {string}
 */
function lookIdSlug(lookId) {
	return String(lookId ?? '')
		.trim()
		.replace(/[^a-zA-Z0-9_-]/g, '_')
		.slice(0, 64)
}

/**
 * Server-side variable key for full-frame compose preview on a channel.
 * @param {number} channel
 * @returns {string}
 */
function composePreviewImageKey(channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	return `compose_preview_ch${ch}_image`
}

/**
 * Server-side variable key for a compose preview quadrant.
 * @param {number} channel
 * @param {ComposePreviewQuadrant} quadrant
 * @returns {string}
 */
function composePreviewQuadrantKey(channel, quadrant) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	return `compose_preview_ch${ch}_quad_${quadrant}`
}

/**
 * Server-side variable key for per-look on-air still (Stream Deck look buttons).
 * @param {string} lookId
 * @returns {string}
 */
function lookAirFrameKey(lookId) {
	return `look_air_frame_${lookIdSlug(lookId) || 'unknown'}`
}

/**
 * Companion-prefixed variable id (module surface).
 * @param {string} serverKey
 * @returns {string}
 */
function companionVariableId(serverKey) {
	return `highascg_${String(serverKey ?? '')}`
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isComposePreviewServerKey(key) {
	const k = String(key)
	return (
		PREVIEW.COMPOSE_IMAGE_RE.test(k) ||
		PREVIEW.COMPOSE_QUAD_RE.test(k) ||
		PREVIEW.LOOK_AIR_FRAME_RE.test(k)
	)
}

/**
 * Normalize hello preview capabilities from a Companion client.
 * @param {object} [preview]
 * @returns {{ enabled: boolean, channels: number[], quadrants: boolean, lookAirFrames: boolean }}
 */
function normalizeHelloPreview(preview) {
	const p = preview && typeof preview === 'object' ? preview : {}
	const enabled = p.enabled !== false
	/** @type {number[]} */
	const channels = []
	if (Array.isArray(p.channels)) {
		for (const raw of p.channels) {
			const ch = parseInt(String(raw), 10)
			if (Number.isFinite(ch) && ch > 0) channels.push(ch)
		}
	}
	return {
		enabled,
		channels: [...new Set(channels)].sort((a, b) => a - b),
		quadrants: p.quadrants === true,
		lookAirFrames: p.lookAirFrames !== false,
	}
}

module.exports = {
	MODULE_ID,
	WS,
	PREVIEW,
	lookIdSlug,
	composePreviewImageKey,
	composePreviewQuadrantKey,
	lookAirFrameKey,
	companionVariableId,
	isComposePreviewServerKey,
	normalizeHelloPreview,
}

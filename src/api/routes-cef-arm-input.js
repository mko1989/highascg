/**
 * routes-cef-arm-input.js — Operator-facing "Arm input" toggle for interactive browser/template layers.
 *
 * Endpoints (under /api/cef):
 *
 *   POST /api/cef/arm-input   — { channel, layer, needle } — register a CEF focus target
 *   POST /api/cef/release-input — release the CEF focus target
 *
 * WO-232 T232.6: Allow operators to arm input forwarding for mario/cef_input_test templates
 * without the full live-webpage workflow. Arm calls setCefFocusTarget with a layer-scoped
 * sourceId and notifies listeners. Release clears the target.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { setCefFocusTarget, clearCefFocusTarget } = require('../system/cef-focus-registry')
const { notifyCefFocusChanged } = require('../system/cef-interactive-bridge')

/**
 * @param {string} path
 * @param {string|object} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	if (path === '/api/cef/arm-input') {
		const j = parseBody(body) || {}
		const channel = parseInt(j.channel, 10)
		const layer = parseInt(j.layer, 10)
		const needle = String(j.needle || '').trim()

		if (!Number.isFinite(channel) || channel <= 0) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: 'channel must be a positive number' }),
			}
		}
		if (!Number.isFinite(layer) || layer <= 0) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: 'layer must be a positive number' }),
			}
		}
		if (!needle) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: 'needle is required' }),
			}
		}

		const target = {
			sourceId: `layer:${channel}-${layer}`,
			hostChannel: channel,
			hostLayer: layer,
			needle,
			zoneId: 'layer',
		}

		setCefFocusTarget(target)
		notifyCefFocusChanged(typeof ctx.log === 'function' ? (level, msg) => ctx.log(level, msg) : undefined)
		// Self-heal (2026-07-16): arming must (re)start the X11 capture bridge — notify alone only
		// syncs an already-running one. Idempotent when running.
		try {
			const { syncCefInteractiveBridge } = require('../system/cef-interactive-bridge')
			void syncCefInteractiveBridge(ctx.config, {
				log: typeof ctx.log === 'function' ? (level, msg) => ctx.log(level, msg) : undefined,
				amcp: ctx.amcp,
			})
		} catch (_) {
			/* bridge module unavailable — key/mouse forwarding will need a manual bridge sync */
		}

		if (typeof ctx._wsBroadcast === 'function') {
			ctx._wsBroadcast('change', { path: 'cefFocusTarget', value: target })
		}

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				message: `Armed input for ${needle} on ch ${channel} layer ${layer}`,
				cefFocusTarget: target,
			}),
		}
	}

	if (path === '/api/cef/release-input') {
		clearCefFocusTarget()
		// WO-243 follow-up: the operator GUI (when configured) is the DEFAULT input sink — releasing
		// a manual arm (mario / live-webpage) falls back to it instead of leaving the box mouseless.
		let fallback = null
		try {
			const { ensureOperatorGuiFocus } = require('../system/operator-gui-channel')
			fallback = ensureOperatorGuiFocus(ctx)
		} catch (_) {
			fallback = null
		}
		if (!fallback) {
			notifyCefFocusChanged(typeof ctx.log === 'function' ? (level, msg) => ctx.log(level, msg) : undefined)
		}

		if (typeof ctx._wsBroadcast === 'function') {
			ctx._wsBroadcast('change', { path: 'cefFocusTarget', value: fallback })
		}

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				message: fallback ? 'Released input focus (operator GUI re-armed)' : 'Released input focus',
				cefFocusTarget: fallback,
			}),
		}
	}

	return null
}

module.exports = { handlePost }

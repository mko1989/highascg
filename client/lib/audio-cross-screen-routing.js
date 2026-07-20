/**
 * WO-284 — cross-screen audio routing: send a layer's audio from its host program channel to
 * another screen's program channel.
 *
 * The mixer used to render the "Screens" matrix with every non-host button hard-`disabled`
 * (title: "Cross-screen audio fan-out: planned (WO-157)"). That was an unimplemented-feature
 * placeholder, not a safety guard — see the work order report.
 *
 * Pure validation + layer math here (no DOM, no network) so the offline smokes can assert the
 * rules; the caller does the AMCP apply through the same `playRouteOnChannel` /
 * `clearRouteFromChannel` path the live-audio input routing already uses.
 */

import { isAnyInputChannel } from './input-channels.js'

/**
 * Destination layers for cross-screen audio-only routes live well above look layers (which top
 * out in the low hundreds) and above the timeline band (210+), so a route can never land on
 * program content.
 */
export const CROSS_SCREEN_LAYER_BASE = 300

/**
 * Deterministic destination layer for one (source channel, source layer) pair.
 *
 * Must be a pure function of the source: disabling the route has to find the same layer that
 * enabling it used, even after a reload with nothing but the persisted target list.
 *
 * @param {number} sourceChannel
 * @param {number} sourceLayer
 * @returns {number | null}
 */
export function crossScreenDestLayer(sourceChannel, sourceLayer) {
	const ch = Number(sourceChannel)
	const ln = Number(sourceLayer)
	if (!Number.isInteger(ch) || ch < 1 || ch > 99) return null
	if (!Number.isInteger(ln) || ln < 1 || ln > 999) return null
	return CROSS_SCREEN_LAYER_BASE + ch * 1000 + ln
}

/** @param {unknown} value */
export function parseCrossScreenTargets(value) {
	if (!Array.isArray(value)) return []
	const out = []
	const seen = new Set()
	for (const v of value) {
		const n = parseInt(String(typeof v === 'object' && v ? v.channel : v), 10)
		if (!Number.isFinite(n) || n < 1) continue
		if (seen.has(n)) continue
		seen.add(n)
		out.push(n)
	}
	return out.sort((a, b) => a - b)
}

/**
 * Pure set update for the persisted target list.
 * @param {unknown} current
 * @param {number} targetChannel
 * @param {boolean} enabled
 * @returns {number[]}
 */
export function nextCrossScreenTargets(current, targetChannel, enabled) {
	const list = parseCrossScreenTargets(current)
	const ch = parseInt(String(targetChannel), 10)
	if (!Number.isFinite(ch) || ch < 1) return list
	if (enabled) return parseCrossScreenTargets([...list, ch])
	return list.filter((c) => c !== ch)
}

/**
 * Validate a requested cross-screen audio destination.
 *
 * Rules, in order (first failure wins):
 *  - the source must be a real channel/layer pair;
 *  - the target must be a real channel number;
 *  - the host channel is not a "route" — it is where the audio already is;
 *  - the target must be one of the program channels (the only audio-capable destinations the
 *    operator can actually hear);
 *  - the target must not be a capture/input channel (routing program audio INTO a capture
 *    channel would feed a monitoring bus, not a screen).
 *
 * @param {{
 *   sourceChannel?: number,
 *   sourceLayer?: number,
 *   targetChannel?: number,
 *   programChannels?: Array<number | string>,
 *   channelMap?: object | null,
 * }} req
 * @returns {{ ok: boolean, reason?: string, destLayer?: number, route?: string, targetChannel?: number }}
 */
export function validateCrossScreenAudioTarget(req = {}) {
	const src = Number(req.sourceChannel)
	const srcLayer = Number(req.sourceLayer)
	if (!Number.isInteger(src) || src < 1) return { ok: false, reason: 'invalid-source-channel' }
	if (!Number.isInteger(srcLayer) || srcLayer < 1) return { ok: false, reason: 'invalid-source-layer' }

	const target = Number(req.targetChannel)
	if (!Number.isInteger(target) || target < 1) return { ok: false, reason: 'invalid-target-channel' }
	if (target === src) return { ok: false, reason: 'host-channel' }

	const program = (Array.isArray(req.programChannels) ? req.programChannels : [])
		.map((c) => Number(c))
		.filter((c) => Number.isInteger(c) && c >= 1)
	if (!program.includes(target)) return { ok: false, reason: 'not-a-program-channel' }

	if (isAnyInputChannel(req.channelMap, target)) return { ok: false, reason: 'not-an-audio-destination' }

	const destLayer = crossScreenDestLayer(src, srcLayer)
	if (destLayer == null) return { ok: false, reason: 'unroutable-source' }

	return { ok: true, destLayer, route: `route://${src}-${srcLayer}`, targetChannel: target }
}

/** Human-readable reason, for button titles and toasts. */
export function crossScreenReasonText(reason) {
	switch (reason) {
		case 'host-channel':
			return 'Host channel — the audio already plays here'
		case 'not-a-program-channel':
			return 'Not a program channel — audio can only be routed to a screen'
		case 'not-an-audio-destination':
			return 'Capture/input channel — not an audio destination'
		case 'invalid-source-channel':
		case 'invalid-source-layer':
		case 'unroutable-source':
			return 'This layer cannot be routed'
		case 'invalid-target-channel':
			return 'Invalid destination channel'
		default:
			return 'Cross-screen audio routing unavailable'
	}
}

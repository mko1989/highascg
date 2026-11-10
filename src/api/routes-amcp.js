/**
 * Basic AMCP HTTP: batch, play/load/loadbg, pause/resume, stop/clear, call, swap, add/remove, raw, restart, kill.
 * @see companion-module-casparcg-server/src/api-routes.js handleAmcpBasic + handleMisc subset
 */

'use strict'

/** Prefer chunked `/api/amcp/batch` over sequential `raw` lines when this is exceeded. */
const RAW_BATCH_WARN_MIN_LINES = 50

function normalizeAmcpCommandLines(cmds) {
	return cmds.map(String).map((s) => s.trim()).filter(Boolean)
}

/**
 * Targeted teardown, then coalescing fallback:
 * 1. Drop per-layer STOP/CLEAR lines for layers the playback matrix knows are empty.
 * 2. Any remaining per-layer CLEAR storm (untracked channels) collapses to `CLEAR <channel>`.
 * @param {string[]} lines
 * @param {object} [ctx]
 */
function applyClearCoalescing(lines, ctx) {
	let targeted
	let targetedChannels = new Set()
	try {
		const { targetTeardownLines } = require('../caspar/amcp-teardown-targeting')
		const res = targetTeardownLines(lines, ctx)
		targeted = res.lines
		targetedChannels = res.targetedChannels
	} catch (_) {
		targeted = lines
	}
	const { lines: coalesced, coalesced: did, channels } = coalescePerLayerClearStorm(targeted, {
		skipChannels: targetedChannels,
	})
	if (did && typeof ctx?.log === 'function') {
		ctx.log(
			'warn',
			`[AMCP] coalesced ${targeted.length} per-layer CLEAR/STOP lines → CLEAR ${channels.join(', ')} (use CLEAR <channel> instead of layer sweeps)`,
		)
	}
	return coalesced
}

const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('./response')
const playbackTracker = require('../state/playback-tracker')
const { defaultProgramChannel } = require('../config/operator-gui-first')
const { notifyProgramMutationMayInvalidateLive } = require('../state/live-scene-state')
const { audioRouteToAudioFilter, resolveConfigProgramLayoutForChannel } = require('../engine/audio-route')
const { coalescePerLayerClearStorm } = require('../caspar/amcp-coalesce-clears')
const { normalizeDecklinkPlayAmcpLines } = require('../config/decklink-amcp')
const { normalizeClipPlayAmcpLines } = require('../caspar/amcp-clip-resolve')
const { resolveSceneClipForAmcp } = require('../engine/scene-take-lbg-helpers')
const { AirHeldError, isAirHeld, airHeldReply } = require('../replication/air-held') // WO-1029 B2

function applyAmcpLineNormalizations(lines, ctx) {
	const cfg = ctx?.config || {}
	return normalizeClipPlayAmcpLines(normalizeDecklinkPlayAmcpLines(lines, cfg), ctx)
}

/** @param {unknown} v */
function hasExplicitChannel(v) {
	if (v == null || v === '' || typeof v === 'boolean') return false
	const n = Number(v)
	return Number.isInteger(n) && n >= 1
}

function jsonPlaybackBody(ctx, amcpResult, extra = null) {
	const matrix = playbackTracker.getMatrixForState(ctx)
	const base = amcpResult && typeof amcpResult === 'object' ? amcpResult : { data: amcpResult }
	return jsonBody({
		...base,
		playbackMatrix: matrix,
		...(extra && typeof extra === 'object' ? extra : {}),
	})
}

/**
 * WO-1029 B2: a program line another server drives right now is refused by the transport (AirHeldError) — answered
 * 409 here, and nothing after the send (playback tracker, live invalidation) runs for it.
 * @param {string} path
 * @param {string} body
 * @param {{ amcp: import('../caspar/amcp-client').AmcpClient }} ctx
 */
async function handlePost(path, body, ctx) {
	try {
		return await handlePostInner(path, body, ctx)
	} catch (e) {
		if (isAirHeld(e)) return airHeldReply(e)
		throw e
	}
}

/** WO-1029 B4: a batch that sent some lines and refused others → 409 listing the refused ones; only sent lines count. */
function partialRefusal(ctx, lines, result) {
	const refused = Array.isArray(result?.refused) ? result.refused : []
	const skip = new Set(refused.map((r) => r.line))
	playbackTracker.recordAmcpLines(ctx, lines.filter((l) => !skip.has(l)))
	if (!refused.length) return null
	const sent = lines.length - refused.length
	return airHeldReply(new AirHeldError(refused[0], refused), sent ? { partial: true, sent } : { sent })
}

async function handlePostInner(path, body, ctx) {
	const amcp = ctx.amcp
	if (!amcp) return null

	// WO-833 (3m): a malformed body used to parse to {} and the channel defaulted to 1 — `POST /api/clear` with a
	// garbled body CLEARed PGM. Malformed JSON is a 400 on every route here.
	const parsed = parseBodyStrict(body)
	if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'request body must be a JSON object' + (parsed.ok ? '' : ` (${parsed.error})`) }),
		}
	}
	const b = parsed.value
	const { channel = defaultProgramChannel(ctx), layer } = b // WO-868: PGM Screen 1 (1 unless Operator GUI first)
	// WO-833 (3m): destructive routes never fall back to the channel-1 default.
	if ((path === '/api/stop' || path === '/api/clear') && !hasExplicitChannel(b.channel)) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: `${path.slice(5)}: explicit "channel" (integer >= 1) required` }),
		}
	}

	switch (path) {
		case '/api/amcp/batch': {
			const cmds = b.commands
			if (!Array.isArray(cmds) || cmds.length === 0) {
				return {
					status: 400,
					headers: JSON_HEADERS,
					body: jsonBody({ error: 'commands: non-empty array of AMCP lines required (no BEGIN/COMMIT)' }),
				}
			}
			// Keep TCP batch flag in sync with latest persisted config (same object as startup, but UI may
			// toggle amcp_batch without recreating the connection — merge from ctx.config every request).
			if (ctx.config && amcp?._context?.config) {
				amcp._context.config.amcp_batch = ctx.config.amcp_batch
				if (ctx.config.amcp_max_batch_commands != null) {
					amcp._context.config.amcp_max_batch_commands = ctx.config.amcp_max_batch_commands
				}
				if (ctx.config.amcp_mixer_commit_before_amcp_batch != null) {
					amcp._context.config.amcp_mixer_commit_before_amcp_batch = ctx.config.amcp_mixer_commit_before_amcp_batch
				}
			}
			const lines = applyAmcpLineNormalizations(applyClearCoalescing(normalizeAmcpCommandLines(cmds), ctx), ctx)
			/** Chunks respect MAX_BATCH_COMMANDS; BEGIN…COMMIT when {@link isAmcpBatchEnabled}. */
			const last = await amcp.batchSendChunked(lines)
			const refusedReply = partialRefusal(ctx, lines, last)
			if (refusedReply) return refusedReply
			return { status: 200, headers: JSON_HEADERS, body: jsonPlaybackBody(ctx, last) }
		}
		case '/api/amcp/raw-batch': {
			const cmds = b.commands
			if (!Array.isArray(cmds) || cmds.length === 0) {
				return {
					status: 400,
					headers: JSON_HEADERS,
					body: jsonBody({ error: 'commands: non-empty array of AMCP lines required' }),
				}
			}
			const lines = applyAmcpLineNormalizations(applyClearCoalescing(normalizeAmcpCommandLines(cmds), ctx), ctx)
			const MAX = 4000
			if (lines.length > MAX) {
				return {
					status: 400,
					headers: JSON_HEADERS,
					body: jsonBody({ error: `commands: at most ${MAX} lines per raw-batch` }),
				}
			}
			if (lines.length > RAW_BATCH_WARN_MIN_LINES && typeof ctx.log === 'function') {
				ctx.log(
					'warn',
					`[AMCP] raw-batch uses ${lines.length} sequential AMCP round-trips — prefer POST /api/amcp/batch for chunked sends (PERF-D4).`,
				)
			}
			// WO-1029 B4: per line — the lines this server drives go out, the held ones are refused (409 below)
			const { send, refused } = require('../replication/air-held').partitionLines(amcp._context || ctx, lines)
			for (const line of send) {
				await amcp.raw(line)
			}
			const refusedReply = partialRefusal(ctx, lines, { refused })
			if (refusedReply) return refusedReply
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonPlaybackBody(ctx, { ok: true, rawBatch: true, count: lines.length }),
			}
		}
		case '/api/play': {
			const { clip, transition, duration, tween, loop, auto, parameters, audioFilter, audioRoute } = b
			const resolvedClip = resolveSceneClipForAmcp(clip, ctx)
			const opts = { loop: !!loop, auto: !!auto }
			if (transition && transition !== 'CUT') opts.transition = transition
			if (duration != null) opts.duration = duration
			if (tween) opts.tween = tween
			if (parameters) opts.parameters = parameters
			if (audioFilter) opts.audioFilter = String(audioFilter)
			else if (audioRoute) {
				const af = audioRouteToAudioFilter(String(audioRoute), resolveConfigProgramLayoutForChannel(ctx?.config, channel))
				if (af) opts.audioFilter = af
			}
			const r = await amcp.play(channel, layer, resolvedClip, opts)
			playbackTracker.recordPlay(ctx, channel, layer, resolvedClip, { loop: !!loop })
			notifyProgramMutationMayInvalidateLive(ctx, channel, {
				transition: transition || 'CUT',
				durationFrames: duration,
				clip: resolvedClip,
			})
			return { status: 200, headers: JSON_HEADERS, body: jsonPlaybackBody(ctx, r) }
		}
		case '/api/loadbg': {
			const { clip, transition, duration, tween, loop, auto, parameters, audioFilter, audioRoute } = b
			const resolvedClip = resolveSceneClipForAmcp(clip, ctx)
			const opts = { loop: !!loop, auto: !!auto }
			if (transition && transition !== 'CUT') opts.transition = transition
			if (duration != null) opts.duration = duration
			if (tween) opts.tween = tween
			if (parameters) opts.parameters = parameters
			if (audioFilter) opts.audioFilter = String(audioFilter)
			else if (audioRoute) {
				const af = audioRouteToAudioFilter(String(audioRoute), resolveConfigProgramLayoutForChannel(ctx?.config, channel))
				if (af) opts.audioFilter = af
			}
			const r = await amcp.loadbg(channel, layer, resolvedClip, opts)
			notifyProgramMutationMayInvalidateLive(ctx, channel, {
				transition: transition || 'CUT',
				durationFrames: duration,
				clip: resolvedClip,
			})
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/load': {
			const { clip, transition, duration, tween, loop, parameters, audioFilter, audioRoute } = b
			const resolvedClip = resolveSceneClipForAmcp(clip, ctx)
			const opts = { loop: !!loop }
			if (transition && transition !== 'CUT') opts.transition = transition
			if (duration != null) opts.duration = duration
			if (tween) opts.tween = tween
			if (parameters) opts.parameters = parameters
			if (audioFilter) opts.audioFilter = String(audioFilter)
			else if (audioRoute) {
				const af = audioRouteToAudioFilter(String(audioRoute), resolveConfigProgramLayoutForChannel(ctx?.config, channel))
				if (af) opts.audioFilter = af
			}
			// WO-833: AmcpClient has no flat load() (only basic.load) — same TypeError class as swap.
			const r = await amcp.basic.load(channel, layer, resolvedClip, opts)
			notifyProgramMutationMayInvalidateLive(ctx, channel, {
				transition: transition || 'CUT',
				durationFrames: duration,
				clip: resolvedClip,
			})
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/pause': {
			const r = await amcp.pause(channel, layer)
			playbackTracker.recordPause(ctx, channel, layer)
			try {
				require('../preview/compose-preview-activity').onPlaybackPaused(ctx, channel)
			} catch {
				/* WO-57 optional */
			}
			return { status: 200, headers: JSON_HEADERS, body: jsonPlaybackBody(ctx, r) }
		}
		case '/api/resume': {
			const r = await amcp.resume(channel, layer)
			playbackTracker.recordResume(ctx, channel, layer)
			return { status: 200, headers: JSON_HEADERS, body: jsonPlaybackBody(ctx, r) }
		}
		case '/api/seek': {
			// WO-570: scrub-bar seek — CALL {ch-l} SEEK {frame} is the AMCP verb for jumping a
			// playing/paused clip's position without a fresh LOAD/PLAY. `positionMs` (the same unit
			// the client's scrub bar already works in) rebases the playback-matrix tracker so a
			// ticking progress bar doesn't jump back to the pre-seek position on its next tick.
			const { frame, positionMs } = b
			const f = parseInt(frame, 10)
			if (!Number.isFinite(f) || f < 0) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'frame: non-negative integer required' }) }
			}
			const r = await amcp.call(channel, layer, 'SEEK', String(f))
			playbackTracker.recordSeek(ctx, channel, layer, positionMs)
			return { status: 200, headers: JSON_HEADERS, body: jsonPlaybackBody(ctx, r) }
		}
		case '/api/stop': {
			const r = await amcp.stop(channel, layer)
			playbackTracker.recordStop(ctx, channel, layer)
			notifyProgramMutationMayInvalidateLive(ctx, channel)
			return { status: 200, headers: JSON_HEADERS, body: jsonPlaybackBody(ctx, r) }
		}
		case '/api/clear': {
			const ch = parseInt(channel, 10)
			if (layer === undefined || layer === null || layer === '') {
				// WO-1029 B2: clearCasparChannel swallows send errors — a held screen is refused before it
				const held = require('../replication/amcp-fanout').airHeldBy(ctx, ch)
				if (held) return airHeldReply(held)
				const { clearCasparChannel } = require('../engine/caspar-channel-clear')
				await clearCasparChannel(amcp, ch, ctx)
				notifyProgramMutationMayInvalidateLive(ctx, ch)
				return { status: 200, headers: JSON_HEADERS, body: jsonPlaybackBody(ctx, { ok: true, cleared: 'channel', channel: ch }) }
			}
			const r = await amcp.clear(channel, layer)
			playbackTracker.recordStop(ctx, channel, layer)
			notifyProgramMutationMayInvalidateLive(ctx, channel)
			return { status: 200, headers: JSON_HEADERS, body: jsonPlaybackBody(ctx, r) }
		}
		case '/api/call': {
			const { fn, params: paramsStr } = b
			const r = await amcp.call(channel, layer, fn, paramsStr)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/swap': {
			const { channel2, layer2, transforms } = b
			// WO-833 (3h): AmcpClient has no flat swap(); basic.swap is the real method (HTTP + WS dispatch share this case).
			const r = await amcp.basic.swap(channel, layer, channel2, layer2, !!transforms)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/add': {
			const { consumer, params: paramsStr, index } = b
			const r = await amcp.basic.add(channel, consumer, paramsStr, index)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/remove': {
			const { consumer, index } = b
			const r = await amcp.basic.remove(channel, consumer, index)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/print':
		case '/api/amcp/print': {
			const ly = b.layer != null ? parseInt(String(b.layer), 10) : NaN
			const r =
				Number.isFinite(ly) && ly >= 1
					? await amcp.basic.print(channel, ly)
					: await amcp.basic.print(channel)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/log/level': {
			const { level } = b
			const r = await amcp.basic.logLevel(level)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/log/category': {
			const { category, enable } = b
			const r = await amcp.basic.logCategory(category, enable)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/set': {
			const { variable, value } = b
			const r = await amcp.basic.set(channel, variable, value)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/lock': {
			const { action, phrase } = b
			const r = await amcp.basic.lock(channel, action, phrase)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/ping': {
			const { token } = b
			const r = await amcp.basic.ping(token)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}

		case '/api/restart':
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(await amcp.query.restart()) }
		case '/api/kill':
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(await amcp.query.kill()) }
		case '/api/diag':
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(await amcp.query.diag()) }
		case '/api/gl/gc':
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(await amcp.query.glGc()) }
		case '/api/channel-grid':
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(await amcp.mixer.channelGrid()) }
		case '/api/raw':
		case '/api/amcp/raw': {
			const line = applyAmcpLineNormalizations([String(b.cmd ?? b.command ?? '').trim()], ctx)[0]
			if (!line) {
				return {
					status: 400,
					headers: JSON_HEADERS,
					body: jsonBody({ error: 'cmd (or command): single AMCP line required' }),
				}
			}
			const r = await amcp.raw(line)
			playbackTracker.recordAmcpLines(ctx, [line])
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		default:
			return null
	}
}

module.exports = { handlePost }

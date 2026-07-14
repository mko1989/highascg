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
	let targeted = lines
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

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const playbackTracker = require('../state/playback-tracker')
const { notifyProgramMutationMayInvalidateLive } = require('../state/live-scene-state')
const { audioRouteToAudioFilter, resolveConfigProgramLayoutForChannel } = require('../engine/audio-route')
const { coalescePerLayerClearStorm } = require('../caspar/amcp-coalesce-clears')
const { normalizeDecklinkPlayAmcpLine, normalizeDecklinkPlayAmcpLines } = require('../config/decklink-amcp')
const { normalizeClipPlayAmcpLines } = require('../caspar/amcp-clip-resolve')
const { resolveSceneClipForAmcp } = require('../engine/scene-take-lbg-helpers')

function notifyCefInteractiveAfterAmcp(lines, ctx) {
	try {
		const { notifyCefInteractiveAmcpLines } = require('../system/cef-interactive-bridge')
		const log = typeof ctx?.log === 'function' ? (level, msg) => ctx.log(level, msg) : () => {}
		notifyCefInteractiveAmcpLines(Array.isArray(lines) ? lines : [lines], ctx?.config || {}, log)
	} catch (_) {}
}

/** PLAY/LOAD/LOADBG/STOP/CLEAR/MIXER/CG all start `<VERB> <channel>[-<layer>] ...` (mirrors the shape playback-tracker's recordAmcpLines regexes match). */
const AMCP_BATCH_CHANNEL_RE = /^[A-Za-z_]+\s+(\d+)(?:-\d+)?\b/

/**
 * @param {string[]} lines
 * @returns {Set<number>}
 */
function touchedAmcpBatchChannels(lines) {
	const out = new Set()
	for (const raw of lines) {
		const m = AMCP_BATCH_CHANNEL_RE.exec(String(raw || '').trim())
		if (!m) continue
		const ch = parseInt(m[1], 10)
		if (Number.isFinite(ch) && ch > 0) out.add(ch)
	}
	return out
}


function applyAmcpLineNormalizations(lines, ctx) {
	const cfg = ctx?.config || {}
	return normalizeClipPlayAmcpLines(normalizeDecklinkPlayAmcpLines(lines, cfg), ctx)
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
 * @param {string} path
 * @param {string} body
 * @param {{ amcp: import('../caspar/amcp-client').AmcpClient }} ctx
 */
async function handlePost(path, body, ctx) {
	const amcp = ctx.amcp
	if (!amcp) return null

	const b = parseBody(body)
	const { channel = 1, layer } = b

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
			playbackTracker.recordAmcpLines(ctx, lines)
			notifyCefInteractiveAfterAmcp(lines, ctx)
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
			for (const line of lines) {
				await amcp.raw(line)
			}
			playbackTracker.recordAmcpLines(ctx, lines)
			notifyCefInteractiveAfterAmcp(lines, ctx)
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
			const r = await amcp.load(channel, layer, resolvedClip, opts)
			notifyProgramMutationMayInvalidateLive(ctx, channel, {
				transition: transition || 'CUT',
				durationFrames: duration,
				clip: resolvedClip,
			})
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/pause': {
			const r = await amcp.pause(channel, layer)
			try {
				require('../preview/compose-preview-activity').onPlaybackPaused(ctx, channel)
			} catch {
				/* WO-57 optional */
			}
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/resume': {
			const r = await amcp.resume(channel, layer)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
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
			const r = await amcp.swap(channel, layer, channel2, layer2, !!transforms)
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
			notifyCefInteractiveAfterAmcp([line], ctx)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		default:
			return null
	}
}

module.exports = { handlePost }

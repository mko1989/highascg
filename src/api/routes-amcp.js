/**
 * Basic AMCP HTTP: batch, play/load/loadbg, pause/resume, stop/clear, call, swap, add/remove, raw, restart, kill.
 * @see companion-module-casparcg-server/src/api-routes.js handleAmcpBasic + handleMisc subset
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const playbackTracker = require('../state/playback-tracker')
const { notifyProgramMutationMayInvalidateLive } = require('../state/live-scene-state')
const { audioRouteToAudioFilter } = require('../engine/audio-route')

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
			const lines = cmds.map(String).map((s) => s.trim()).filter(Boolean)
			/** Chunks respect MAX_BATCH_COMMANDS; BEGIN…COMMIT when {@link isAmcpBatchEnabled}. */
			const last = await amcp.batchSendChunked(lines)
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
			const lines = cmds.map(String).map((s) => s.trim()).filter(Boolean)
			const MAX = 4000
			if (lines.length > MAX) {
				return {
					status: 400,
					headers: JSON_HEADERS,
					body: jsonBody({ error: `commands: at most ${MAX} lines per raw-batch` }),
				}
			}
			for (const line of lines) {
				await amcp.raw(line)
			}
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonPlaybackBody(ctx, { ok: true, rawBatch: true, count: lines.length }),
			}
		}
		case '/api/play': {
			const { clip, transition, duration, tween, loop, auto, parameters, audioFilter, audioRoute } = b
			const opts = { loop: !!loop, auto: !!auto }
			if (transition && transition !== 'CUT') opts.transition = transition
			if (duration != null) opts.duration = duration
			if (tween) opts.tween = tween
			if (parameters) opts.parameters = parameters
			if (audioFilter) opts.audioFilter = String(audioFilter)
			else if (audioRoute) {
				const af = audioRouteToAudioFilter(String(audioRoute))
				if (af) opts.audioFilter = af
			}
			const r = await amcp.play(channel, layer, clip, opts)
			playbackTracker.recordPlay(ctx, channel, layer, clip, { loop: !!loop })
			notifyProgramMutationMayInvalidateLive(ctx, channel)
			return { status: 200, headers: JSON_HEADERS, body: jsonPlaybackBody(ctx, r) }
		}
		case '/api/loadbg': {
			const { clip, transition, duration, tween, loop, auto, parameters, audioFilter, audioRoute } = b
			const opts = { loop: !!loop, auto: !!auto }
			if (transition && transition !== 'CUT') opts.transition = transition
			if (duration != null) opts.duration = duration
			if (tween) opts.tween = tween
			if (parameters) opts.parameters = parameters
			if (audioFilter) opts.audioFilter = String(audioFilter)
			else if (audioRoute) {
				const af = audioRouteToAudioFilter(String(audioRoute))
				if (af) opts.audioFilter = af
			}
			const r = await amcp.loadbg(channel, layer, clip, opts)
			notifyProgramMutationMayInvalidateLive(ctx, channel)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/load': {
			const { clip, transition, duration, tween, loop, parameters, audioFilter, audioRoute } = b
			const opts = { loop: !!loop }
			if (transition && transition !== 'CUT') opts.transition = transition
			if (duration != null) opts.duration = duration
			if (tween) opts.tween = tween
			if (parameters) opts.parameters = parameters
			if (audioFilter) opts.audioFilter = String(audioFilter)
			else if (audioRoute) {
				const af = audioRouteToAudioFilter(String(audioRoute))
				if (af) opts.audioFilter = af
			}
			const r = await amcp.load(channel, layer, clip, opts)
			notifyProgramMutationMayInvalidateLive(ctx, channel)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/pause': {
			const r = await amcp.pause(channel, layer)
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
			const r = await amcp.basic.print(channel)
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
		case '/api/raw': {
			if (!b.cmd) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'cmd required' }) }
			const r = await amcp.raw(b.cmd)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		default:
			return null
	}
}

module.exports = { handlePost }

'use strict'

/**
 * browser-capture-bridge.js — WO-258 T258.2/T258.4: ffmpeg x11grab process manager for
 * browser_display sources. Mirrors `src/capture/v4l2-input-bridge.js`'s spawn/stop/status shape
 * (Map<sourceId, entry>, stderr log + lastError sniff, exit handler clears the map entry) — see
 * `browser-capture-args.js` for why this is the correct precedent to mirror (input-direction bridge,
 * not the output-direction `src/virtual-output/v4l2-bridge*.js`).
 *
 * T258.4 grab-vs-move: `restartBrowserCaptureBridge(ctx, sourceId, region)` lets the caller respawn
 * this SAME bridge pointed at a NEW region — this is the "grab-follows-window" half of the T258.4
 * design (see browser-source-session.js's moveBrowserSourceToOperator/returnBrowserSourceToOffscreen
 * for the other half: xdotool windowmove of the actual Firefox window). A brief (one ffmpeg
 * process-cycle, sub-second) capture gap during the swap is accepted — the same tolerance already
 * baked into `startV4l2BridgeRelay`/`stopV4l2BridgeRelay` elsewhere in this codebase.
 */

const { spawn } = require('child_process')
const { buildBrowserCaptureFfmpegArgs, BROWSER_CAPTURE_WARMUP_MS } = require('./browser-capture-args')

/** @type {Map<string, { proc: import('child_process').ChildProcess|null, region: object, hostChannel: number, startedAt: number, lastError?: string }>} */
const _bridges = new Map()

/**
 * @param {object} config
 * @returns {string}
 */
function ffmpegBinary(config) {
	return config?.streaming?.ffmpeg_path || process.env.FFMPEG_PATH || 'ffmpeg'
}

/**
 * @param {object} ctx
 * @param {string} sourceId
 * @param {{ x: number, y: number, w: number, h: number }} region - root/absolute :0 pixel rect
 * @param {number} hostChannel
 * @param {{ fps?: number }} [opts]
 * @returns {boolean}
 */
function startBrowserCaptureBridge(ctx, sourceId, region, hostChannel, opts = {}) {
	const id = String(sourceId || '').trim()
	if (!id || !region || !(region.w > 0) || !(region.h > 0)) return false
	stopBrowserCaptureBridge(id)

	const cfg = ctx?.config || {}
	const args = buildBrowserCaptureFfmpegArgs(region, hostChannel, opts)
	const proc = spawn(ffmpegBinary(cfg), args, { stdio: ['ignore', 'ignore', 'pipe'] })
	const entry = { proc, region, hostChannel, startedAt: Date.now(), lastError: undefined }
	_bridges.set(id, entry)

	proc.stderr?.on('data', (buf) => {
		const s = buf.toString().trim()
		if (!s) return
		if (/error|invalid|failed|busy|cannot|no such/i.test(s)) entry.lastError = s.slice(0, 240)
		ctx?.log?.('debug', `[browser-capture] ${id}: ${s.slice(0, 180)}`)
	})
	proc.on('error', (err) => {
		entry.lastError = err?.message || String(err)
		ctx?.log?.('warn', `[browser-capture] ${id} spawn failed: ${entry.lastError}`)
	})
	proc.on('close', (code, signal) => {
		const cur = _bridges.get(id)
		if (!cur || cur.proc !== proc) return
		cur.proc = null
		if (code !== 0 && code != null) {
			cur.lastError = `ffmpeg exited ${code}${signal ? ` (${signal})` : ''}`
			ctx?.log?.('warn', `[browser-capture] ${id} stopped: ${cur.lastError}`)
		}
	})
	ctx?.log?.(
		'info',
		`[browser-capture] ${id} x11grab ${region.w}x${region.h}+${region.x},${region.y} -> udp ch${hostChannel}`,
	)
	return true
}

/**
 * @param {string} sourceId
 */
function stopBrowserCaptureBridge(sourceId) {
	const id = String(sourceId || '').trim()
	const entry = _bridges.get(id)
	if (!entry) return
	if (entry.proc && !entry.proc.killed) {
		try {
			entry.proc.kill('SIGTERM')
		} catch (_) {
			/* ok */
		}
	}
	_bridges.delete(id)
}

function stopAllBrowserCaptureBridges() {
	for (const id of [..._bridges.keys()]) stopBrowserCaptureBridge(id)
}

/**
 * Ensure the bridge is running for `sourceId`, (re)starting it when absent/dead or when `force`.
 * @param {object} ctx
 * @param {string} sourceId
 * @param {{ x: number, y: number, w: number, h: number }} region
 * @param {number} hostChannel
 * @param {{ fps?: number, force?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function ensureBrowserCaptureBridge(ctx, sourceId, region, hostChannel, opts = {}) {
	const id = String(sourceId || '').trim()
	if (!id) return false
	if (!opts.force) {
		const entry = _bridges.get(id)
		if (entry?.proc && entry.proc.exitCode == null && !entry.proc.killed) return true
	}
	startBrowserCaptureBridge(ctx, id, region, hostChannel, opts)
	await new Promise((r) => setTimeout(r, BROWSER_CAPTURE_WARMUP_MS))
	const next = _bridges.get(id)
	return !!(next?.proc && next.proc.exitCode == null && !next.proc.killed)
}

/**
 * T258.4 "grab-follows-window": respawn the bridge for `sourceId` pointed at a NEW region (the
 * operator monitor rect while interacting, or the off-screen dead zone when returned).
 * @param {object} ctx
 * @param {string} sourceId
 * @param {{ x: number, y: number, w: number, h: number }} region
 * @param {number} hostChannel
 * @param {{ fps?: number }} [opts]
 * @returns {Promise<boolean>}
 */
async function restartBrowserCaptureBridge(ctx, sourceId, region, hostChannel, opts = {}) {
	return ensureBrowserCaptureBridge(ctx, sourceId, region, hostChannel, { ...opts, force: true })
}

/**
 * @param {string} sourceId
 */
function browserCaptureBridgeStatus(sourceId) {
	const entry = _bridges.get(String(sourceId || '').trim())
	if (!entry) return { running: false }
	const running = !!(entry.proc && entry.proc.exitCode == null && !entry.proc.killed)
	return {
		running,
		region: entry.region,
		hostChannel: entry.hostChannel,
		lastError: entry.lastError || null,
		startedAt: entry.startedAt || null,
		pid: entry.proc?.pid ?? null,
	}
}

/** Test-only: clear module state between smoke test cases. */
function resetBrowserCaptureBridgeStateForTests() {
	_bridges.clear()
}

module.exports = {
	startBrowserCaptureBridge,
	stopBrowserCaptureBridge,
	stopAllBrowserCaptureBridges,
	ensureBrowserCaptureBridge,
	restartBrowserCaptureBridge,
	browserCaptureBridgeStatus,
	resetBrowserCaptureBridgeStateForTests,
}

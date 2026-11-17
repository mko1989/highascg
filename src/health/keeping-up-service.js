'use strict'

/**
 * WO-1088 — the keeping-up watch: about once a second it gathers what already flows (Caspar's OSC counters in
 * OscState.health, the link status, the node's event-loop delay, the DMX follow clock, tracking detection rates, the
 * WS backlog per client, CPU / RAM from /proc, GPU from ONE long-running `nvidia-smi -lms`) into a sample, runs the
 * pure checks (keeping-up-checks.js) through the debounced model (keeping-up-model.js), logs each incident start / end
 * as one `[keeping-up] …` journal line and broadcasts `health:keeping-up` when a status changes.
 * GET /api/health/keeping-up returns the same summary (routes-keeping-up.js); a client reports its own fps check with
 * POST /api/health/keeping-up/report, so the journal and the other clients see it too.
 */

const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')
const { monitorEventLoopDelay } = require('perf_hooks')
const { KeepingUpModel, journalLine } = require('./keeping-up-model')
const { evaluate } = require('./keeping-up-checks')
const { parseProcStatCpu, machineCpuPct } = require('../system/host-cpu-usage')

const SAMPLE_MS = 1000
const WINDOW_MS = 2000 // rates over ~2 s of counters: ±1 frame of quantisation at 50 fps is 1 %, not 2 %
const LOOP_RES_MS = 10
const REPORT_TTL_MS = 30000
// WO-1106 B10: anyone on the network can post a report — bound what it can raise: live checks per client, in total
const MAX_KEYS_PER_CLIENT = 4
const MAX_REPORTED = 32
const RING_TTL_MS = 10000
const NAMES_TTL_MS = 10000
const NV_FIELDS = 'utilization.gpu,memory.used,memory.total,temperature.gpu,clocks_event_reasons.hw_thermal_slowdown,clocks_event_reasons.sw_thermal_slowdown'
const THROTTLE_FILE = '/sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count'

/** One `nvidia-smi --format=csv,noheader,nounits` line → { util, vramPct, tempC, thermal } or null. */
function parseNvLine(line) {
	const p = String(line || '').split(',').map((x) => x.trim())
	const util = parseInt(p[0], 10)
	if (!Number.isFinite(util)) return null
	const used = parseInt(p[1], 10)
	const total = parseInt(p[2], 10)
	const active = (v) => /^active$/i.test(v || '')
	return { util, vramPct: total > 0 ? (used / total) * 100 : null, tempC: parseInt(p[3], 10) || null,
		thermal: p.length >= 6 ? active(p[4]) || active(p[5]) : null }
}

/** HASCGSHM v1 header (caspar/modules/shm/hshm_abi.h): fps_num @32, fps_den @36 → the writer's own rate, or 0. */
function readRingFps(name, fsImpl = fs) {
	let fd
	try {
		fd = fsImpl.openSync(`/dev/shm/highascg-${name}`, 'r')
		const h = Buffer.alloc(40)
		if (fsImpl.readSync(fd, h, 0, 40, 0) < 40 || h.toString('latin1', 0, 8) !== 'HASCGSHM') return 0
		const num = h.readUInt32LE(32)
		const den = h.readUInt32LE(36) || 1
		return num > 0 ? num / den : 0
	} catch {
		return 0
	} finally {
		if (fd != null) try { fs.closeSync(fd) } catch {}
	}
}

/** Caspar channel → the name the operator knows it by (screen label, "… preview", "Operator GUI"). */
function channelNames(cm) {
	const names = {}
	if (!cm) return names
	const labels = Array.isArray(cm.screenLabels) ? cm.screenLabels : []
	;(cm.programChannels || []).forEach((ch, i) => ch && (names[ch] = labels[i] || `Screen ${i + 1}`))
	;(cm.previewChannels || []).forEach((ch, i) => ch && !names[ch] && (names[ch] = `${labels[i] || `Screen ${i + 1}`} preview`))
	for (const ch of cm.operatorGuiChannels || []) if (ch && !names[ch]) names[ch] = 'Operator GUI'
	if (cm.multiviewCh && !names[cm.multiviewCh]) names[cm.multiviewCh] = 'Multiview'
	return names
}

/**
 * @param {object} [opts] autostart, gpu, wsClients; WO-1106 D6: `readHost()` → { cpuPct, memPct, gpu, cpuThrottleDelta }
 *   and `readLoop()` → { maxMs, p99Ms, meanMs } | null replace the machine readings (/proc, the thermal throttle
 *   counter, the event-loop histogram) so a test runs on fixed readings, not on whatever load the box is under.
 */
function startKeepingUp(ctx, opts = {}) {
	const model = new KeepingUpModel()
	const log = (level, msg) => (typeof ctx.log === 'function' ? ctx.log(level, msg) : undefined)
	const loop = typeof opts.readLoop === 'function' ? null : monitorEventLoopDelay({ resolution: LOOP_RES_MS })
	if (loop) loop.enable()
	const oscHist = []
	const reported = new Map() // key → { result, until }
	const rings = new Map() // ring name → { fps, at }
	const wsIds = new WeakMap()
	let wsSeq = 0
	let names = { at: 0, map: {} }
	let cpuPrev = null
	let throttlePrev = null
	let gpu = null
	let nv = null
	let nvRetryAt = 0
	let last = model.summary()

	const startNv = () => {
		if (opts.gpu === false || nv || Date.now() < nvRetryAt) return
		try {
			nv = spawn('nvidia-smi', [`--query-gpu=${NV_FIELDS}`, '--format=csv,noheader,nounits', `-lms`, '1000'], { stdio: ['ignore', 'pipe', 'ignore'] })
		} catch {
			nv = null
			nvRetryAt = Date.now() + 60000
			return
		}
		let buf = ''
		nv.stdout.on('data', (d) => {
			buf += d
			const lines = buf.split('\n')
			buf = lines.pop()
			const g = parseNvLine(lines.filter(Boolean).pop())
			if (g) gpu = { ...g, at: Date.now() }
		})
		const gone = () => {
			nv = null
			gpu = null
			nvRetryAt = Date.now() + 60000 // no NVIDIA (or the driver went away): try again in a minute
		}
		nv.on('error', gone)
		nv.on('exit', gone)
	}

	const ringFps = (name) => {
		const c = rings.get(name)
		if (c && Date.now() - c.at < RING_TTL_MS) return c.fps
		const fps = readRingFps(name)
		rings.set(name, { fps, at: Date.now() })
		return fps
	}

	const channelNameMap = () => {
		if (Date.now() - names.at < NAMES_TTL_MS) return names.map
		let map = {}
		try {
			map = channelNames(require('../config/channel-map-from-ctx').buildChannelMap(ctx))
		} catch {}
		names = { at: Date.now(), map }
		return map
	}

	const machineSample = () => {
		let cpuPct = null
		try {
			const cur = parseProcStatCpu(fs.readFileSync('/proc/stat', 'utf8'))
			cpuPct = machineCpuPct(cpuPrev, cur)
			cpuPrev = cur
		} catch {}
		let cpuThrottleDelta = null
		try {
			const n = parseInt(fs.readFileSync(THROTTLE_FILE, 'utf8'), 10)
			if (Number.isFinite(n) && throttlePrev != null) cpuThrottleDelta = Math.max(0, n - throttlePrev)
			if (Number.isFinite(n)) throttlePrev = n
		} catch {}
		const tot = os.totalmem()
		const g = gpu && Date.now() - gpu.at < 5000 ? gpu : null
		return { cpuPct, memPct: tot > 0 ? ((tot - os.freemem()) / tot) * 100 : null, gpu: g, cpuThrottleDelta }
	}
	const hostSample = typeof opts.readHost === 'function' ? opts.readHost : machineSample

	const loopSample = typeof opts.readLoop === 'function' ? opts.readLoop : () => {
		const lag = (ns) => Math.max(0, ns / 1e6 - LOOP_RES_MS)
		const out = loop.count > 0 ? { maxMs: lag(loop.max), p99Ms: lag(loop.percentile(99)), meanMs: lag(loop.mean) } : null
		loop.reset()
		return out
	}

	const wsSample = () => {
		const out = []
		for (const ws of opts.wsClients || []) {
			if (!wsIds.has(ws)) wsIds.set(ws, ++wsSeq)
			const addr = String(ws._socket?.remoteAddress || '?').replace(/^::ffff:/, '')
			out.push({ id: wsIds.get(ws), addr: /^(127\.|::1$)/.test(addr) ? 'on this box' : addr, buffered: ws.bufferedAmount || 0 })
		}
		return out
	}

	const buildSample = () => {
		const now = Date.now()
		const offline = !!ctx.config?.offline_mode
		const linked = ctx._casparStatus?.connected === true
		const osc = ctx.oscState?.health && linked ? ctx.oscState.health.snapshot() : null
		if (osc) {
			for (const l of osc.layers) Object.assign(l, ctx.oscState.layerState(l.ch, l.layer) || {})
			oscHist.push(osc)
			while (oscHist.length > 1 && oscHist[1].at <= now - WINDOW_MS) oscHist.shift()
		} else oscHist.length = 0
		const ringNames = {}
		for (const l of osc?.layers || []) if (l.type === 'shm' && l.name) ringNames[l.name] = ringFps(l.name)
		const loopS = loopSample()
		const det = ctx.detectService?.health?.()
		for (const [k, v] of reported) if (v.until < now) reported.delete(k)
		const caspar = ctx._casparStatus || null
		return {
			at: now, offline,
			caspar: caspar ? { connected: caspar.connected === true } : null,
			oscEnabled: ctx.config?.osc?.enabled !== false && !!ctx.oscState,
			osc, oscPrev: oscHist.length > 1 ? oscHist[0] : null,
			ringFps: ringNames, names: channelNameMap(), loop: loopS,
			follow: ctx.fixtureService?.engine?.takeTiming?.() || null,
			tracking: det && det.enabled && det.running ? { intervalMs: det.intervalMs,
				cameras: Object.entries(det.sidecar || {}).map(([id, c]) => ({ id, state: c?.state, fps: Number(c?.fps), ms: Number(c?.ms) })) } : null,
			ltc: ctx._ltcService?.health?.() || null, // WO-1092
			ws: wsSample(), host: offline ? null : hostSample(), reported: [...reported.values()].map((v) => v.result),
		}
	}

	const sampleOnce = () => {
		if (!ctx.config?.offline_mode) startNv()
		const s = buildSample()
		const { changed, events } = model.update(evaluate(s))
		for (const ev of events) log(ev.type === 'start' ? 'warn' : 'info', journalLine(ev))
		const prevLabel = last.label
		last = { ...model.summary(), mode: s.offline ? 'preshow' : 'production' }
		// a status / incident change, or the worst offender's words ("Visuals at 38 of 50 fps") moved
		if ((changed || last.label !== prevLabel) && typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('health:keeping-up', last)
		return last
	}

	const timer = opts.autostart === false ? null : setInterval(() => {
		try {
			sampleOnce()
		} catch (e) {
			log('debug', `[keeping-up] sample failed: ${e?.message || e}`)
		}
	}, SAMPLE_MS)
	if (timer?.unref) timer.unref()

	const api = {
		summary: () => last,
		sampleOnce,
		/** A client's own check (its fps): { client, key, level, name, label, text, target, measured, unit, hint }. */
		report(body) {
			const b = body && typeof body === 'object' ? body : {}
			const client = String(b.client || '').slice(0, 64)
			const key = String(b.key || '').slice(0, 64)
			if (!client || !key) return { ok: false, error: 'client and key are required' }
			const str = (v, n = 160) => String(v ?? '').slice(0, n)
			const num = (v) => (v !== null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v)) ? Number(v) : null) // WO-1106 B10
			const rk = `client:${client}:${key}`
			const now = Date.now()
			for (const [k, v] of reported) if (v.until < now) reported.delete(k)
			if (!reported.has(rk)) {
				let mine = 0
				for (const v of reported.values()) if (v.result.client === client) mine++
				if (mine >= MAX_KEYS_PER_CLIENT) return { ok: false, error: `at most ${MAX_KEYS_PER_CLIENT} checks per client` }
				if (reported.size >= MAX_REPORTED) return { ok: false, error: 'too many client checks right now' }
			}
			const result = { key: rk, group: 'client', name: str(b.name, 64) || 'Client', level: Math.max(0, Math.min(2, Math.round(Number(b.level) || 0))),
				target: num(b.target), measured: num(b.measured), unit: str(b.unit, 16), text: str(b.text), label: str(b.label),
				hint: str(b.hint, 240), severity: Math.max(0, Math.min(1e6, num(b.severity) || 0)), client }
			reported.set(rk, { result, until: now + REPORT_TTL_MS })
			return { ok: true }
		},
		stop() {
			if (timer) clearInterval(timer)
			if (loop) loop.disable()
			if (nv) try { nv.kill() } catch {}
			nv = null
		},
	}
	ctx.keepingUp = api
	return api
}

module.exports = { startKeepingUp, parseNvLine, channelNames }

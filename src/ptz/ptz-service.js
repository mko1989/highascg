'use strict'

/**
 * WO-711 — PTZ camera follow over VISCA. The director (WO-708) decides where each camera points; this service turns
 * that into VISCA datagrams.
 *
 *   createPtzService({ log, send?, now?, allowed? }) -> { configure(project), step(now, targetOf), status(), cameras(), close() }
 *   targetOf(camId) -> { x, y, z } (PSN m, the floor point to aim at) | 'home' | null (leave the camera alone)
 *
 * Per enabled camera: at most 10 Hz, no resend while the aim moved < 0.3 degrees, Home sent once on entering 'home'
 * (the VISCA Home command, or preset recall when home.preset > 0), null sends nothing. A fixed zoom (cam.zoom) goes
 * out with the first aim after the camera starts following. Disabled cameras are never sent to. "visca-ip" cameras
 * get the Sony RESET before their first command (and again after the host / port changes). A bad host / port leaves
 * an error in status(); nothing throws. One UDP socket, created lazily, closed by close().
 * `send(host, port, buf, protocol)` is injectable (tests); the default sends through the socket.
 * WO-712 R1: `allowed()` (default always true) is this server's `ptz` duty. While it is false step() sends nothing and
 * forgets each camera's aim, so the first step after it turns true sends the aim again; status rows carry
 * `blocked_by_server: true`.
 */

const dgram = require('dgram')
const visca = require('./visca')
const { normalizeList, aimAngles, toUnits } = require('./ptz-model')

const MIN_INTERVAL_MS = 100
const DEADBAND_DEG = 0.3
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/

function createPtzService({ log = () => {}, send, now = Date.now, allowed = () => true } = {}) {
	let cams = []
	let lastSig = ''
	let sock = null
	let closed = false
	/** @type {Map<string, object>} camera id -> runtime state */
	const rt = new Map()

	const fresh = () => ({
		state: 'idle',
		sentAt: null,
		pan: null,
		tilt: null,
		seq: 0,
		reset: false,
		zoomSent: false,
		error: null,
	})

	const transportSig = (c) => `${c.protocol}|${c.host}|${c.port}|${c.address}`

	function socket() {
		if (sock || closed) return sock
		sock = dgram.createSocket('udp4')
		sock.on('error', (e) => log('warn', '[ptz] socket: ' + (e?.message || e)))
		if (typeof sock.unref === 'function') sock.unref()
		return sock
	}

	function rawSend(host, port, buf) {
		const s = socket()
		if (!s) return
		s.send(buf, port, host, (err) => {
			if (!err) return
			for (const c of cams) {
				if (c.host === host && c.port === port && rt.has(c.id)) rt.get(c.id).error = 'send: ' + err.message
			}
		})
	}
	const out = typeof send === 'function' ? send : rawSend

	function problem(c) {
		if (!c.host) return 'no host'
		if (!HOST_RE.test(c.host)) return `bad host "${c.host}"`
		if (!(c.port >= 1 && c.port <= 65535)) return `bad port ${c.port}`
		return null
	}

	/** One VISCA payload to a camera (IP framing + the Sony RESET handled here). Returns false when it failed. */
	function emit(c, r, payload) {
		try {
			if (c.protocol === 'visca-ip' && !r.reset) {
				out(c.host, c.port, visca.ipReset(), c.protocol)
				r.reset = true
				r.seq = 0
			}
			const buf = visca.datagram(c.protocol, payload, r.seq)
			if (c.protocol === 'visca-ip') r.seq = (r.seq + 1) % visca.SEQ_MOD
			out(c.host, c.port, buf, c.protocol)
			return true
		} catch (e) {
			r.error = 'send: ' + (e?.message || e)
			return false
		}
	}

	function configure(project) {
		const list = project?.previs?.tracking?.ptz
		const sig = JSON.stringify(list ?? null)
		if (sig === lastSig) return
		lastSig = sig
		cams = normalizeList(list)
		const ids = new Set(cams.map((c) => c.id))
		for (const id of [...rt.keys()]) if (!ids.has(id)) rt.delete(id)
		for (const c of cams) {
			const r = rt.get(c.id)
			if (!r) rt.set(c.id, Object.assign(fresh(), { sig: transportSig(c) }))
			else if (r.sig !== transportSig(c)) rt.set(c.id, Object.assign(fresh(), { sig: transportSig(c) }))
			else if (!c.enabled) Object.assign(r, { state: 'idle', pan: null, tilt: null, zoomSent: false })
			rt.get(c.id).error = c.enabled ? problem(c) : null
		}
	}

	function step(t = now(), targetOf = () => null) {
		if (closed) return
		if (!allowed()) {
			for (const r of rt.values())
				Object.assign(r, { state: 'idle', sentAt: null, pan: null, tilt: null, zoomSent: false })
			return
		}
		for (const c of cams) {
			if (!c.enabled) continue
			const r = rt.get(c.id)
			const bad = problem(c)
			if (bad) {
				r.error = bad
				continue
			}
			if (r.error && !r.error.startsWith('send:')) r.error = null
			let target = null
			try {
				target = targetOf(c.id)
			} catch (e) {
				log('warn', `[ptz] targetOf(${c.id}): ${e?.message || e}`)
			}
			if (target === 'home') {
				if (r.state === 'home') continue
				const ok = emit(c, r, c.home.preset > 0 ? visca.presetRecall(c.address, c.home.preset) : visca.home(c.address))
				if (ok) {
					r.state = 'home'
					r.sentAt = t
					r.pan = r.tilt = null
					r.zoomSent = false
					r.error = null
				}
				continue
			}
			if (!target || typeof target !== 'object') continue
			if (![target.x, target.y, target.z].every((v) => Number.isFinite(Number(v)))) continue
			if (r.sentAt !== null && t - r.sentAt < MIN_INTERVAL_MS) continue
			const a = aimAngles(c, target)
			if (r.state === 'following' && r.pan !== null) {
				if (Math.abs(a.pan - r.pan) < DEADBAND_DEG && Math.abs(a.tilt - r.tilt) < DEADBAND_DEG) continue
			}
			const ok = emit(
				c,
				r,
				visca.panTiltAbsolute(c.address, toUnits(c.pan, a.pan), toUnits(c.tilt, a.tilt), c.speed.pan, c.speed.tilt)
			)
			if (!ok) continue
			if (c.zoom !== null && !r.zoomSent) r.zoomSent = emit(c, r, visca.zoomDirect(c.address, c.zoom))
			r.state = 'following'
			r.sentAt = t
			r.pan = a.pan
			r.tilt = a.tilt
			r.error = null
		}
	}

	const cameras = () => cams.map((c) => ({ id: c.id, name: c.name, enabled: c.enabled, auto: c.auto }))

	function status() {
		const t = now()
		return cams.map((c) => {
			const r = rt.get(c.id) || fresh()
			return {
				id: c.id,
				name: c.name,
				enabled: c.enabled,
				state: !c.enabled ? 'disabled' : r.error && r.state === 'idle' ? 'error' : r.state,
				pan: r.pan,
				tilt: r.tilt,
				last_sent_ms_ago: r.sentAt === null ? null : Math.max(0, t - r.sentAt),
				error: r.error,
				...(allowed() ? {} : { blocked_by_server: true }),
			}
		})
	}

	function close() {
		closed = true
		if (sock) {
			try {
				sock.close()
			} catch (_) {
				/* already closed */
			}
			sock = null
		}
	}

	return { configure, step, status, cameras, close }
}

module.exports = { createPtzService, MIN_INTERVAL_MS, DEADBAND_DEG }

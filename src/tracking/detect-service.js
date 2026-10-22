'use strict'

/**
 * WO-616 T9 — person detection, the running half: owns the Python sidecar (tools/tracking-detect/sidecar.py,
 * the OpenFollow YOLO + ByteTrack port) as a child process while `project.previs.tracking.detection.enabled` and
 * at least one tracking camera has a surface role. Leases those roles' shm surfaces (WO-597, its own client id,
 * renewed every LEASE_MS), sends the sidecar its config as a JSON line on stdin (again on every project change),
 * turns each `tracks` line into floor points (detect-model.personsFrom) and keeps the latest per camera.
 * A sidecar that exits is respawned with backoff (1 s doubling to 30 s, reset once it reports ready); its stdin
 * closing (server gone) ends it, so it never outlives the server. Pinning detections to markers: detect-pin.js (T9b).
 *
 * Runtime outside the repo (Syncthing, AGPL weights): HIGHASCG_TRACKING_PYTHON (default
 * ~/.local/share/highascg/tracking-venv/bin/python, tools/tracking-detect/setup-venv.sh) and
 * HIGHASCG_TRACKING_MODELS (default ~/.local/share/highascg/models, tools/tracking-detect/export-models.sh).
 */

const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { normalizeDetection, detectCameras, personsFrom, maskSizeFrom } = require('./detect-model')
const { onProjectChanged } = require('../engine/project-events')

const LEASE_ID = 'tracking-detect'
const LEASE_MS = 5000
const STALE_MS = 1000
const BACKOFF_MIN_MS = 1000
const BACKOFF_MAX_MS = 30000
const SCRIPT = path.join(__dirname, '..', '..', 'tools', 'tracking-detect', 'sidecar.py')
const DATA = path.join(os.homedir(), '.local', 'share', 'highascg')

function createDetectService(ctx, deps = {}) {
	const log = typeof ctx?.log === 'function' ? ctx.log.bind(ctx) : () => {}
	const now = deps.now || Date.now
	const spawn = deps.spawn || childProcess.spawn
	const exists = deps.exists || fs.existsSync
	const listModels = deps.listModels || (() => {
		try {
			return fs.readdirSync(modelsDir).filter((f) => f.endsWith('.onnx')).sort()
		} catch {
			return []
		}
	})
	const python = deps.python || process.env.HIGHASCG_TRACKING_PYTHON || path.join(DATA, 'tracking-venv', 'bin', 'python')
	const modelsDir = deps.modelsDir || process.env.HIGHASCG_TRACKING_MODELS || path.join(DATA, 'models')
	const lease = deps.lease || ((roles) => require('../system/video-surfaces').getVideoSurfaceManager(ctx).lease(LEASE_ID, roles))

	let det = normalizeDetection(null)
	let cams = []
	let planeZ = 0
	let child = null
	let buf = ''
	let ready = false
	let providers = []
	let error = ''
	let backoff = BACKOFF_MIN_MS
	let restartTimer = null
	let leaseTimer = null
	let stopped = false
	let leased = ''
	let rev = 0
	const latest = new Map() // camera id → { at, frame, w, h, ms, persons }
	let faces = false // WO-675: the sidecar adds face features while a presenter with a face is on the roster
	let bodies = false // WO-675 P2: …and body features while a presenter with a body feature is
	let onFaces = null // (cameraId, [{ tid, feature }], 'face' | 'body') — never stored in `latest`, never broadcast
	let sidecarCams = {} // camera id → sidecar status { state, detail, fps, ms }

	const wanted = () => !stopped && det.enabled && cams.length > 0
	const modelPath = () => path.join(modelsDir, det.model)

	function renewLease() {
		const roles = wanted() ? [...new Set(cams.map((c) => c.role))] : []
		const key = roles.join(',')
		if (roles.length && !child && !restartTimer) start() // retries a missing venv / model every LEASE_MS
		if (!roles.length && !leased) return
		leased = key
		Promise.resolve()
			.then(() => lease(roles))
			.catch((e) => log('warn', '[detect] surface lease: ' + (e?.message || e)))
	}

	function sendConfig() {
		if (!child?.stdin?.writable) return
		const cfg = { type: 'config', model: modelPath(), pose_model: det.pose_model ? path.join(modelsDir, det.pose_model) : '', confidence: det.confidence, interval_ms: det.interval_ms,
			max_persons: det.max_persons, grace_ms: det.grace_ms, threads: det.threads, faces, bodies,
			cameras: cams.map((c) => ({ id: c.id, path: `/dev/shm/highascg-${c.role}`, masks: c.masks })) }
		child.stdin.write(JSON.stringify(cfg) + '\n')
	}

	function handle(msg) {
		if (msg.type === 'ready') {
			ready = true
			providers = Array.isArray(msg.providers) ? msg.providers : []
			error = ''
			backoff = BACKOFF_MIN_MS
			log('info', `[detect] sidecar ready: ${path.basename(String(msg.model || ''))} on ${providers.join(', ')} (input ${msg.input})`)
		} else if (msg.type === 'tracks') {
			const ce = cams.find((c) => c.id === msg.camera)
			if (!ce) return
			latest.set(ce.id, { at: now(), frame: msg.frame, w: msg.w, h: msg.h, ms: msg.ms, maskSize: maskSizeFrom(msg), persons: personsFrom(msg, ce, planeZ) })
			rev++
			const seen = Array.isArray(msg.tracks) ? msg.tracks.filter((t) => Array.isArray(t?.face)) : []
			if (seen.length && typeof onFaces === 'function') onFaces(ce.id, seen.map((t) => ({ tid: Number(t.tid), feature: t.face })))
			const shapes = Array.isArray(msg.tracks) ? msg.tracks.filter((t) => Array.isArray(t?.body)) : []
			if (shapes.length && typeof onFaces === 'function') onFaces(ce.id, shapes.map((t) => ({ tid: Number(t.tid), feature: t.body })), 'body')
		} else if (msg.type === 'status') {
			sidecarCams = msg.cameras && typeof msg.cameras === 'object' ? msg.cameras : {}
			if (msg.ready === false) ready = false
		} else if (msg.type === 'error') {
			if (String(msg.detail) !== error) log('warn', '[detect] sidecar: ' + msg.detail)
			error = String(msg.detail || '')
		}
	}

	function onStdout(chunk) {
		buf += chunk
		let nl
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl).trim()
			buf = buf.slice(nl + 1)
			if (!line) continue
			try {
				handle(JSON.parse(line))
			} catch {
				/* a stray print is not a protocol line */
			}
		}
		if (buf.length > 1 << 20) buf = ''
	}

	function start() {
		if (child || restartTimer || !wanted()) return
		if (!exists(python)) return void (error = `no Python at ${python} — run tools/tracking-detect/setup-venv.sh`)
		if (!exists(modelPath())) return void (error = `no model ${det.model} in ${modelsDir} — run tools/tracking-detect/export-models.sh`)
		buf = ''
		ready = false
		let proc
		try {
			proc = spawn(python, ['-u', SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] })
		} catch (e) {
			error = 'spawn: ' + (e?.message || e)
			return scheduleRestart()
		}
		child = proc
		log('info', `[detect] sidecar started (pid ${proc.pid}), ${cams.length} camera(s)`)
		proc.stdout.setEncoding('utf8')
		proc.stdout.on('data', onStdout)
		proc.stderr.setEncoding('utf8')
		proc.stderr.on('data', (d) => {
			const last = String(d).trim().split('\n').pop()
			if (last) error = last.slice(0, 300)
		})
		proc.stdin.on('error', () => {}) // EPIPE when it died first; 'exit' handles it
		proc.on('error', (e) => {
			error = 'sidecar: ' + (e?.message || e)
		})
		proc.on('exit', (code, sig) => {
			if (child !== proc) return
			child = null
			ready = false
			if (wanted()) {
				log('warn', `[detect] sidecar exited (${sig || code}) — restart in ${backoff} ms${error ? ': ' + error : ''}`)
				scheduleRestart()
			}
		})
		sendConfig()
	}

	function scheduleRestart() {
		if (restartTimer || !wanted()) return
		restartTimer = setTimeout(() => {
			restartTimer = null
			start()
		}, backoff)
		if (typeof restartTimer.unref === 'function') restartTimer.unref()
		backoff = Math.min(BACKOFF_MAX_MS, backoff * 2)
	}

	function halt() {
		if (restartTimer) clearTimeout(restartTimer)
		restartTimer = null
		const proc = child
		child = null
		ready = false
		if (proc) {
			try {
				proc.stdin.end()
				proc.kill('SIGTERM')
			} catch {
				/* already gone */
			}
			log('info', '[detect] sidecar stopped')
		}
	}

	let lastJson = ''
	const apply = (project) => {
		const tracking = project?.previs?.tracking
		const json = JSON.stringify([tracking?.detection ?? null, tracking?.cameras ?? null, tracking?.grid?.z_offset ?? 0])
		if (json === lastJson) return
		lastJson = json
		det = normalizeDetection(tracking?.detection)
		cams = detectCameras(tracking, det)
		planeZ = Number(tracking?.grid?.z_offset) || 0
		for (const id of [...latest.keys()]) if (!cams.some((c) => c.id === id)) latest.delete(id)
		rev++
		if (!wanted()) {
			halt()
			error = ''
		} else if (child) sendConfig()
		else {
			backoff = BACKOFF_MIN_MS
			start()
		}
		renewLease()
	}

	if (deps.project !== undefined) apply(deps.project)
	else {
		try {
			apply(require('../engine/project-scenes').loadFullProject())
		} catch (e) {
			log('warn', '[detect] initial project load: ' + (e?.message || e))
		}
	}
	const off = onProjectChanged(apply)
	if (deps.autostart !== false) {
		leaseTimer = setInterval(renewLease, LEASE_MS)
		if (typeof leaseTimer.unref === 'function') leaseTimer.unref()
	}

	/** WS `tracking:detections`: per watched camera, its latest persons (none once older than STALE_MS). */
	function snapshot() {
		const t = now()
		return {
			enabled: det.enabled,
			running: !!child && ready,
			error: det.enabled ? error : '',
			cameras: cams.map((c) => {
				const l = latest.get(c.id)
				const fresh = !!l && t - l.at <= STALE_MS
				const cam = { id: c.id, role: c.role, frame: l?.frame ?? null, stale: !fresh, persons: fresh ? l.persons : [] }
				if (fresh && l.maskSize) cam.mask_size = l.maskSize // WO-665: the persons carry cut-out masks
				return cam
			}),
		}
	}

	return {
		snapshot,
		get rev() {
			return rev
		},
		get config() {
			return det
		},
		get available() {
			return !!child && ready
		},
		get planeZ() {
			return planeZ
		},
		/** Fresh persons of every watched camera, for the pin (detect-pin.js): key `camera:tid`. */
		persons() {
			const t = now()
			const out = []
			for (const c of cams) {
				const l = latest.get(c.id)
				if (!l || t - l.at > STALE_MS) continue
				for (const p of l.persons) out.push({ key: `${c.id}:${p.tid}`, camera: c.id, tid: p.tid, box: p.box, score: p.score, age_s: p.age_s, camEntry: c })
			}
			return out
		},
		/** Latest frame of every watched, solved camera for fusion (fusion.js judges freshness): [{ id, entry, at, frame, persons }]. */
		frames() {
			const out = []
			for (const c of cams) {
				const l = latest.get(c.id)
				if (l && c.cam) out.push({ id: c.id, entry: c, at: l.at, frame: l.frame, persons: l.persons })
			}
			return out
		},
		/** Watched cameras with a solved pose — from 2 up, the pin follows fused world persons (WO-616 T10b). */
		get solvedCameras() {
			return cams.filter((c) => c.cam).length
		},
		status: () => ({ ...snapshot(), config: det, model: det.model, models: listModels(), models_dir: modelsDir, python, providers, error,
			pid: child?.pid ?? null, sidecar: sidecarCams }),
		_handle: handle,
		/** WO-675: ask the sidecar for face (and P2 body) features — resends the config only on a change — and where they go. */
		setFaces(on, sink, bodiesOn = false) {
			onFaces = sink || null
			if (!!on === faces && !!bodiesOn === bodies) return
			faces = !!on
			bodies = !!bodiesOn
			sendConfig()
		},
		stop() {
			stopped = true
			off()
			if (leaseTimer) clearInterval(leaseTimer)
			leaseTimer = null
			halt()
			renewLease()
		},
	}
}

module.exports = { createDetectService, LEASE_ID, STALE_MS }

#!/usr/bin/env node
'use strict'

/**
 * WO-979 — a fake person-detection sidecar: the camera half of a tracking test server without a camera, a venv or
 * a model. It speaks tools/tracking-detect/sidecar.py's JSON-lines protocol, so src/tracking/detect-service.js runs
 * it exactly like the real one: point a SANDBOX server's HIGHASCG_TRACKING_PYTHON at this file (the service spawns
 * `<python> -u sidecar.py`; the arguments are ignored here) and HIGHASCG_TRACKING_MODELS at a directory holding an
 * empty file named like the project's detection model (detect-service only checks that it exists).
 *
 *   stdin   {"type":"config", "interval_ms", "cameras":[{"id"}], …}   (again on every project change)
 *   stdout  {"type":"ready"} once, then per camera every interval_ms (min 33)
 *           {"type":"tracks","camera","frame","w":1920,"h":1080,"ms":1,"tracks":[{"tid","box","score","age_s"}]}
 *           and {"type":"status","cameras":{id:{"state":"ok","detail":"fake","fps"}}} every second.
 * The people (FAKE_DETECT_PERSONS, default 1, max 4) walk a slow ping-pong across the picture, so the Auto
 * director sees persons that move. Exits when stdin closes (the server went away), like the real sidecar.
 * Never read the box's cameras or /dev/shm: it opens nothing but its own stdio. Test tooling only.
 */

const PERSONS = Math.max(0, Math.min(4, Number(process.env.FAKE_DETECT_PERSONS ?? 1) || 0))
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n')

let cameras = []
let intervalMs = 67
let frame = 0
let ready = false
let timer = null
let statusAt = 0
const t0 = Date.now()

/** Person k's normalised box at time t (s): a 0.1 × 0.5 box whose centre ping-pongs between x 0.2 and 0.8. */
function boxOf(k, t) {
	const phase = (((t / 20 + k / Math.max(1, PERSONS)) % 1) + 1) % 1
	const cx = 0.2 + 0.6 * (phase < 0.5 ? phase * 2 : 2 - phase * 2)
	const top = 0.35 + 0.05 * k
	return [cx - 0.05, top, cx + 0.05, top + 0.5].map((v) => Math.round(v * 1e4) / 1e4)
}

function step() {
	const t = (Date.now() - t0) / 1000
	frame++
	for (const c of cameras) {
		const tracks = Array.from({ length: PERSONS }, (_, k) => ({ tid: k + 1, box: boxOf(k, t), score: 0.9, age_s: 0 }))
		emit({ type: 'tracks', camera: c.id, frame, w: 1920, h: 1080, ms: 1, tracks })
	}
	if (Date.now() - statusAt >= 1000) {
		statusAt = Date.now()
		emit({
			type: 'status',
			ready: true,
			cameras: Object.fromEntries(
				cameras.map((c) => [c.id, { state: 'ok', detail: 'fake', fps: Math.round(1000 / intervalMs) }])
			),
		})
	}
}

function configure(cfg) {
	cameras = Array.isArray(cfg.cameras) ? cfg.cameras.filter((c) => c && c.id) : []
	intervalMs = Math.max(33, Number(cfg.interval_ms) || 67)
	if (!ready) {
		ready = true
		emit({ type: 'ready', model: cfg.model || 'fake.onnx', providers: ['fake'], input: 640 })
	}
	if (timer) clearInterval(timer)
	timer = setInterval(step, intervalMs)
}

function main() {
	let buf = ''
	process.stdin.setEncoding('utf8')
	process.stdin.on('data', (d) => {
		buf += d
		let nl
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl).trim()
			buf = buf.slice(nl + 1)
			if (!line) continue
			try {
				const msg = JSON.parse(line)
				if (msg?.type === 'config') configure(msg)
			} catch {
				emit({ type: 'error', detail: 'fake sidecar: not JSON' })
			}
		}
	})
	process.stdin.on('end', () => process.exit(0))
	process.stdout.on('error', () => process.exit(0))
}

if (require.main === module) main() // required (a test reading boxOf): no stdin listeners, nothing keeps it alive
module.exports = { boxOf }

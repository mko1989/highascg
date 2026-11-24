#!/usr/bin/env node
'use strict'
/**
 * WO-1133 stress companion: runs beside caspar-leak-soak.js (same --out dir, appends to its events.jsonl) and adds
 * what the API soak cannot or does not do. None of these happened in the first 36 h of the plain soak:
 *  - editor:  close + reopen the Godot looks editor through real clicks on :0. Each open sends
 *             `REMOVE 3-742` + `ADD 3-742 SHM NAME prv1` (the custom shm consumer, a leak suspect).
 *  - clear:   `CLEAR 3` (the 21.11 burst had 13 PRV clears in five minutes).
 *  - record:  a FILE consumer on PGM (ch 2) for --rec-s, then REMOVE (the owner records shows; Rec1_* 17.11).
 *
 * Clicking safety: the look card's gear (opens the editor) sits 32 px below its ✕ (removes the look). Before each gear
 * click a 16x16 grab of that spot is compared with a reference crop from a look-grid screenshot (gear 0.0 vs ✕ / ▶ /
 * canvas >= 33 mean abs diff); a mismatch skips the click and logs it.
 *
 *   node tools/soak/soak-stress.js --out <soak dir> --until 2026-11-25T07:00 [--editor-s 90] [--clear-s 180]
 *        [--closed-s 20] [--rec-every-min 6] [--rec-s 60] [--ref ~/.highascg/soak/ref/lookgrid.png]
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { execFileSync } = require('child_process')

const MEDIA = path.join(os.homedir(), 'highascg', 'media')
const REC_REL = '_soak/stress_rec.mp4'
const REC_CONSUMER = 94 // below the RTMP consumer (97); node's record slots are allocated on request only
const REC_ARGS =
	'-codec:v libx264 -preset:v veryfast -crf:v 26 -tune:v zerolatency -filter:v format=yuv420p ' +
	'-filter:a aresample=48000 -filter:a aformat=channel_layouts=stereo -codec:a aac -b:a 128k'
const LIVE_TAB = [322, 65]
const EDITOR_CLOSE = [1474, 603]
const GEARS = [[486, 824], [698, 824], [910, 824], [1122, 824], [1334, 824], [486, 953], [698, 953], [910, 953], [1122, 953]]
const GEAR_MAX_DIFF = 8

function parseArgs(argv) {
	const o = { out: null, until: null, editorS: 90, closedS: 20, clearS: 180, recEveryMin: 6, recS: 60, port: 4200,
		ref: path.join(os.homedir(), '.highascg/soak/ref/lookgrid.png') }
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i]
		const v = () => argv[++i]
		if (a === '--out') o.out = v()
		else if (a === '--until') o.until = new Date(v()).getTime()
		else if (a === '--editor-s') o.editorS = Number(v())
		else if (a === '--closed-s') o.closedS = Number(v())
		else if (a === '--clear-s') o.clearS = Number(v())
		else if (a === '--rec-every-min') o.recEveryMin = Number(v())
		else if (a === '--rec-s') o.recS = Number(v())
		else if (a === '--port') o.port = Number(v())
		else if (a === '--ref') o.ref = v()
		else throw new Error(`unknown arg ${a}`)
	}
	if (!o.out || !o.until || !Number.isFinite(o.until)) throw new Error('--out and --until are required')
	return o
}

const opt = parseArgs(process.argv)
const evPath = path.join(opt.out, 'events.jsonl')
const X = { ...process.env, DISPLAY: ':0', XAUTHORITY: path.join(os.homedir(), '.Xauthority') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let stopping = false
let recording = false

function event(type, data = {}) {
	const line = JSON.stringify({ t: new Date().toISOString(), type, phase: 'stress', ...data })
	fs.appendFileSync(evPath, line + '\n')
	console.log(line)
}

function amcp(cmd) {
	return new Promise((resolve) => {
		const body = JSON.stringify({ cmd })
		const req = http.request({ host: '127.0.0.1', port: opt.port, path: '/api/amcp/raw', method: 'POST',
			headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 15000 },
		(res) => {
			let s = ''
			res.on('data', (c) => (s += c))
			res.on('end', () => resolve({ status: res.statusCode, text: s.slice(0, 200) }))
		})
		req.on('error', (e) => resolve({ status: 0, text: e.message }))
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.end(body)
	})
}

function crop(src, x, y) {
	const input = src === ':0' ? ['-f', 'x11grab', '-video_size', '16x16', '-i', `:0+${x - 8},${y - 8}`] : ['-i', src]
	const vf = src === ':0' ? [] : ['-vf', `crop=16:16:${x - 8}:${y - 8}`]
	return execFileSync('ffmpeg', ['-loglevel', 'error', ...input, ...vf, '-frames:v', '1', '-f', 'rawvideo',
		'-pix_fmt', 'rgb24', '-'], { env: X, timeout: 10000 })
}

const diff = (a, b) => {
	if (a.length !== b.length) return 255
	let s = 0
	for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
	return s / a.length
}

function click([x, y]) {
	execFileSync('xdotool', ['mousemove', String(x), String(y), 'click', '1'], { env: X, timeout: 5000 })
}

const refs = GEARS.map(([x, y]) => crop(opt.ref, x, y))

/** Close the editor (a click on empty space when it is already closed), then open it on a random look via its gear. */
async function editorCycle(n) {
	try {
		click(LIVE_TAB)
		await sleep(600)
		click(EDITOR_CLOSE)
		// node drops the shm consumer only once the editor's lease lapses (video-surfaces LEASE_TTL_MS 15 s, swept every
		// 2 s); a quicker reopen renews the lease and Caspar never sees REMOVE + ADD
		await sleep(n === 'final' ? 1800 : opt.closedS * 1000)
		execFileSync('xdotool', ['mousemove', '900', '590'], { env: X }) // off every gear: no hover tint in the grab
		await sleep(300)
		const i = Math.floor(Math.random() * GEARS.length)
		const d = diff(crop(':0', ...GEARS[i]), refs[i])
		if (d > GEAR_MAX_DIFF) return event('editor-skip', { n, gear: i, diff: Math.round(d) })
		click(GEARS[i])
		event('editor-cycle', { n, gear: i, diff: Math.round(d * 10) / 10 })
	} catch (e) {
		event('editor-error', { n, error: String(e.message).slice(0, 160) })
	}
}

async function recordOnce(n) {
	fs.mkdirSync(path.join(MEDIA, '_soak'), { recursive: true })
	const add = await amcp(`ADD 2-${REC_CONSUMER} FILE "${REC_REL}" ${REC_ARGS}`)
	recording = add.status === 200
	event('rec-start', { n, status: add.status, reply: add.text.slice(0, 80) })
	const end = Date.now() + opt.recS * 1000
	while (!stopping && Date.now() < end) await sleep(500)
	await stopRecording(n)
}

async function stopRecording(n) {
	if (!recording) return
	const rm = await amcp(`REMOVE 2-${REC_CONSUMER}`)
	recording = false
	let bytes = null
	try {
		bytes = fs.statSync(path.join(MEDIA, REC_REL)).size
		fs.unlinkSync(path.join(MEDIA, REC_REL))
	} catch {
		/* no file */
	}
	event('rec-stop', { n, status: rm.status, bytes })
}

async function main() {
	event('stress-start', { until: new Date(opt.until).toISOString(), editorS: opt.editorS, clearS: opt.clearS,
		recEveryMin: opt.recEveryMin, recS: opt.recS })
	const next = { editor: Date.now(), clear: Date.now() + 30_000, rec: Date.now() + 60_000 }
	const n = { editor: 0, clear: 0, rec: 0 }
	while (!stopping && Date.now() < opt.until) {
		const now = Date.now()
		if (now >= next.editor) {
			await editorCycle(++n.editor)
			next.editor = Date.now() + opt.editorS * 1000
		} else if (now >= next.clear) {
			const r = await amcp('CLEAR 3')
			event('clear-prv', { n: ++n.clear, status: r.status })
			next.clear = Date.now() + opt.clearS * 1000
		} else if (now >= next.rec) {
			await recordOnce(++n.rec)
			next.rec = Date.now() + opt.recEveryMin * 60_000
		} else await sleep(500)
	}
	await finish('deadline')
}

async function finish(why) {
	stopping = true
	await stopRecording('final')
	await editorCycle('final') // leave the GUI as found: in the looks editor
	event('stress-end', { why })
	process.exit(0)
}

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => finish(sig))
main().catch((e) => {
	event('stress-crash', { error: String(e.stack || e).slice(0, 300) })
	process.exit(1)
})

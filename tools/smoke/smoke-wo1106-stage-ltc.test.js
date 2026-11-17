'use strict'

/**
 * WO-1106 stage-ltc slice — review fixes in src/stage, src/fixtures, src/timecode, tools/ltc and the tracking job.
 * Offline: pure functions, source text and temp dirs only.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const CARDS = ` 0 [PCH            ]: HDA-Intel - HDA Intel PCH
                      HDA Intel PCH at 0x6001120000 irq 159
`

/** Braces outside quoted strings balance and every quote closes (what ALSA's config parser needs). */
function alsaBalanced(text) {
	let depth = 0
	let inQ = false
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (inQ) {
			if (c === '\\') i++
			else if (c === '"') inQ = false
			else if (c === '\n') return false
			continue
		}
		if (c === '"') inQ = true
		else if (c === '{') depth++
		else if (c === '}' && --depth < 0) return false
	}
	return depth === 0 && !inQ
}

describe('WO-1106 B6 — LTC share block survives hostile output labels', () => {
	it('a label with " } \\ and a newline keeps braces and quotes balanced', () => {
		const share = require('../../src/timecode/ltc-share')
		const label = 'Main "PA" } left\\right\nsecond line {x}'
		const cfg = { audioOutputs: [{ id: 'audio_1', label, type: 'portaudio', enabled: true, deviceName: 'hw:0,0', channelLayout: 'stereo' }] }
		const t = share.resolveLtcTarget({ device: 'program', channel: 2, channels: 2 }, cfg, CARDS, { channels: 2 })
		assert.equal(t.ok, true)
		assert.ok(t.block.includes('HighAsCG program audio Main PA  left'), t.block)
		assert.equal(alsaBalanced(t.block), true, t.block)
		const quotes = (t.block.match(/"/g) || []).length
		assert.equal(quotes % 2, 0)
		assert.equal((t.block.match(/{/g) || []).length, (t.block.match(/}/g) || []).length)
	})
})

describe('WO-1106 B19 — OBJ coordinates are finite', () => {
	it('v 1e999 / vt -1e999 / vn NaN read as 0, never Infinity', () => {
		const { parseObj } = require('../../src/stage/obj-parse')
		const o = parseObj(['v 1e999 2 -1e999', 'v 1 1 1', 'v 0 1 0', 'vt 1e999 0.5', 'vn nan 1 1e400', 'f 1/1/1 2/1/1 3/1/1'].join('\n'))
		assert.deepEqual([...o.v.slice(0, 3)], [0, 2, 0])
		assert.deepEqual([...o.vt.slice(0, 2)], [0, 0.5])
		assert.deepEqual([...o.vn.slice(0, 3)], [0, 1, 0])
		assert.ok([...o.v, ...o.vt, ...o.vn].every(Number.isFinite))
	})
})

describe('WO-1106 B22 — MVR rig export with a zero-scale source matrix', () => {
	it('writes a finite matrix at the calibrated pose, never NaN', async () => {
		const { parseScene } = require('../../src/stage/mvr-scene')
		const { buildRigExport, invAffine } = require('../../src/stage/mvr-rig-export')
		const { poseFromMatrix } = require('../../src/stage/mvr-patch')
		assert.equal(invAffine([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), null)
		const uuid = '00000001-AAAA-BBBB-CCCC-DDDDDDDDDDDD'
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GeneralSceneDescription verMajor="1" verMinor="6"><Scene><Layers><Layer name="Rig" uuid="LLLLLLLL-0000-0000-0000-000000000001"><ChildList>
<Fixture name="Flat 1" uuid="${uuid}"><Matrix>{0,0,0}{0,1,0}{0,0,1}{1000,0,6000}</Matrix><GDTFSpec>M@S.gdtf</GDTFSpec><GDTFMode>Mode 1</GDTFMode><FixtureID>1</FixtureID></Fixture>
</ChildList></Layer></Layers></Scene></GeneralSceneDescription>
`
		const sc = await parseScene(xml, { has: () => false, resolveGdtf: async () => null })
		const want = { x: 2, y: 1, z: 5, yaw: 20, pitch: 10, roll: 5, hang: 'truss' }
		const patch = [{ id: `mvr-${uuid.toLowerCase()}`, name: 'Flat 1', pose: {}, calibrated_pose: { ...want, source: 'measured' } }]
		const { files, report } = buildRigExport({ patch, sceneXml: xml, objects: sc.objects, files: { 'GeneralSceneDescription.xml': Buffer.from(xml) },
			withMarks: false, at: 'T' })
		const out = files['GeneralSceneDescription.xml'].toString('utf8')
		const m = /<Fixture name="Flat 1"[^>]*><Matrix>([^<]*)<\/Matrix>/.exec(out)[1]
		assert.doesNotMatch(m, /NaN|Infinity/, m)
		assert.ok(report.notes.some((n) => /zero scale/.test(n)))
		const q = poseFromMatrix((await parseScene(out, { has: () => false, resolveGdtf: async () => null })).objects.find((o) => o.fixture).fixture.matrix)
		assert.ok(Math.hypot(q.x - want.x, q.y - want.y, q.z - want.z) < 0.001, JSON.stringify(q))
	})
})

describe('WO-1106 B21 — libltc frame calls declare their argtypes', () => {
	it('ltc_encoder_get_frame / set_frame / ltc_frame_set_parity take a pointer, not a 32-bit int', () => {
		const fs = require('fs')
		const path = require('path')
		const { spawnSync } = require('child_process')
		const dir = path.join(__dirname, '../ltc')
		const py = [
			'import sys, json', `sys.path.insert(0, ${JSON.stringify(dir)})`, 'import ltc_helper as h',
			'try:\n    lib = h.load_lib()\nexcept OSError:\n    print(json.dumps(None)); sys.exit(0)',
			'print(json.dumps({n: [t.__name__ for t in (getattr(lib, n).argtypes or [])] for n in ("ltc_encoder_get_frame", "ltc_encoder_set_frame", "ltc_frame_set_parity")}))',
		].join('\n')
		const r = spawnSync('python3', ['-I', '-c', py], { encoding: 'utf8' })
		const got = r.status === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : null
		if (got) {
			assert.deepEqual(got, { ltc_encoder_get_frame: ['c_void_p', 'LP_LTCFrame'], ltc_encoder_set_frame: ['c_void_p', 'LP_LTCFrame'],
				ltc_frame_set_parity: ['LP_LTCFrame', 'c_int'] })
		} else {
			const src = fs.readFileSync(path.join(dir, 'ltc_helper.py'), 'utf8')
			assert.match(src, /lib\.ltc_encoder_get_frame\.argtypes = \[vp, ctypes\.POINTER\(LTCFrame\)\]/)
			assert.match(src, /lib\.ltc_encoder_set_frame\.argtypes = \[vp, ctypes\.POINTER\(LTCFrame\)\]/)
			assert.match(src, /lib\.ltc_frame_set_parity\.argtypes = \[ctypes\.POINTER\(LTCFrame\), ctypes\.c_int\]/)
		}
	})
})

describe('WO-1106 B23 — detection runtime job: last line and reused pids', () => {
	const fs = require('fs')
	const os = require('os')
	const path = require('path')
	const { createJobs, procStamp } = require('../../src/tracking/runtime-job')
	const { runtimePaths } = require('../../src/tracking/runtime-paths')
	const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-b23-'))
	require('node:test').after(() => fs.rmSync(TMP, { recursive: true, force: true }))

	it('a final output line without a newline still reaches the job (its error is not lost)', async () => {
		const script = path.join(TMP, 'tail.sh')
		fs.writeFileSync(script, 'echo \'@@ {"plan":["a"]}\'\nprintf \'@@ {"error":7,"msg":"disk full"}\'\nexit 1\n')
		let ended = null
		const jobs = createJobs({ script, onEnd: (j) => (ended = j) })
		assert.equal(jobs.start('install', [], path.join(TMP, 'p')).status, 202)
		for (let i = 0; i < 100 && !ended; i++) await new Promise((r) => setTimeout(r, 30))
		assert.equal(ended?.state, 'error')
		assert.equal(ended.error, 'disk full')
		assert.equal(ended.code, 7)
		assert.ok(JSON.parse(fs.readFileSync(runtimePaths(path.join(TMP, 'p')).state, 'utf8')).pid_start !== undefined)
	})

	it('a "running" state whose pid is alive but started another time (reboot reuse) restores as interrupted', () => {
		const write = (dir, extra) => {
			fs.mkdirSync(dir, { recursive: true })
			fs.writeFileSync(runtimePaths(dir).state, JSON.stringify({ kind: 'install', args: [], state: 'running', pid: process.pid, plan: ['a'], done: [], ...extra }))
			return createJobs({}).restore(dir)
		}
		assert.equal(write(path.join(TMP, 'reused'), { pid_start: 'another-boot:123' }).state, 'interrupted')
		assert.equal(write(path.join(TMP, 'same'), { pid_start: procStamp(process.pid) }).state, 'running')
	})
})

describe('WO-1106 B18 — one MagicQ rotation convention for both CSV exports', () => {
	it('console-match exportCsv and the rig export MagicQ table give the same RotX / RotY / RotZ (yaw + pitch + roll)', () => {
		const { exportCsv } = require('../../src/fixtures/console-match')
		const { rigCsv } = require('../../src/stage/rig-csv')
		const { matrixFromPose } = require('../../src/stage/mvr-patch')
		const poses = [{ yaw: 33, pitch: 27, roll: -14 }, { yaw: -120, pitch: 60, roll: 35 }, { yaw: 3.56, pitch: 0.1, roll: -4.89 },
			{ yaw: 20, pitch: -15, roll: 10, hang: 'floor' }, { yaw: 170, pitch: 100, roll: 170 }, { yaw: -180, hang: 'floor' }]
		for (const p of poses) {
			const pose = { x: 1, y: 2, z: 5, ...p }
			const a = exportCsv([{ id: 'a', name: 'h', universe: 0, address: 1, pose }], () => 1).csv.split('\r\n')[1].split(',').slice(6, 9).map(Number)
			const b = rigCsv([{ id: 'a', fid: 1, name: 'h', matrix: matrixFromPose(pose) }], { desk: 'magicq' }).split('\r\n')[1].split(',').slice(6, 9).map(Number)
			assert.deepEqual(a, b, JSON.stringify(p))
		}
		// and the convention is the MagicQ-verified order R = Ry(RotY) · Rx(RotX) · Rz(RotZ) in its frame (X, Y up, Z to the audience)
		const [rx, ry, rz] = exportCsv([{ id: 'a', name: 'h', universe: 0, address: 1, pose: { x: 0, y: 0, z: 0, yaw: 33, pitch: 27, roll: -14 } }], () => 1)
			.csv.split('\r\n')[1].split(',').slice(6, 9).map((v) => (Number(v) * Math.PI) / 180)
		const mm = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)))
		const Rx = [[1, 0, 0], [0, Math.cos(rx), -Math.sin(rx)], [0, Math.sin(rx), Math.cos(rx)]]
		const Ry = [[Math.cos(ry), 0, Math.sin(ry)], [0, 1, 0], [-Math.sin(ry), 0, Math.cos(ry)]]
		const Rz = [[Math.cos(rz), -Math.sin(rz), 0], [Math.sin(rz), Math.cos(rz), 0], [0, 0, 1]]
		const { rotationOf } = require('../../src/stage/rig-csv')
		const R = rotationOf(matrixFromPose({ yaw: 33, pitch: 27, roll: -14 }))
		const C = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
		const Rq = mm(mm(C, R), [[1, 0, 0], [0, 0, -1], [0, 1, 0]])
		mm(mm(Ry, Rx), Rz).flat().forEach((v, i) => assert.ok(Math.abs(v - Rq.flat()[i]) < 1e-3, `${i}`))
	})
})

describe('WO-1106 B5 — venue import: zip budget before inflating, capped entries, one picture at a time', () => {
	const fs = require('fs')
	const os = require('os')
	const path = require('path')
	const JSZip = require('jszip')
	const { gather, ZIP_LIMITS } = require('../../src/stage/venue-sources')
	const { shrinkImages } = require('../../src/stage/scene-tex')
	const { RESOURCE_LIMITS } = require('../../src/stage/venue-import-worker')
	const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-b5-'))
	require('node:test').after(() => fs.rmSync(TMP, { recursive: true, force: true }))
	const zipIn = async (name, files, opts = {}) => {
		const dir = fs.mkdtempSync(path.join(TMP, 'u-'))
		const z = new JSZip()
		for (const [n, d] of Object.entries(files)) z.file(n, d)
		let buf = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
		if (opts.patch) buf = opts.patch(buf)
		fs.writeFileSync(path.join(dir, name), buf)
		return dir
	}

	it('defaults: 2 GB declared per upload, 20 000 entries per zip; the worker gets a generous heap limit', () => {
		assert.deepEqual(ZIP_LIMITS, { bytes: 2 * 1024 ** 3, entries: 20000 })
		assert.ok(RESOURCE_LIMITS.maxOldGenerationSizeMb >= 2048)
	})

	it('too many entries / too many declared bytes → the zip is refused before anything is inflated', async () => {
		let src = await gather(await zipIn('a.zip', { 'a.obj': 'v 0 0 0', 'b.txt': 'x', 'c.txt': 'y' }), { bytes: 1e9, entries: 2 })
		assert.equal(src.files.length, 0)
		assert.match(src.errors[0], /a\.zip: not a readable ZIP \(3 entries, more than 2\)/)
		// 4 MB of zeros: a few KB compressed, 4 MB declared — over a 1 MB budget
		src = await gather(await zipIn('bomb.zip', { 'big.obj': Buffer.alloc(4 << 20) }), { bytes: 1 << 20, entries: 10 })
		assert.equal(src.files.length, 0)
		assert.match(src.errors[0], /unpacks to .* GB, over the .* GB an upload may unpack to/)
		// the budget is per upload: two zips of 600 KB declared each against 1 MB
		const dir = await zipIn('one.zip', { 'one.obj': Buffer.alloc(600 << 10) })
		fs.copyFileSync(path.join(dir, 'one.zip'), path.join(dir, 'two.zip'))
		src = await gather(dir, { bytes: 1 << 20, entries: 10 })
		assert.equal(src.files.length, 1)
		assert.equal(src.errors.length, 1)
	})

	it('an entry whose header under-declares its size stops at the declared size (read and stream)', async () => {
		const data = Buffer.alloc(256 << 10, 7)
		const lie = 1000
		const patch = (buf) => {
			const b = Buffer.from(buf)
			for (let i = 0; i + 4 < b.length; i++) {
				const sig = b.readUInt32LE(i)
				if (sig === 0x04034b50) b.writeUInt32LE(lie, i + 22) // local header uncompressed size
				if (sig === 0x02014b50) b.writeUInt32LE(lie, i + 24) // central directory uncompressed size
			}
			return b
		}
		const src = await gather(await zipIn('lie.zip', { 'lie.obj': data }, { patch }))
		const f = src.files.find((x) => x.rel === 'lie.obj')
		assert.equal(f.size, lie)
		await assert.rejects(f.read(), /unpacks past its declared 1000 bytes/)
		await assert.rejects(new Promise((resolve, reject) => {
			const s = f.stream()
			s.on('data', () => {})
			s.on('end', resolve)
			s.on('error', reject)
		}), /unpacks past its declared/)
	})

	it('shrinkImages with `load`: each picture is read when it is encoded, never all at once', async () => {
		const log = []
		const img = (i) => ({ load: async () => {
			log.push(`load ${i}`)
			return { data: Buffer.from(`picture ${i}`.padEnd(64, '.')), mime: 'image/jpeg' }
		} })
		const encode = async (data) => {
			log.push(`encode ${data.toString().slice(0, 9)}`)
			return { data: data.subarray(0, 20), mime: 'image/jpeg' }
		}
		const out = await shrinkImages([img(1), null, img(2), { data: Buffer.from('picture 3'.padEnd(64, '.')), mime: 'image/jpeg' }], { encode, pause: async () => {} })
		assert.deepEqual(log, ['load 1', 'encode picture 1', 'load 2', 'encode picture 2', 'encode picture 3'])
		assert.deepEqual(out.map((o) => (o ? o.data.length : null)), [20, null, 20, 20])
	})
})

describe('WO-1106 B20 — venue import worker: cancel kills its ffmpeg children before it ends', () => {
	it('a cancel message during the picture phase kills the running ffmpeg, replies, and the worker exits', async () => {
		const fs = require('fs')
		const os = require('os')
		const path = require('path')
		const { Worker } = require('worker_threads')
		const { PNG } = require('pngjs')
		const { RESOURCE_LIMITS } = require('../../src/stage/venue-import-worker')
		const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-b20-'))
		const bin = path.join(TMP, 'bin')
		const dir = path.join(TMP, 'up')
		const pids = path.join(TMP, 'pids')
		fs.mkdirSync(bin)
		fs.mkdirSync(dir)
		fs.writeFileSync(path.join(bin, 'ffmpeg'), '#!/bin/sh\necho $$ >> "$WO1106_PIDS"\nexec sleep 30\n', { mode: 0o755 })
		const p = new PNG({ width: 4, height: 4 })
		p.data.fill(200)
		fs.writeFileSync(path.join(dir, 'photo.png'), PNG.sync.write(p))
		fs.writeFileSync(path.join(dir, 'a.mtl'), 'newmtl Photo\nKd 1 1 1\nmap_Kd photo.png\n')
		fs.writeFileSync(path.join(dir, 'a.obj'), ['mtllib a.mtl', 'v 0 0 0', 'v 4 0 0', 'v 4 3 0', 'v 0 3 0', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
			'g Wall', 'usemtl Photo', 'f 1/1 2/2 3/3 4/4'].join('\n'))
		const alive = (pid) => {
			try {
				return !/^\S+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'))
			} catch {
				return false
			}
		}
		const w = new Worker(path.join(__dirname, '../../src/stage/venue-import-worker.js'), { workerData: { dir, opts: { units: 'm' } },
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, WO1106_PIDS: pids }, resourceLimits: RESOURCE_LIMITS })
		const msgs = []
		w.on('message', (m) => msgs.push(m))
		const exited = new Promise((resolve) => w.on('exit', resolve))
		try {
			for (let i = 0; i < 200 && !fs.existsSync(pids); i++) await new Promise((r) => setTimeout(r, 25))
			const pid = Number(fs.readFileSync(pids, 'utf8').trim().split('\n')[0])
			assert.ok(alive(pid), 'the (fake) ffmpeg is running')
			w.postMessage({ type: 'cancel' })
			const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 3000))])
			assert.equal(code, 0, 'the worker ended itself')
			assert.deepEqual(msgs.find((m) => m.type === 'cancelled'), { type: 'cancelled', killed: 1 })
			for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 25))
			assert.equal(alive(pid), false, 'no orphaned ffmpeg')
		} finally {
			await w.terminate()
			for (const pid of fs.existsSync(pids) ? fs.readFileSync(pids, 'utf8').trim().split('\n').map(Number) : []) {
				try {
					process.kill(pid, 'SIGKILL')
				} catch {
					/* gone */
				}
			}
			fs.rmSync(TMP, { recursive: true, force: true })
		}
	})
})

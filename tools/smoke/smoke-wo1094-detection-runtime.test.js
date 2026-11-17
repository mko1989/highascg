'use strict'
/**
 * WO-1094 — the person-detection runtime installed from the GUI: status verdicts (runtime-status.js), the background job
 * (runtime-job.js: progress lines, one at a time, cancel, interrupted after a restart), install.sh dry-run, the API
 * guards (scratch prefix, test hooks, refused destinations), and the owner's rule that none of it is ever distributed
 * (ISO excludes + verifier, exFAT pairs, stick seeding, Syncthing, git). Runtime writes go to os.tmpdir() only.
 */
const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const SRC = path.join(ROOT, 'src')
const { evaluate, summaryLine } = require(path.join(SRC, 'tracking', 'runtime-status'))
const { RuntimeJob, createJobs } = require(path.join(SRC, 'tracking', 'runtime-job'))
const { loadFeatures, checkPrefix, runtimePaths } = require(path.join(SRC, 'tracking', 'runtime-paths'))
const { isExcluded } = require(path.join(SRC, 'system', 'exfat-sync-map'))
const routesMod = require(path.join(SRC, 'api', 'routes-tracking-runtime'))

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1094-'))
after(() => fs.rmSync(TMP, { recursive: true, force: true }))
const spec = loadFeatures()
const big = { bytes: 9e6, mtime: 1 }
const allModels = Object.fromEntries(['yolo26n.onnx', 'yolo26s.onnx', 'yolo26n-pose.onnx', 'yolo26n-seg.onnx'].map((m) => [m, big]))
const imports = { numpy: { ok: true, version: '2.5.4' }, cv2: { ok: true, version: '5.0.0' }, onnxruntime: { ok: true, version: '1.31.0' } }
const okFacts = (over = {}) => ({ system: { version: '3.14.4' }, venv: { exists: true, python: true, cfgVersion: '3.14.4', libDirs: ['python3.14'] },
	probe: { ok: true, version: '3.14.4', imports, providers: ['CPUExecutionProvider'] }, models: allModels, partial: [], ...over })

describe('WO-1094 status model', () => {
	it('features.json: person / pose / seg on by default, faces opt-in, every YOLO feature AGPL', () => {
		const f = spec.features
		assert.deepEqual(Object.keys(f).sort(), ['face', 'person', 'pose', 'seg', 'traits'])
		assert.deepEqual(Object.keys(f).filter((k) => f[k].default).sort(), ['person', 'pose', 'seg'])
		for (const k of ['person', 'pose', 'seg']) assert.match(f[k].license, /AGPL-3\.0/)
		assert.deepEqual(spec.core.imports, ['numpy', 'cv2', 'onnxruntime'])
	})
	it('nothing installed → missing, in the first-run words', () => {
		const st = evaluate({ system: { version: '3.14.4' }, venv: { exists: false }, models: {} }, spec)
		assert.equal(st.verdict, 'missing')
		assert.equal(st.reason, 'Person detection is not installed on this machine')
		assert.equal(summaryLine(st), 'Person detection on this machine: not installed. Install it in Previs → Tracking → Detect.')
	})
	it('no python3 at all → the apt command', () => {
		const st = evaluate({ system: { version: null }, venv: { exists: false }, models: {} }, spec)
		assert.equal(st.apt, 'sudo apt install python3')
	})
	it('a venv for another Python (the 3.12 → 3.14 upgrade) → broken, Repair', () => {
		const st = evaluate(okFacts({ venv: { exists: true, python: true, cfgVersion: '3.12.3', libDirs: ['python3.12'] }, probe: null }), spec)
		assert.equal(st.verdict, 'broken')
		assert.equal(st.reason, 'venv built for Python 3.12, the system has 3.14 — Repair rebuilds it')
		assert.match(summaryLine(st), /needs repair .* Repair it in Previs/)
	})
	it('a package that will not import → broken, names it', () => {
		const st = evaluate(okFacts({ probe: { ok: true, version: '3.14.4', imports: { ...imports, cv2: { ok: false, error: 'libGL.so.1' } } } }), spec)
		assert.equal(st.verdict, 'broken')
		assert.equal(st.reason, 'cv2 will not import: libGL.so.1 — Repair reinstalls it')
	})
	it('all there → ready (CPU), bytes summed; faces stay optional', () => {
		const st = evaluate(okFacts(), spec)
		assert.equal(st.verdict, 'ready')
		assert.equal(st.core.gpu, false)
		assert.equal(st.features.find((x) => x.id === 'face').state, 'missing')
		assert.equal(st.features.find((x) => x.id === 'traits').state, 'ready')
		assert.equal(summaryLine(st), 'Person detection on this machine: installed (CPU). Manage it in Previs → Tracking → Detect.')
	})
	it('a default feature missing → partial; a truncated model → that feature broken; a .part → download incomplete', () => {
		const { 'yolo26n-seg.onnx': _s, ...noSeg } = allModels
		const st = evaluate(okFacts({ models: noSeg, partial: ['yolo26n-seg.onnx'] }), spec)
		assert.equal(st.verdict, 'partial')
		assert.equal(st.reason, 'Cut-outs: yolo26n-seg.onnx: download incomplete')
		const tr = evaluate(okFacts({ models: { ...allModels, 'yolo26n-pose.onnx': { bytes: 500, mtime: 1 } } }), spec)
		assert.equal(tr.features.find((x) => x.id === 'pose').state, 'broken')
		const noPerson = evaluate(okFacts({ models: {} }), spec)
		assert.equal(noPerson.verdict, 'missing')
	})
})

describe('WO-1094 install job', () => {
	it('progress lines → plan, step, monotonic percent, done, error with apt; colours stripped', () => {
		const j = new RuntimeJob('install', [], TMP)
		j.line('@@ {"plan":["preflight","core"]}')
		j.line('@@ {"step":"preflight","label":"Checking"}')
		assert.equal(j.percent, 0)
		j.line('@@ {"done":"preflight"}')
		j.line('@@ {"step":"core","label":"Python packages"}')
		j.line('@@ {"pct":60}')
		j.line('@@ {"pct":20}') // pip's next file starts at 0 again: never back
		assert.equal(j.percent, 80)
		j.line('\x1b[31m\x1b[1mrequirements:\x1b[0m hello')
		assert.equal(j.log.at(-1), 'requirements: hello')
		j.line('@@ {"error":13,"msg":"needs GL","apt":"sudo apt install libgl1 libglib2.0-0t64"}')
		j.finish(13, null)
		const s = j.snapshot()
		assert.deepEqual([s.state, s.code, s.error, s.apt, s.resumable], ['error', 13, 'needs GL', 'sudo apt install libgl1 libglib2.0-0t64', true])
	})
	it('a script that dies without its own error line says which step', () => {
		const j = new RuntimeJob('install', [], TMP)
		j.line('@@ {"plan":["core"]}')
		j.line('@@ {"step":"core","label":"Python packages"}')
		j.line('creating the venv')
		j.finish(1, null)
		assert.equal(j.error, 'Python packages stopped unexpectedly (exit 1): creating the venv')
	})
	it('a real child: one job at a time, cancel → cancelled, persisted; a dead "running" job restores as interrupted', async () => {
		const script = path.join(TMP, 'fake-install.sh')
		fs.writeFileSync(script, 'trap \'echo "@@ {\\"cancelled\\":true}"; exit 143\' TERM\necho \'@@ {"plan":["a"]}\'\necho \'@@ {"step":"a","label":"A"}\'\nwhile :; do sleep 0.1; done\n')
		const prefix = path.join(TMP, 'p1')
		let ended = null
		const jobs = createJobs({ script, onEnd: (j) => (ended = j) })
		assert.equal(jobs.start('install', [], prefix).status, 202)
		assert.equal(jobs.start('repair', [], prefix).status, 409)
		for (let i = 0; i < 50 && jobs.job.step !== 'a'; i++) await new Promise((r) => setTimeout(r, 50))
		assert.equal(jobs.job.step, 'a')
		assert.equal(jobs.cancel().status, 200)
		for (let i = 0; i < 100 && !ended; i++) await new Promise((r) => setTimeout(r, 50))
		assert.equal(ended?.state, 'cancelled')
		assert.equal(JSON.parse(fs.readFileSync(runtimePaths(prefix).state, 'utf8')).state, 'cancelled')
		assert.match(fs.readFileSync(runtimePaths(prefix).log, 'utf8'), /=== cancelled/)
		const p2 = path.join(TMP, 'p2')
		fs.mkdirSync(p2)
		fs.writeFileSync(runtimePaths(p2).state, JSON.stringify({ kind: 'install', args: ['--features', 'person'], state: 'running', pid: 2 ** 22 + 7, plan: ['a'], done: [] }))
		const r = createJobs({ script }).restore(p2)
		assert.equal(r.state, 'interrupted')
		assert.equal(r.snapshot().resumable, true)
	})
})

describe('WO-1094 scripts', () => {
	const env = (p, extra = {}) => ({ ...process.env, HIGHASCG_TRACKING_PREFIX: p, HIGHASCG_TRACKING_DRY_RUN: '1', ...extra })
	it('install.sh --dry-run: the plan, the export through CPU PyTorch, nothing written', () => {
		const p = path.join(TMP, 'dry')
		const out = execFileSync('bash', [path.join(ROOT, 'tools/tracking-detect/install.sh'), '--features', 'person,pose'], { env: env(p, { HIGHASCG_TRACKING_FREE_MB: '99999' }), encoding: 'utf8' })
		assert.match(out, /^@@ \{"plan":\["preflight","core","exporter","model:yolo26n","model:yolo26s","model:yolo26n-pose"\]\}/)
		assert.match(out, /--index-url https:\/\/download\.pytorch\.org\/whl\/cpu torch torchvision/)
		assert.match(out, /python3 -m venv --without-pip --clear /)
		assert.match(out, /@@ \{"ok":true\}/)
		assert.equal(fs.existsSync(p), false, 'a dry run writes nothing')
	})
	it('low disk is refused before anything is downloaded (exit 11)', () => {
		const r = spawnSync('bash', [path.join(ROOT, 'tools/tracking-detect/install.sh')], { env: env(path.join(TMP, 'low'), { HIGHASCG_TRACKING_FREE_MB: '300' }), encoding: 'utf8' })
		assert.equal(r.status, 11)
		assert.match(r.stdout, /"error":11,"msg":"not enough disk space for the detection runtime: needs [\d.]+ GB free/)
	})
	it('an export into the repo is refused (exit 30); a bundle for another Python is refused', () => {
		const r = spawnSync('bash', [path.join(ROOT, 'tools/tracking-detect/install.sh'), '--export-to', path.join(ROOT, 'projects')], { env: env(path.join(TMP, 'ex')), encoding: 'utf8' })
		assert.equal(r.status, 30)
		const b = path.join(TMP, 'b312', 'highascg-detection-runtime')
		fs.mkdirSync(b, { recursive: true })
		fs.writeFileSync(path.join(b, 'manifest.json'), JSON.stringify({ kind: 'highascg-detection-runtime', python: '2.7' }))
		const r2 = spawnSync('bash', [path.join(ROOT, 'tools/tracking-detect/install.sh'), '--from', path.dirname(b)], { env: env(path.join(TMP, 'im')), encoding: 'utf8' })
		assert.equal(r2.status, 30)
		assert.match(r2.stdout, /the bundle was made for Python 2\.7/)
	})
})

describe('WO-1094 API guards', () => {
	const h = {}
	routesMod.register({ get: (p, fn) => (h['GET ' + p] = fn), post: (p, fn) => (h['POST ' + p] = fn) })
	// WO-1106 B1: install / import answer only on the box itself (or with the password) — these calls come from the box
	const BOX = { socket: { remoteAddress: '127.0.0.1', localPort: 4200 }, headers: { host: '127.0.0.1:4200' } }
	const call = async (k, body, query = {}) => {
		const r = await h[k]({ query, body: JSON.stringify(body), req: BOX, ctx: { config: {} } })
		return { status: r.status, body: JSON.parse(r.body) }
	}
	it('all routes registered as core routes', () => {
		assert.deepEqual(Object.keys(h).sort(), ['GET /api/tracking/runtime', 'GET /api/tracking/runtime/folders', 'POST /api/tracking/runtime/cancel',
			'POST /api/tracking/runtime/export', 'POST /api/tracking/runtime/import', 'POST /api/tracking/runtime/install',
			'POST /api/tracking/runtime/remove', 'POST /api/tracking/runtime/repair', 'POST /api/tracking/runtime/resume'])
		assert.match(read('src/api/router.js'), /require\('\.\/routes-tracking-runtime'\)\.register\(routes\)/)
	})
	it('prefixes: absolute, outside the repo, under home or temp', () => {
		assert.match(checkPrefix('rel/x'), /absolute/)
		assert.match(checkPrefix(path.join(ROOT, 'x')), /outside the HighAsCG folder/)
		assert.match(checkPrefix('/etc/x'), /under the home or the temp folder/)
		assert.equal(checkPrefix(path.join(TMP, 'ok')), '')
	})
	it('test hooks only with a scratch prefix; unknown features refused; nothing to resume', async () => {
		assert.deepEqual(await call('POST /api/tracking/runtime/install', { test: { free_mb: 1 } }), { status: 400, body: { error: 'test hooks need a scratch prefix' } })
		assert.equal((await call('POST /api/tracking/runtime/install', { prefix: path.join(TMP, 'f'), features: ['eyes'] })).body.error, 'unknown feature(s): eyes')
		assert.equal((await call('POST /api/tracking/runtime/resume', { prefix: path.join(TMP, 'none') })).status, 409)
		assert.equal((await call('POST /api/tracking/runtime/cancel', {})).status, 409)
	})
	it('a bundle never goes into the repo or a sync pair', () => {
		assert.match(routesMod.checkDest(path.join(ROOT, 'media')), /synced to other machines/)
		assert.match(routesMod.checkDest('relative'), /absolute/)
		assert.equal(routesMod.checkDest(path.join(TMP, 'stick')), '')
	})
})

describe('WO-1094: never distributed (owner: "we cant bake anything into iso that i have no right to distribute")', () => {
	const LISTS = ['tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list', 'tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list']
	const WANT = ['home/*/.local/share/highascg', 'home/*/.local/share/highascg/*', 'root/.local/share/highascg', 'root/.local/share/highascg/*',
		'home/*/.cache/pip', 'home/*/.cache/pip/*', 'root/.cache/pip', 'root/.cache/pip/*', 'home/*/.config/Ultralytics', 'home/*/.config/Ultralytics/*',
		'home/*/highascg-detection-runtime', 'home/*/highascg-detection-runtime/*']
	it('both eggs exclude lists and the generated custom.exclude.list carry every runtime path', () => {
		for (const l of LISTS) {
			const lines = read(l).split('\n')
			for (const w of WANT) assert.ok(lines.includes(w), `${l}: ${w}`)
		}
		const gen = execFileSync('node', [path.join(ROOT, 'tools/eggs/live-usb/generate-eggs-config.js'), 'exclude', '--embed', '1'], { encoding: 'utf8' }).split('\n')
		for (const w of WANT) assert.ok(gen.includes(w), `generated: ${w}`)
	})
	const VERIFY = path.join(ROOT, 'tools/eggs/live-usb/verify-iso-detection-runtime.sh')
	const verify = (lines) => {
		const f = path.join(TMP, `list-${Math.random()}.txt`)
		fs.writeFileSync(f, lines.join('\n') + '\n')
		return spawnSync('bash', [VERIFY, f], { encoding: 'utf8' })
	}
	it('the ISO verifier fails on weights, the venv, bundles and caches — not on Midnight Commander\'s mc.hint.pt', () => {
		const clean = ['squashfs-root/usr/share/mc/hints/mc.hint.pt', 'squashfs-root/home/casparcg/highascg/tools/tracking-detect/detector.py', 'squashfs-root/usr/lib/x.ptx']
		assert.equal(verify(clean).status, 0)
		for (const bad of ['squashfs-root/home/casparcg/.local/share/highascg/models/yolo26n.onnx', 'squashfs-root/opt/x/face.onnx',
			'squashfs-root/home/casparcg/.local/share/highascg', 'squashfs-root/home/casparcg/x/tracking-venv/bin/python',
			'squashfs-root/home/casparcg/media/highascg-detection-runtime/manifest.json', 'squashfs-root/root/.cache/pip/http/x',
			'squashfs-root/home/casparcg/.config/Ultralytics/settings.json', 'squashfs-root/home/casparcg/yolo26n.pt', 'squashfs-root/usr/share/yolo11n.pt']) {
			const r = verify([...clean, bad])
			assert.equal(r.status, 1, bad)
			assert.ok(r.stderr.includes(bad), bad)
		}
	})
	it('the verifier runs a real squashfs of a synthetic tree (when mksquashfs is there)', (t) => {
		if (spawnSync('sh', ['-c', 'command -v mksquashfs && command -v unsquashfs']).status !== 0) return t.skip('no squashfs-tools')
		const tree = path.join(TMP, 'tree')
		fs.mkdirSync(path.join(tree, 'home/casparcg/.local/share/highascg/models'), { recursive: true })
		fs.writeFileSync(path.join(tree, 'home/casparcg/.local/share/highascg/models/yolo26n.onnx'), 'x')
		const img = path.join(TMP, 'img.squashfs')
		execFileSync('mksquashfs', [tree, img, '-quiet', '-noappend', '-no-progress'])
		assert.equal(spawnSync('bash', [VERIFY, img], { encoding: 'utf8' }).status, 1)
		fs.rmSync(path.join(tree, 'home/casparcg/.local'), { recursive: true })
		execFileSync('mksquashfs', [tree, img, '-quiet', '-noappend', '-no-progress'])
		assert.equal(spawnSync('bash', [VERIFY, img], { encoding: 'utf8' }).status, 0)
	})
	it('the build verifier calls it', () => {
		const v = read('tools/eggs/live-usb/verify-iso-squashfs-excludes.sh')
		assert.match(v, /source "\$\{HERE_VERIFY\}\/verify-iso-detection-runtime\.sh"/)
		assert.match(v, /^detection_runtime_check /m)
	})
	it('exFAT / bridge pairs never carry a bundle or a weight, whatever the map says', () => {
		assert.equal(isExcluded('highascg-detection-runtime/models/yolo26n.onnx', []), true)
		assert.equal(isExcluded('show/x/highascg-detection-runtime/manifest.json', []), true)
		assert.equal(isExcluded('models/face.ONNX', []), true)
		assert.equal(isExcluded('weights/yolo26n.pt', []), true)
		assert.equal(isExcluded('projects/show.json', []), false)
	})
	it('stick seeding, server updates, Syncthing and git exclude them', () => {
		for (const f of ['config/bootstrap-rsync-excludes.txt', 'config/server-update-rsync-excludes.txt']) {
			const lines = read(f).split('\n')
			for (const w of ['highascg-detection-runtime/', '*.onnx', '*.pt']) assert.ok(lines.includes(w), `${f}: ${w}`)
		}
		const st = read('.stignore').split('\n')
		for (const w of ['highascg-detection-runtime', '*.onnx', '*.pt']) assert.ok(st.includes(w), `.stignore: ${w}`)
		const gi = read('.gitignore').split('\n')
		for (const w of ['highascg-detection-runtime/', '*.onnx', '*.pt']) assert.ok(gi.includes(w), `.gitignore: ${w}`)
	})
	it('THIRD_PARTY_NOTICES names every downloaded model with its licence', () => {
		const n = read('THIRD_PARTY_NOTICES')
		for (const w of ['yolo26n-pose', 'yolo26n-seg', 'AGPL-3.0', 'YuNet', 'License: MIT', 'SFace', 'youtureid', 'research use only', 'download.pytorch.org/whl/cpu', 'NOT shipped'])
			assert.ok(n.includes(w), w)
	})
})

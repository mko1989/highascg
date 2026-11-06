'use strict'

/**
 * WO-979 — the role-split test environment: a MEDIA server (playout) and a TRACKING server (camera tracking, previs,
 * lighting / PSN) linked node ↔ node (tools/e2e/duties-scenario.js via run-cluster-e2e.js --scenario=duties).
 *   units  the fake detection sidecar speaks the sidecar protocol; the fixture's shows stay on this machine (PSN on an
 *          admin-scoped group out of loopback, no DMX patch) and give the tracking duty to the tracking show only;
 *          cluster-exchange drop() (unlink clears the other server's data at once, RULES "Linked servers" 4)
 *   e2e    every scenario step on two throwaway sandbox servers (≈25 s)
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const fixture = require('../e2e/duties-fixture')
const { boxOf } = require('../test-env/fake-detect-sidecar')
const { normalizeDetection, detectCameras } = require('../../src/tracking/detect-model')
const { normalizeAirRules } = require('../../src/tracking/air-rules')
const { parseAction } = require('../../src/tracking/zone-actions')
const { createExchange } = require('../../src/cluster/cluster-exchange')

describe('WO-979 fake detection sidecar', () => {
	it('answers a config with ready, then tracks per camera; exits when stdin closes', async () => {
		const child = spawn(process.execPath, [fixture.SIDECAR, '-u', 'ignored.py'], { stdio: ['pipe', 'pipe', 'ignore'] })
		const lines = []
		let buf = ''
		child.stdout.on('data', (d) => {
			buf += d
			for (let nl; (nl = buf.indexOf('\n')) >= 0; buf = buf.slice(nl + 1)) lines.push(JSON.parse(buf.slice(0, nl)))
		})
		child.stdin.write(
			JSON.stringify({
				type: 'config',
				model: '/x/fake.onnx',
				interval_ms: 40,
				cameras: [{ id: 'cam_a' }, { id: 'cam_b' }],
			}) + '\n'
		)
		const until = Date.now() + 5000
		while (Date.now() < until && lines.filter((l) => l.type === 'tracks').length < 4)
			await new Promise((r) => setTimeout(r, 20))
		const exited = new Promise((r) => child.once('exit', (code) => r(code)))
		child.stdin.end()
		assert.equal(await exited, 0)
		assert.equal(lines[0].type, 'ready')
		const tracks = lines.filter((l) => l.type === 'tracks')
		assert.deepEqual([...new Set(tracks.map((t) => t.camera))].sort(), ['cam_a', 'cam_b'])
		const t = tracks[0].tracks[0]
		assert.equal(t.tid, 1)
		assert.equal(t.box.length, 4)
		assert.ok(t.box.every((v) => v >= 0 && v <= 1))
	})
	it('the person walks (the box moves over time, stays in the picture)', () => {
		const a = boxOf(0, 0)
		const b = boxOf(0, 3)
		assert.notDeepEqual(a, b)
		for (let s = 0; s < 40; s += 0.7) assert.ok(boxOf(0, s).every((v) => v >= 0 && v <= 1))
	})
})

describe('WO-979 the two shows stay on this machine', () => {
	const shows = [fixture.mediaProject(40001), fixture.trackingProject(40002)]
	it('PSN on an admin-scoped group out of loopback, never the desk default; no DMX patch', () => {
		for (const p of shows) {
			const o = p.fixtures.output
			assert.equal(o.protocol, 'psn')
			assert.equal(o.psn.group, fixture.GROUP)
			assert.notEqual(o.psn.group, '236.10.10.10')
			assert.match(o.psn.group, /^239\.255\./)
			assert.equal(o.psn.iface, '127.0.0.1')
			assert.deepEqual(p.fixtures.patch, [])
			assert.equal(p.name, p.slug, 'a save re-slugs from the name')
		}
		assert.notEqual(shows[0].fixtures.output.psn.port, shows[1].fixtures.output.psn.port)
	})
	it('only the tracking show tracks (detection on + a camera); its rules parse', () => {
		const tracks = (p) => {
			const det = normalizeDetection(p.previs?.tracking?.detection)
			return det.enabled && detectCameras(p.previs?.tracking, det).length > 0
		}
		assert.equal(tracks(shows[0]), false)
		assert.equal(tracks(shows[1]), true)
		const rules = normalizeAirRules(shows[1].previs.tracking.zones.on_air)
		assert.equal(rules.length, 2)
		assert.deepEqual(
			rules.map((r) => parseAction(r.do).type),
			['auto-home', 'look']
		)
		assert.ok(
			shows[0].scenes.scenes.some((s) => s.id === parseAction(rules[1].do).sceneId),
			"the rule's look is on the media server"
		)
	})
	it('the tracking role points detect-service at the fake sidecar and a model file that exists', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wo979-opts-'))
		try {
			const o = fixture.sandboxOptions('tracking', root)
			assert.equal(o.env.HIGHASCG_TRACKING_PYTHON, fixture.SIDECAR)
			assert.ok(fs.existsSync(path.join(o.env.HIGHASCG_TRACKING_MODELS, fixture.MODEL)))
			assert.equal(o.tracking, true)
			const m = fixture.sandboxOptions('media', root)
			assert.equal(m.config.screenDestinations.destinations.length, 1)
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("WO-979 unlink drops the other server's exchange data at once (RULES Linked servers 4)", () => {
	it('drop(peer) broadcasts gone once per topic, hands onData an empty one, and forgets only that server', () => {
		const sent = []
		const data = []
		const x = createExchange({
			peers: () => [],
			has: (d) => d === 'zones',
			call: async () => ({ ok: true }),
			broadcast: (t, d) => sent.push([t, d]),
			onData: (t, d, s) => data.push([t, d, s.id]),
		})
		assert.equal(
			x.receive('air', { program: [{ channel: 1, sceneId: 'a', name: 'A' }] }, { id: 'media', name: 'Media' }).status,
			200
		)
		assert.equal(x.receive('air', { program: [] }, { id: 'other', name: 'Other' }).status, 200)
		sent.length = 0
		data.length = 0
		assert.equal(x.drop('media'), 1)
		assert.deepEqual(sent, [['cluster:air', { program: [], source: { id: 'media', name: 'Media' }, gone: true }]])
		assert.deepEqual(data, [['air', { program: [] }, 'media']])
		assert.deepEqual(
			x.view().sources.map((s) => s.source.id),
			['other']
		)
		assert.equal(x.drop('media'), 0, 'twice is nothing')
	})
	it('routes-cluster calls it on every removal (unlink here, there, the repair)', () => {
		assert.match(
			read('src/api/routes-cluster.js'),
			/function removed\(ctx, saved\) \{\n\tctx\._clusterMaster\?\.dropped\(saved\)\n\tif \(saved\?\.id\) ctx\._clusterExchange\?\.drop\(saved\.id\)/
		)
	})
	it('run-cluster-e2e runs the duties scenario with per-role sandboxes and --peer', () => {
		const src = read('tools/e2e/run-cluster-e2e.js')
		assert.match(src, /scenario === 'duties' \? \['sb-media', 'sb-tracking'\]/)
		assert.match(src, /dutiesFixture\.sandboxOptions\(id === 'sb-media' \? 'media' : 'tracking', root\)/)
		assert.match(src, /if \(peer\) live = peerPair\(peer, arg\('self', 'media'\)\)\.join\(','\)/)
	})
})

describe('WO-979 role split end to end on two sandbox servers', { timeout: 240000 }, () => {
	const { startSandboxNodes } = require('../e2e/cluster-nodes')
	const { runDutiesScenario, steps } = require('../e2e/duties-scenario')
	let tmp, nodes, prep, results
	before(async () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo979-roles-'))
		nodes = await startSandboxNodes(tmp, ['sb-media', 'sb-tracking'], {
			extra: (id, root) => fixture.sandboxOptions(id === 'sb-media' ? 'media' : 'tracking', root),
		})
		prep = await fixture.prepare(nodes)
		results = await runDutiesScenario(nodes, { ears: prep.ears })
	})
	after(async () => {
		if (prep) await prep.stop()
		if (nodes) await Promise.all(nodes.map((n) => n.stop()))
		if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
	})
	for (const s of steps) {
		it(s.name, () => {
			const r = results.find((x) => x.step === s.name)
			assert.ok(r, 'step ran')
			assert.equal(r.status, 'pass', r.error || r.reason)
		})
	}
})

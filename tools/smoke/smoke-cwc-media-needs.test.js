'use strict'

/**
 * WO-1029 plan 07 C10 — which media each destination's owners need and lack (cluster-media-needs.js, pure).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { computeNeeds, sharedLibrary, mediaMissingForTake } = require('../../src/cluster/cluster-media-needs')

const F = (p, s = 100, m = 1000) => ({ p, id: p.replace(/\.[a-z0-9]+$/i, '').toUpperCase(), s, m })
const SERVERS = [
	{ id: 'A', name: 'boxA', self: true, online: true },
	{ id: 'B', name: 'boxB', self: false, online: true },
]
const DESTS = [
	{ id: 'd1', label: 'LED wall', main: 0, owners: ['A'] },
	{ id: 'd2', label: 'Stream PGM', main: 1, owners: ['B'] },
	{ id: 'd3', label: 'Spare', main: 2, owners: [] },
]
const look = (id, scope, clips, extra = {}) => ({ id, name: `Look ${id}`, ...(scope == null ? {} : { mainScope: String(scope) }), layers: clips.map((c, i) => ({ layerNumber: 10 + i, source: { type: 'file', value: c } })), ...extra })
const inv = (map) => (id) => map[id] || { known: false, reason: 'old build' }
const run = (project, invs, extra = {}) => computeNeeds({ project, destinations: DESTS, servers: SERVERS, inventory: inv(invs), now: () => 1, ...extra })
const row = (n, id) => n.files.find((f) => f.id === id)

describe('WO-1029 C10 media needs', () => {
	it('a look on screen 2 (owned by B) uses clip X, only A has it → X needed and missing on B', () => {
		const n = run({ scenes: [look('l2', 1, ['TESTOWE/BIG_BUCK_BUNNY_1080P24'])] }, {
			A: { known: true, files: [F('TESTOWE/big_buck_bunny_1080p24.mp4', 500)] },
			B: { known: true, files: [] },
		})
		const x = row(n, 'TESTOWE/BIG_BUCK_BUNNY_1080P24')
		assert.ok(x)
		assert.deepEqual(x.on, ['A'])
		assert.deepEqual(x.missing_on, ['B'])
		assert.deepEqual(x.needed_on, [{ server: 'B', destinations: [{ id: 'd2', label: 'Stream PGM' }], looks: ['Look l2'], timelines: [] }])
		assert.equal(x.path, 'TESTOWE/big_buck_bunny_1080p24.mp4')
		assert.equal(x.spreadable, true)
		assert.equal(x.source, 'A')
		assert.deepEqual(x.send_from.B, { server: 'A', path: 'TESTOWE/big_buck_bunny_1080p24.mp4', size: 500, mtime: 1000 })
		assert.equal(n.summary.missing_files, 1)
		assert.equal(n.summary.missing_bytes, 500)
		assert.deepEqual(n.summary.by_server, { B: { files: 1, bytes: 500, differs: 0 } })
		assert.deepEqual(n.summary.to_send, { transfers: 1, files: 1, bytes: 500 })
		assert.deepEqual(n.looks, [{ id: 'l2', name: 'Look l2', missing: [{ file: 'TESTOWE/BIG_BUCK_BUNNY_1080P24', server: 'B', server_name: 'boxB', destination: 'd2', screen: 1 }], differs: [] }])
		assert.deepEqual(mediaMissingForTake(n, 'l2', 1), [{ id: 'TESTOWE/BIG_BUCK_BUNNY_1080P24', server: 'B', server_name: 'boxB' }])
		assert.deepEqual(mediaMissingForTake(n, 'l2', 0), [])
	})

	it('a look scoped to all screens (or unscoped) needs its media on every owner', () => {
		for (const scope of ['all', null]) {
			const n = run({ scenes: [look('la', scope, ['clip'])] }, { A: { known: true, files: [] }, B: { known: true, files: [F('clip.mov')] } })
			const x = row(n, 'CLIP')
			assert.deepEqual(x.needed_on.map((e) => e.server).sort(), ['A', 'B'])
			assert.deepEqual(x.missing_on, ['A'])
			assert.equal(x.source, 'B')
		}
	})

	it('playlist items and timeline clips count; a timeline layer pinned to screen 1 needs it on A only', () => {
		const project = {
			scenes: { scenes: [look('lp', 1, [], { layers: [{ source: { type: 'file', value: 'first' }, playlist: [{ type: 'file', value: 'second' }, { type: 'empty', value: '' }] }] })] },
			timelines: { timelines: [
				{ id: 't1', name: 'Show TL', sendTo: { screenIdx: 1 }, layers: [{ clips: [{ source: { type: 'file', value: 'tl_clip' } }] }, { screenIdx: 0, clips: [{ source: { type: 'media', value: 'pinned' } }] }] },
			] },
		}
		const n = run(project, { A: { known: true, files: [] }, B: { known: true, files: [] } })
		assert.deepEqual(row(n, 'SECOND').missing_on, ['B'])
		assert.deepEqual(row(n, 'FIRST').missing_on, ['B'])
		assert.deepEqual(row(n, 'TL_CLIP').needed_on, [{ server: 'B', destinations: [{ id: 'd2', label: 'Stream PGM' }], looks: [], timelines: ['Show TL'] }])
		assert.deepEqual(row(n, 'PINNED').missing_on, ['A'])
		assert.equal(row(n, 'PINNED').spreadable, false, 'on no server: not spreadable')
		assert.deepEqual(row(n, 'PINNED').on, [])
		assert.equal(n.summary.to_send.transfers, 0)
	})

	it('live inputs, routes, templates and placeholders are not media', () => {
		const n = run({ scenes: [look('lx', 'all', ['route://1-10', 'decklink://1']), { id: 'ly', mainScope: 'all', layers: [{ source: { type: 'template', value: 'lower' } }, { source: { type: 'live', value: 'cam' } }, { source: { type: 'file', value: 'x', isPlaceholder: true } }] }] }, { A: { known: true, files: [] }, B: { known: true, files: [] } })
		assert.deepEqual(n.files, [])
	})

	it('a destination owned by nobody needs nothing', () => {
		const n = run({ scenes: [look('l3', 2, ['only_spare'])] }, { A: { known: true, files: [] }, B: { known: true, files: [] } })
		assert.deepEqual(n.files, [])
		assert.equal(n.summary.missing_files, 0)
	})

	it('unknown inventory ⇒ unknown, never missing', () => {
		const n = run({ scenes: [look('l2', 1, ['clip'])] }, { A: { known: true, files: [F('clip.mp4')] } })
		const x = row(n, 'CLIP')
		assert.deepEqual(x.missing_on, [])
		assert.deepEqual(x.unknown_on, ['B'])
		assert.equal(n.summary.missing_files, 0)
		assert.deepEqual(n.summary.unknown_servers, ['B'])
		const b = n.servers.find((s) => s.id === 'B')
		assert.equal(b.known, false)
		assert.equal(b.reason, 'old build')
		assert.equal(b.files, null)
		assert.deepEqual(n.looks, [])
	})

	it('differs by size; a newer differing copy is flagged and not counted to send; same size + other mtime = same', () => {
		const p = { scenes: [look('l2', 1, ['a', 'b', 'c'])] }
		const n = run(p, {
			A: { known: true, files: [F('a.mp4', 100, 1000), F('b.mp4', 100, 1000), F('c.mp4', 100, 1000)] },
			B: { known: true, files: [F('a.mp4', 90, 900), F('b.mp4', 90, 5000), F('c.mp4', 100, 5000)] },
		})
		assert.deepEqual(row(n, 'A').differs_on, ['B'])
		assert.deepEqual(row(n, 'A').newer_on, [])
		assert.deepEqual(row(n, 'B').differs_on, ['B'])
		assert.deepEqual(row(n, 'B').newer_on, ['B'])
		assert.deepEqual(row(n, 'C').differs_on, [])
		assert.deepEqual(row(n, 'C').missing_on, [])
		assert.equal(n.summary.differs_files, 2)
		assert.deepEqual(n.summary.to_send, { transfers: 1, files: 1, bytes: 100 })
		assert.equal(n.looks[0].differs.length, 2)
	})

	it('matching is case-insensitive, extension-free, with a unique-basename fallback and project-folder spellings', () => {
		const p = { scenes: [look('l2', 1, ['testowe/Clip.MOV', 'Lonely', 'proj_clip'])] }
		const n = run(p, {
			A: { known: true, files: [F('TESTOWE/clip.mov'), F('deep/folder/lonely.mp4'), F('projects/show/proj_clip.mp4')] },
			B: { known: true, files: [] },
		}, { expand: (v) => [`projects/show/${v}`] })
		assert.deepEqual(n.files.map((f) => f.id).sort(), ['DEEP/FOLDER/LONELY', 'PROJECTS/SHOW/PROJ_CLIP', 'TESTOWE/CLIP'])
		assert.ok(n.files.every((f) => f.missing_on[0] === 'B'))
	})

	it('elsewhere lists files only other servers have; the shared library lists everything once', () => {
		const invs = { A: { known: true, files: [F('a.mp4'), F('both.mp4')] }, B: { known: true, files: [F('b_only.mp4'), F('both.mp4')] } }
		const n = run({ scenes: [] }, invs)
		assert.deepEqual(n.elsewhere, [{ id: 'B_ONLY', path: 'b_only.mp4', size: 100, on: ['B'] }])
		assert.deepEqual(sharedLibrary(SERVERS, inv(invs)).map((x) => [x.id, x.on]), [['A', ['A']], ['B_ONLY', ['B']], ['BOTH', ['A', 'B']]])
	})

	it('source: the newest copy among the other holders, then self, the master, the lowest id', () => {
		const servers = [...SERVERS, { id: 'C', name: 'boxC', online: true }, { id: 'D', name: 'boxD', online: true }]
		const dests = [{ id: 'd2', label: 'S', main: 1, owners: ['B'] }]
		const mk = (invs, masterId) => computeNeeds({ project: { scenes: [look('l', 1, ['x'])] }, destinations: dests, servers, inventory: inv(invs), masterId })
		const B = { known: true, files: [] }
		assert.equal(mk({ A: { known: true, files: [F('x.mp4')] }, B, C: { known: true, files: [F('x.mp4')] } }).files[0].send_from.B.server, 'A')
		assert.equal(mk({ A: { known: true, files: [] }, B, C: { known: true, files: [F('x.mp4')] }, D: { known: true, files: [F('x.mp4')] } }, 'D').files[0].send_from.B.server, 'D')
		assert.equal(mk({ A: { known: true, files: [] }, B, C: { known: true, files: [F('x.mp4')] }, D: { known: true, files: [F('x.mp4')] } }).files[0].send_from.B.server, 'C')
		assert.equal(mk({ A: { known: true, files: [F('x.mp4', 100, 1)] }, B, C: { known: true, files: [F('x.mp4', 100, 99)] } }).files[0].send_from.B.server, 'C')
	})

	it('take answer: media_missing from the last computed needs, only on success, never blocking', () => {
		const { withMediaMissing } = require('../../src/cluster/cluster-media-service')
		const n = run({ scenes: [look('l2', 1, ['clip'])] }, { A: { known: true, files: [F('clip.mp4')] }, B: { known: true, files: [] } })
		const ok = { status: 200, headers: {}, body: JSON.stringify({ ok: true }) }
		assert.deepEqual(JSON.parse(withMediaMissing({ _clusterMediaNeeds: n }, ok, 'l2', 1).body), { ok: true, media_missing: [{ id: 'CLIP', server: 'B', server_name: 'boxB' }] })
		assert.equal(withMediaMissing({ _clusterMediaNeeds: n }, ok, 'l2', 0), ok, 'another screen: unchanged')
		assert.equal(withMediaMissing({}, ok, 'l2', 1), ok, 'nothing computed yet: unchanged')
		const err = { status: 409, body: '{}' }
		assert.equal(withMediaMissing({ _clusterMediaNeeds: n }, err, 'l2', 1), err)
	})
})

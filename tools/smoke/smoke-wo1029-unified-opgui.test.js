'use strict'

/**
 * WO-1029 plan 06 S1 (owner D2) — the operator GUI destination is per server: it leaves the shared show at the merge
 * boundary (show-merge.js showOf / intoProject), a taken show never carries a peer's operator GUI fields onto this box
 * (shared-show-ctx.js liveDestinationsFor), and a master still sends its entry to a peer on the previous build
 * (no 'opgui-local' capability) so that peer does not lose its destination.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const M = require('../../src/cluster/show-merge')
const { createShowCluster } = require('../e2e/shared-show-harness')
const { guardIncoming } = require('../../src/cluster/shared-show-dests-ctx')

const gui = (port, extra = {}) => ({ id: 'dst_operator_gui', label: 'Operator GUI', mode: 'operator_gui', physicalPort: port, headless: false, videoOutput: 'shm', shmName: 'opgui', width: 1920, height: 1080, ...extra })
const pgm = { id: 'dst_pgm1', label: 'PGM/PRV 1', mode: 'pgm_prv', mainScreenIndex: 0 }
const project = (g) => ({ name: 'Show', rev: 3, scenes: { scenes: [{ id: 'l1', name: 'Look' }] }, hardwareConfig: { screenDestinations: { version: 1, destinations: [g, pgm] }, deviceGraph: { edges: [{ id: 'e1', sourceId: 'dst_in_dst_operator_gui', sinkId: 'gpu_p3' }] } } })
const guiOf = (p) => M.destListOf(p.hardwareConfig.screenDestinations).find((d) => d.mode === 'operator_gui')

describe('WO-1029 S1: show-merge keeps the operator GUI per server', () => {
	it('showOf drops it; the old form keeps it', () => {
		const p = project(gui(1))
		assert.deepEqual(M.showOf(p).hardwareConfig.screenDestinations.destinations.map((d) => d.id), ['dst_pgm1'])
		assert.deepEqual(M.showOf(p, { opGuiLocal: false }).hardwareConfig.screenDestinations.destinations.map((d) => d.id), ['dst_operator_gui', 'dst_pgm1'])
		assert.equal(M.hashShow(M.showOf(project(gui(1)))), M.hashShow(M.showOf(project(gui(3, { headless: true })))), 'two boxes with different GUIs hold the same show')
	})
	it('intoProject puts the local one back at its position; an incoming one is replaced by the local one', () => {
		const local = project(gui(3, { headless: true, shmName: 'b' }))
		const fromNew = M.intoProject(local, M.showOf(project(gui(1))))
		assert.deepEqual(M.destListOf(fromNew.hardwareConfig.screenDestinations).map((d) => d.id), ['dst_operator_gui', 'dst_pgm1'])
		assert.deepEqual(guiOf(fromNew), gui(3, { headless: true, shmName: 'b' }))
		const fromOld = M.intoProject(local, M.showOf(project(gui(1, { width: 800 })), { opGuiLocal: false }))
		assert.deepEqual(guiOf(fromOld), gui(3, { headless: true, shmName: 'b' }), 'an older master\'s operator GUI fields never land here')
	})
	it('a box with none takes an older master\'s entry (it has no other source)', () => {
		const local = { name: 'Show', hardwareConfig: { screenDestinations: { destinations: [pgm] } } }
		const taken = M.intoProject(local, M.showOf(project(gui(1)), { opGuiLocal: false }))
		assert.equal(guiOf(taken).physicalPort, 1)
	})
	it('a show without the destination list (S5 form) leaves the local list alone', () => {
		const local = project(gui(2))
		const show = M.showOf(project(gui(1)), { dests: false })
		assert.equal('screenDestinations' in show.hardwareConfig, false)
		assert.deepEqual(M.intoProject(local, show).hardwareConfig.screenDestinations, local.hardwareConfig.screenDestinations)
	})
	it('the live-config guard keeps this box\'s operator GUI whatever the incoming list says', () => {
		const config = { screenDestinations: { destinations: [gui(3, { headless: true }), pgm] }, deviceGraph: { connectors: [], edges: [] } }
		const g = guardIncoming(config, [gui(1, { width: 640 }), pgm, { id: 'dst_new_1', label: 'New', mode: 'pgm_only' }], [])
		assert.deepEqual(g.list.map((d) => d.id), ['dst_operator_gui', 'dst_pgm1', 'dst_new_1'])
		assert.equal(g.list[0].physicalPort, 3)
		assert.equal(g.list[0].headless, true)
	})
})

describe('WO-1029 S1: linked servers, each with its own operator GUI', () => {
	function bed(caps) {
		const c = createShowCluster(['a', 'b', 'c'].slice(0, caps ? 3 : 2), { sameProject: true, caps })
		c.node('a').project.hardwareConfig.screenDestinations = [gui(1), { id: 'dst_pgm1', label: 'PGM/PRV 1' }]
		c.node('b').project.hardwareConfig.screenDestinations = [gui(3, { headless: true, shmName: 'gui_b' }), { id: 'dst_pgm1', label: 'PGM/PRV 1' }]
		if (caps) c.node('c').project.hardwareConfig.screenDestinations = [{ id: 'dst_pgm1', label: 'PGM/PRV 1' }]
		c.link()
		return c
	}
	const g = (n) => n.project.hardwareConfig.screenDestinations.find((d) => d.mode === 'operator_gui')

	it('a mastership flip with different GUI settings: both keep their own GUI and their cables', async () => {
		const c = bed()
		const [a, b] = [c.node('a'), c.node('b')]
		const cablesB = structuredClone(b.project.hardwareConfig.deviceGraph)
		c.master('a')
		c.share()
		await c.settle()
		assert.deepEqual(c.inSyncWith('a').sort(), ['a', 'b'])
		assert.equal(g(a).physicalPort, 1)
		assert.deepEqual([g(b).physicalPort, g(b).headless, g(b).shmName], [3, true, 'gui_b'])
		c.master('b') // the flip: b's show goes out now
		b.edit((p) => (p.scenes.scenes[0].name = 'edited on b'))
		await c.settle()
		assert.equal(a.project.scenes.scenes[0].name, 'edited on b')
		assert.equal(g(a).physicalPort, 1, 'a keeps its GUI after b became master')
		assert.deepEqual([g(b).physicalPort, g(b).headless], [3, true])
		assert.deepEqual(b.project.hardwareConfig.deviceGraph, cablesB, 'cables never travel')
		assert.equal(a.project.hardwareConfig.deviceGraph.box, 'a')
		a.edit((p) => (p.scenes.scenes[0].name = 'edited on a'))
		await c.settle()
		assert.equal(b.project.scenes.scenes[0].name, 'edited on a')
		assert.equal(g(b).physicalPort, 3, 'a follower\'s proposal does not carry its GUI onto the master')
		assert.deepEqual(c.inSyncWith('a').sort(), ['a', 'b'], 'different GUIs, one show')
	})

	it('version gate: a peer without opgui-local still gets the master\'s operator GUI entry; a new one never', async () => {
		const c = bed({ c: [] })
		c.master('a')
		c.share()
		await c.settle()
		const toC = c.wire.filter((w) => w.from === 'a' && w.to === 'c' && w.action === 'show.push' && (w.args.show || w.args.ops?.length))
		const toB = c.wire.filter((w) => w.from === 'a' && w.to === 'b' && w.action === 'show.push')
		const carries = (w) => JSON.stringify(w.args).includes('operator_gui')
		assert.ok(toC.length && toC.some(carries), 'the older peer is sent the operator GUI entry')
		assert.ok(toB.length && !toB.some(carries), 'a peer with opgui-local never is')
		assert.ok(c.inSyncWith('a').includes('b'), 'b holds the same show without a\'s GUI')
		assert.equal(g(c.node('c'))?.physicalPort, 1, 'the older peer that had none keeps a destination')
		assert.equal(g(c.node('b')).physicalPort, 3)
	})
})

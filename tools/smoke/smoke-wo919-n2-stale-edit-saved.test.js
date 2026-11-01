'use strict'

/**
 * WO-919 N2 (owner decision 01.11.26): a stale client's last edit is written into ITS show's file.
 *
 * Client A edits show X, another client / an API Load opens show Y, A's last autosave of X arrives after the switch. It
 * still answers 409 `not_active` (A adopts Y), but the edit lands in X's stored file — rev-checked, without activating
 * X and without touching Y. A stale RENAME stays refused and unsaved. X's hardwareConfig takes the live rig only while
 * that rig provably still is X's (Y loaded without its hardware right after X); otherwise X keeps its stored slice.
 *
 * Real handlers against a private state file + projects dir (set before any require) — never the live projects/.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo919-n2-'))
process.env.HIGHASCG_STATE_FILE = path.join(TMP, 'state.json')
process.env.HIGHASCG_PROJECTS_DIR = path.join(TMP, 'projects')
fs.mkdirSync(process.env.HIGHASCG_PROJECTS_DIR, { recursive: true })

const persistence = require('../../src/utils/persistence')
const projectStore = require('../../src/engine/project-store')
const { handleProject } = require('../../src/api/routes-data-project-handlers')
const hold = require('../../src/engine/project-hardware-hold')
const { createNewProject } = require('../../src/engine/new-project')

/** A rig told apart by its destination id (same shape as smoke-wo821-hardware-hold). */
function rig(id) {
	return {
		deviceGraph: {
			version: 1,
			devices: [],
			connectors: [
				{ id: `dst_in_${id}`, kind: 'destination_in', externalRef: id },
				{ id: 'gpu_p0', kind: 'gpu_out' },
			],
			edges: [{ id: `e_${id}`, sourceId: `dst_in_${id}`, sinkId: 'gpu_p0' }],
		},
		screenDestinations: {
			version: 1,
			destinations: [{ id, label: id, mode: 'pgm_only', mainScreenIndex: 0, width: 1920, height: 1080, fps: 50 }],
			edidNotes: '',
		},
	}
}
function boxCtx() {
	const cfg = JSON.parse(JSON.stringify(require('../../src/config/defaults')))
	Object.assign(cfg, rig('box_dst'))
	const c = { config: cfg, configManager: { get: () => cfg, save: (n) => Object.assign(cfg, n) }, logs: [] }
	c.log = (lvl, m) => c.logs.push(lvl + ' ' + m)
	return c
}
/** The operator edits destinations in Devices: that changes the LIVE config (/api/device-view), not the project. */
function editLiveRig(c, id) {
	Object.assign(c.config, JSON.parse(JSON.stringify(rig(id))))
}
async function post(c, p, body) {
	const r = await handleProject(p, JSON.stringify(body), c)
	return { status: r.status, body: JSON.parse(r.body) }
}
const looks = (...ids) => ids.map((id) => ({ id, name: id, layers: [] }))
function storeShow(slug, ids, dest, rev) {
	const p = { name: slug, slug, rev, savedAt: '2026-11-01T10:00:00.000Z', scenes: { scenes: looks(...ids) }, hardwareConfig: { version: 2, ...rig(dest) } }
	fs.writeFileSync(projectStore.projectFilePath(slug), JSON.stringify(p))
}
const stored = (slug) => projectStore.readProjectFile(slug)
const dest = (p) => p?.hardwareConfig?.screenDestinations?.destinations?.[0]?.id
const lookIds = (p) => (p?.scenes?.scenes || []).map((l) => l.id)
const active = () => projectStore.getActiveSlug(persistence)
/** What client A posts: its copy of X (the rev the server issued it) plus one more look, and the slug it edits. */
function staleBody(slug, extra = {}) {
	const s = stored(slug)
	return { project: { ...s, scenes: { scenes: [...s.scenes.scenes, ...looks('added_by_a')] }, savedAt: new Date().toISOString(), ...extra }, editingSlug: slug }
}
/** X open with its own rig applied, then Y opened by "another client" (with or without Y's hardware). */
async function switchUnderClient(c, x, y, applyY) {
	assert.equal((await post(c, '/api/project/load', { slug: x, applyHardware: true })).status, 200)
	editLiveRig(c, `${x}_edited`) // A removes / changes a destination of X
	assert.equal((await post(c, '/api/project/load', { slug: y, applyHardware: applyY })).status, 200)
	assert.equal(active(), y)
	return { y: stored(y), deck: JSON.stringify(c.sceneDeck || null), mirror: persistence.get('web_project')?.slug }
}
function assertActiveUntouched(c, y, before) {
	assert.equal(active(), y, 'the open show stays open')
	assert.deepEqual(stored(y), before.y, "the open show's file is untouched")
	assert.equal(JSON.stringify(c.sceneDeck || null), before.deck, 'the live deck is untouched')
	assert.equal(persistence.get('web_project')?.slug, before.mirror, 'the web_project mirror is untouched')
}

test('rig still X\'s (Y loaded without hardware): the stale edit lands in X with a rev bump and the live rig', async () => {
	const c = boxCtx()
	storeShow('n2_x1', ['x1', 'x2'], 'n2_x1_stored', 4)
	storeShow('n2_y1', ['y1'], 'n2_y1_rig', 9)
	const before = await switchUnderClient(c, 'n2_x1', 'n2_y1', false)
	assert.equal(hold.liveRigOwnerAfter('n2_y1'), 'n2_x1', "Y's hold records that X's rig is still live")
	const rev = stored('n2_x1').rev
	const r = await post(c, '/api/project/autosave', staleBody('n2_x1'))
	assert.equal(r.status, 409, JSON.stringify(r.body))
	assert.equal(r.body.reason, 'not_active', 'the client still adopts the open show')
	assert.equal(r.body.activeSlug, 'n2_y1')
	assert.equal(r.body.savedTo, 'n2_x1')
	assert.equal(r.body.rev, rev + 1)
	assert.equal(r.body.hardware, 'live')
	assert.match(r.body.error, /saved into "n2_x1"/)
	assert.deepEqual(lookIds(stored('n2_x1')), ['x1', 'x2', 'added_by_a'])
	assert.equal(stored('n2_x1').rev, rev + 1)
	assert.equal(dest(stored('n2_x1')), 'n2_x1_edited', "the destination edit A made on X's live rig is in X now")
	assert.equal(projectStore.readAutosaveFile('n2_x1').rev, rev + 1, 'the _autosave copy too, as on a normal autosave')
	assertActiveUntouched(c, 'n2_y1', before)
	assert.ok(c.logs.some((l) => l.startsWith('info') && l.includes('last edit of "n2_x1" saved into its file')), c.logs.join('\n'))
	const again = await post(c, '/api/project/autosave', { ...staleBody('n2_x1'), project: { ...stored('n2_x1'), savedAt: new Date().toISOString() } })
	assert.equal(again.body.savedTo, 'n2_x1')
	assert.equal(again.body.changed, false, 'an unchanged echo writes nothing')
	assert.equal(stored('n2_x1').rev, rev + 1)
})

test("another rig live (Y loaded with its hardware): X's edit is saved over the rig the switch stamped, never Y's", async () => {
	const c = boxCtx()
	storeShow('n2_x2', ['x1'], 'n2_x2_stored', 2)
	storeShow('n2_y2', ['y1'], 'n2_y2_rig', 5)
	const before = await switchUnderClient(c, 'n2_x2', 'n2_y2', true)
	assert.equal(dest({ hardwareConfig: c.config }), 'n2_y2_rig', "Y's rig is live")
	const r = await post(c, '/api/project/autosave', staleBody('n2_x2'))
	assert.equal(r.body.reason, 'not_active')
	assert.equal(r.body.savedTo, 'n2_x2')
	assert.equal(r.body.hardware, 'stored')
	assert.deepEqual(lookIds(stored('n2_x2')), ['x1', 'added_by_a'])
	assert.equal(dest(stored('n2_x2')), 'n2_x2_edited', "X's own edited rig (the switch stamp), never Y's")
	assertActiveUntouched(c, 'n2_y2', before)
})

test('X → Z (with hardware) → Y (without): the live rig is Z\'s, so X keeps its stored hardwareConfig', async () => {
	const c = boxCtx()
	storeShow('n2_x3', ['x1'], 'n2_x3_stored', 2)
	storeShow('n2_z3', ['z1'], 'n2_z3_rig', 2)
	storeShow('n2_y3', ['y1'], 'n2_y3_rig', 2)
	await post(c, '/api/project/load', { slug: 'n2_x3', applyHardware: true })
	await post(c, '/api/project/load', { slug: 'n2_z3', applyHardware: true })
	await post(c, '/api/project/load', { slug: 'n2_y3' })
	assert.equal(hold.liveRigOwnerAfter('n2_y3'), 'n2_z3')
	const r = await post(c, '/api/project/autosave', staleBody('n2_x3'))
	assert.equal(r.body.savedTo, 'n2_x3')
	assert.equal(r.body.hardware, 'stored')
	assert.equal(dest(stored('n2_x3')), 'n2_x3_stored')
})

test('a stale autosave older than the stored rev is not written', async () => {
	const c = boxCtx()
	storeShow('n2_x4', ['x1', 'x2'], 'n2_x4_stored', 6)
	storeShow('n2_y4', ['y1'], 'n2_y4_rig', 3)
	const before = await switchUnderClient(c, 'n2_x4', 'n2_y4', false)
	const x = stored('n2_x4')
	const r = await post(c, '/api/project/autosave', staleBody('n2_x4', { rev: x.rev - 1 }))
	assert.equal(r.status, 409)
	assert.equal(r.body.reason, 'not_active')
	assert.equal(r.body.savedTo, null)
	assert.equal(r.body.notSaved, 'stale_rev')
	assert.deepEqual(stored('n2_x4'), x, 'the newer stored X wins')
	assertActiveUntouched(c, 'n2_y4', before)
	const noRev = await post(c, '/api/project/autosave', staleBody('n2_x4', { rev: undefined }))
	assert.equal(noRev.body.notSaved, 'no_rev', 'a stale write never wins on a client clock')
	assert.deepEqual(stored('n2_x4'), x)
	assert.ok(c.logs.some((l) => l.startsWith('info') && l.includes('NOT saved (stale_rev')), c.logs.join('\n'))
})

test('a stale RENAME stays refused and unsaved', async () => {
	const c = boxCtx()
	storeShow('n2_x5', ['x1'], 'n2_x5_stored', 2)
	storeShow('n2_y5', ['y1'], 'n2_y5_rig', 2)
	const before = await switchUnderClient(c, 'n2_x5', 'n2_y5', false)
	const x = stored('n2_x5')
	const r = await post(c, '/api/project/autosave', staleBody('n2_x5', { name: 'n2_x5_renamed' }))
	assert.equal(r.status, 409)
	assert.equal(r.body.reason, 'not_active')
	assert.equal(r.body.notSaved, 'rename')
	assert.equal(stored('n2_x5_renamed'), null, 'no fork under the new name')
	assert.deepEqual(stored('n2_x5'), x, 'X untouched')
	assert.equal(projectStore.wasProjectSlugRetired('n2_x5'), false)
	assertActiveUntouched(c, 'n2_y5', before)
})

/* ---- the switch stamp: a hardware-applying switch saves the outgoing show's live rig into it first ---- */

test('Load Y with its hardware: X\'s edited destination is saved into X first; A\'s stale edit still lands over it', async () => {
	const c = boxCtx()
	storeShow('n2_x6', ['x1'], 'n2_x6_stored', 3)
	storeShow('n2_y6', ['y1'], 'n2_y6_rig', 3)
	assert.equal((await post(c, '/api/project/load', { slug: 'n2_x6', applyHardware: true })).status, 200)
	const aRev = stored('n2_x6').rev // the rev client A holds
	const aBody = staleBody('n2_x6')
	editLiveRig(c, 'n2_x6_edited')
	assert.equal((await post(c, '/api/project/load', { slug: 'n2_y6', applyHardware: true })).status, 200)
	assert.equal(dest({ hardwareConfig: c.config }), 'n2_y6_rig', "Y's rig is live now")
	assert.equal(dest(stored('n2_x6')), 'n2_x6_edited', 'the destination edit is in X')
	assert.equal(stored('n2_x6').rev, aRev + 1)
	assert.equal(dest(projectStore.readAutosaveFile('n2_x6')), 'n2_x6_edited', '_autosave copy too')
	assert.deepEqual(lookIds(stored('n2_x6')), ['x1'], 'only the rig was stamped')
	assert.ok(c.logs.some((l) => l.startsWith('info') && l.includes('"n2_x6": live rig saved into it before switching to "n2_y6"')), c.logs.join('\n'))
	const before = { y: stored('n2_y6'), deck: JSON.stringify(c.sceneDeck || null), mirror: persistence.get('web_project')?.slug }
	const r = await post(c, '/api/project/autosave', aBody) // A's last autosave, at the rev before the stamp
	assert.equal(r.body.reason, 'not_active')
	assert.equal(r.body.savedTo, 'n2_x6', 'the stamp is the only write since its rev: rebased, not stale_rev')
	assert.equal(r.body.rev, aRev + 2)
	assert.deepEqual(lookIds(stored('n2_x6')), ['x1', 'added_by_a'])
	assert.equal(dest(stored('n2_x6')), 'n2_x6_edited', 'and the stamped rig stays')
	assertActiveUntouched(c, 'n2_y6', before)
	const older = await post(c, '/api/project/autosave', aBody)
	assert.equal(older.body.notSaved, 'stale_rev', 'a second copy at that rev is stale now')
})

test('switch stamp guards: held X, an empty live rig and an unchanged rig write nothing', async () => {
	const c = boxCtx()
	storeShow('n2_x7', ['x1'], 'n2_x7_stored', 2)
	storeShow('n2_y7', ['y1'], 'n2_y7_rig', 2)
	await post(c, '/api/project/load', { slug: 'n2_x7' }) // held: the box rig is not X's
	editLiveRig(c, 'n2_box_edit')
	let x = stored('n2_x7')
	await post(c, '/api/project/load', { slug: 'n2_y7', applyHardware: true })
	assert.deepEqual(stored('n2_x7'), x, 'WO-821: a held show keeps its stored slice')

	await post(c, '/api/project/load', { slug: 'n2_x7', applyHardware: true })
	Object.assign(c.config, { screenDestinations: { version: 1, destinations: [], edidNotes: '' }, deviceGraph: { version: 1, devices: [], connectors: [], edges: [] } })
	x = stored('n2_x7')
	await post(c, '/api/project/load', { slug: 'n2_y7', applyHardware: true })
	assert.deepEqual(stored('n2_x7'), x, 'WO-311: an empty live rig is never stamped')

	await post(c, '/api/project/load', { slug: 'n2_x7', applyHardware: true })
	await post(c, '/api/project/load', { slug: 'n2_y7', applyHardware: true }) // first stamp: the full live slice
	await post(c, '/api/project/load', { slug: 'n2_x7', applyHardware: true })
	x = stored('n2_x7')
	const logs = c.logs.length
	await post(c, '/api/project/load', { slug: 'n2_y7', applyHardware: true })
	assert.deepEqual(stored('n2_x7'), x, 'an unchanged rig: no write, no rev bump')
	assert.ok(!c.logs.slice(logs).some((l) => l.includes('live rig saved into it')))
	const y = stored('n2_y7')
	await post(c, '/api/project/load', { slug: 'n2_y7', applyHardware: true })
	assert.deepEqual(stored('n2_y7'), y, 'reloading the open show stamps nothing')
	assert.ok(!c.logs.slice(logs).some((l) => l.includes('live rig saved into it')))
})

test('New project: the open show keeps its edited destination', async () => {
	const c = boxCtx()
	storeShow('n2_x8', ['x1'], 'n2_x8_stored', 2)
	await post(c, '/api/project/load', { slug: 'n2_x8', applyHardware: true })
	editLiveRig(c, 'n2_x8_edited')
	const rev = stored('n2_x8').rev
	const { slug } = createNewProject(c)
	assert.notEqual(active(), 'n2_x8')
	assert.equal(active(), slug)
	assert.equal(dest(stored('n2_x8')), 'n2_x8_edited')
	assert.equal(stored('n2_x8').rev, rev + 1)
	assert.ok(c.logs.some((l) => l.includes(`"n2_x8": live rig saved into it before switching to "${slug}"`)), c.logs.join('\n'))
})

test('cleanup', () => {
	persistence.flushSync()
	fs.rmSync(TMP, { recursive: true, force: true })
})

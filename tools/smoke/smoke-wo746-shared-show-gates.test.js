'use strict'

/**
 * WO-746 — the multi-operator gates of the shared show (src/cluster/shared-show.js G1–G10), on three linked servers
 * in one process (tools/e2e/shared-show-harness.js: real signed calls, fake network). Every test names its gate.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createShowCluster } = require('../e2e/shared-show-harness')

const looks = (n) => n.project.scenes.scenes
const pushes = (c, to) => c.wire.filter((w) => w.action === 'show.push' && (!to || w.to === to))

async function shared(names = ['a', 'b', 'c'], opts) {
	const c = createShowCluster(names, opts)
	c.link()
	c.master(names[0])
	c.share(true)
	await c.settle()
	return c
}

test('G1: off by default — nothing moves, every server keeps its own project', async () => {
	const c = createShowCluster(['a', 'b'])
	c.link()
	c.master('a')
	const before = c.node('b').hash()
	c.node('a').edit((p) => { p.name = 'edited' })
	await c.settle()
	assert.equal(c.wire.length, 0, 'not one call')
	assert.equal(c.node('b').hash(), before)
	assert.equal(c.node('b').show.view().role, 'off')
})

test('G1: a server that did not switch it on refuses the push and keeps its project; the master shows why', async () => {
	const c = createShowCluster(['a', 'b'])
	c.link()
	c.master('a')
	c.share(true, ['a'])
	const before = c.node('b').hash()
	const t0 = c.now()
	await c.settle()
	assert.equal(c.node('b').hash(), before)
	assert.match(c.node('a').show.view().peers.b.error, /shared show is off on this server/)
	const tries = pushes(c)
	assert.ok(tries.length <= (c.now() - t0) / 5000 + 1, `retried at the heartbeat, not every poll (${tries.length})`)
	assert.ok(tries.every((w) => !w.args.show), 'a refusing server is probed, never sent the whole show')
	c.share(true, ['b'])
	c.advance(6000)
	await c.settle()
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b'], 'switched on there: it takes the show')
})

test('G1: sharing on here but not on the master (or an older master): edits stay local, nothing is proposed or backed up', async () => {
	const c = createShowCluster(['a', 'b'])
	c.link()
	c.master('a')
	c.share(true, ['b'])
	await c.settle()
	c.node('b').edit((p) => { p.name = 'edited on b' })
	c.node('b').edit((p) => { p.name = 'edited on b again' })
	await c.settle()
	assert.equal(c.wire.filter((w) => w.action === 'show.propose').length, 0, 'nothing proposed')
	assert.equal(c.node('b').backups.length, 0, 'no backup files')
	assert.equal(c.node('b').project.name, 'edited on b again')
	assert.equal(c.node('b').show.view().conflict, null)
})

test('G8 + G9: first show taken — this server\'s project backed up; its cables, Caspar and stream key stay', async () => {
	const c = await shared()
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b', 'c'])
	for (const k of ['b', 'c']) {
		const n = c.node(k)
		assert.deepEqual(n.backups.map((b) => b.tag), ['before-share'])
		assert.equal(n.backups[0].project.name, `${k} own show`, 'the backup is its own show')
		assert.equal(n.project.hardwareConfig.deviceGraph.box, k)
		assert.equal(n.project.hardwareConfig.casparServer.box, k)
		assert.equal(n.project.streaming.credentials.streamingChannel.streamKey, `key-of-${k}`)
		assert.match(n.show.view().before_share, /^projects\/_cluster\/.*before-share/)
	}
	for (const w of pushes(c)) {
		const body = JSON.stringify(w.args)
		assert.ok(!body.includes('key-of-') && !body.includes('deviceGraph') && !body.includes('casparServer'), 'G9: never on the wire')
	}
})

test('switching on is acted on at once: the followers hold the show before the next poll', async () => {
	const c = createShowCluster(['a', 'b', 'c'])
	c.link()
	c.master('a')
	c.share(true, ['b', 'c'])
	c.share(true, ['a'])
	await c.flush()
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b', 'c'])
	assert.equal(pushes(c).filter((w) => w.args.show).length, 2, 'one whole show per follower, after its probe')
})

test('an edit on the master reaches every server as a delta, not the whole show', async () => {
	const c = await shared()
	const n0 = c.wire.length
	c.node('a').edit((p) => { p.scenes.scenes[0].name = 'master edit' })
	await c.settle()
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b', 'c'])
	assert.equal(looks(c.node('c'))[0].name, 'master edit')
	const after = c.wire.slice(n0).filter((w) => w.action === 'show.push')
	assert.ok(after.length >= 2 && after.every((w) => !w.args.show && w.args.ops.length === 1), JSON.stringify(after.map((w) => w.args)))
})

test('an edit on a follower is proposed, merged by the master and reaches the third server', async () => {
	const c = await shared()
	c.node('c').edit((p) => { p.timelines.timelines[0].name = 'edited on c' })
	await c.settle()
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b', 'c'])
	assert.equal(c.node('b').project.timelines.timelines[0].name, 'edited on c')
	assert.ok(c.wire.some((w) => w.action === 'show.propose' && w.from === 'c' && w.status === 200))
	assert.equal(c.node('c').backups.filter((b) => b.tag !== 'before-share').length, 0)
})

test('G7: three operators at once on three different looks — every edit survives everywhere', async () => {
	const c = await shared()
	c.node('a').edit((p) => { p.scenes.scenes[0].name = 'by a' })
	c.node('b').edit((p) => { p.scenes.scenes[1].layers[0].clip = 'by b.mov' })
	c.node('c').edit((p) => { p.scenes.scenes.push({ id: 'look_c', name: 'by c', layers: [] }) })
	await c.settle()
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b', 'c'])
	for (const n of c.nodes) {
		assert.equal(looks(n)[0].name, 'by a')
		assert.equal(looks(n)[1].layers[0].clip, 'by b.mov')
		assert.ok(looks(n).some((l) => l.id === 'look_c'))
		assert.equal(n.show.view().conflict, null, `${n.name}: no conflict`)
	}
})

test('G7: two operators on the same look — the master\'s version stays, the follower\'s is kept as a file, both say so', async () => {
	const c = await shared()
	c.node('a').edit((p) => { p.scenes.scenes[1].name = 'master' })
	c.node('b').edit((p) => { p.scenes.scenes[1].name = 'follower' })
	await c.settle()
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b', 'c'])
	for (const n of c.nodes) assert.equal(looks(n)[1].name, 'master')
	const b = c.node('b')
	const kept = b.backups.find((x) => x.tag === 'conflict')
	assert.equal(kept.project.scenes.scenes[1].name, 'follower', 'the follower\'s version is in the file')
	assert.equal(kept.project.hardwareConfig.deviceGraph.box, 'b', 'as a whole project of that server')
	assert.deepEqual(b.show.view().conflict.paths, ['scenes.scenes[look_2].name'])
	assert.ok(c.node('a').show.view().conflict, 'the master says so too')
	assert.ok(b.events.some((e) => e.type === 'cluster:show' && e.data.conflict), 'WS cluster:show on the follower')
})

test('one operator typing fast on a follower: edits queue behind the one in flight, nothing is lost or refused', async () => {
	const c = await shared()
	const b = c.node('b')
	for (let i = 1; i <= 6; i++) b.edit((p) => { p.scenes.scenes[0].name = `typing ${i}`; p.multiview.cells.push({ id: `cell_${i}` }) })
	await c.settle()
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b', 'c'])
	assert.equal(looks(c.node('a'))[0].name, 'typing 6')
	assert.equal(c.node('c').project.multiview.cells.length, 6)
	assert.equal(b.backups.filter((x) => x.tag !== 'before-share').length, 0)
	assert.ok(c.wire.filter((w) => w.action === 'show.propose').length < 6, 'queued edits travel together')
})

test('G6: the master refuses remote presses — the follower\'s edit is refused, kept as a file, the follower goes back', async () => {
	const c = await shared()
	c.node('a').acceptRemote = false
	const was = looks(c.node('a'))[0].name
	c.node('b').edit((p) => { p.scenes.scenes[0].name = 'not allowed' })
	await c.settle()
	assert.equal(looks(c.node('b'))[0].name, was, 'back to the master\'s show')
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b', 'c'])
	const kept = c.node('b').backups.find((x) => x.tag === 'refused')
	assert.equal(kept.project.scenes.scenes[0].name, 'not allowed')
	assert.match(c.node('b').show.view().conflict.error, /refuses remote actions/)
})

test('G3: a linked server that is not the master cannot push a show', async () => {
	const c = await shared()
	const before = c.node('b').hash()
	const r = await c.node('c').call.call('b', 'show.push', { epoch: 1, slug: 'x', rev: 99, hash: 'f'.repeat(16), show: { name: 'forged' } })
	assert.equal(r.status, 403)
	assert.match(r.json.error, /not the master/)
	assert.equal(c.node('b').hash(), before)
})

test('G4: split network — the old master comes back, cannot overwrite; on taking the new claim its edits are kept', async () => {
	const c = await shared()
	c.cut('a', 'b')
	c.cut('a', 'c')
	const e2 = c.master('b', undefined, ['b', 'c']) // failover on the b + c side
	c.node('b').edit((p) => { p.scenes.scenes[0].name = 'new master' })
	c.node('a').edit((p) => { p.scenes.scenes[2].name = 'old master alone' })
	await c.settle()
	c.heal()
	await c.settle()
	assert.equal(looks(c.node('c'))[0].name, 'new master')
	assert.notEqual(looks(c.node('c'))[2].name, 'old master alone', 'epoch 1 pushes refused by epoch 2 servers')
	assert.ok(c.wire.some((w) => w.from === 'a' && w.action === 'show.push' && (w.status === 403 || w.status === 409)), 'the old master\'s pushes were refused')
	c.master('b', e2, ['a']) // a pulls the higher claim and stands down (cluster-master.js)
	await c.settle()
	assert.deepEqual(c.inSyncWith('b'), ['a', 'b', 'c'])
	const kept = c.node('a').backups.find((x) => x.tag === 'diverged')
	assert.equal(kept?.project.scenes.scenes[2].name, 'old master alone', 'G8: its edits from alone are a file')
})

test('G4: a proposal made for the old epoch is not merged by the new master; it waits and goes again', async () => {
	const c = await shared()
	c.cut('b', 'a')
	c.node('b').edit((p) => { p.scenes.scenes[0].name = 'made under epoch 1' })
	await c.settle()
	assert.ok(c.node('b').show.view().pending, 'the master is gone: the edit waits')
	c.master('c', undefined, ['b', 'c'])
	await c.settle()
	assert.equal(looks(c.node('c'))[0].name, 'made under epoch 1', 'proposed again to the new master once the claim moved')
	assert.deepEqual(c.inSyncWith('c').sort(), ['b', 'c'])
})

test('G5: a replayed older push changes nothing', async () => {
	const c = await shared()
	c.node('a').edit((p) => { p.scenes.scenes[0].name = 'v2' })
	await c.settle()
	const old = pushes(c, 'b')[0].args
	c.node('a').edit((p) => { p.scenes.scenes[0].name = 'v3' })
	await c.settle()
	const r = await c.node('a').call.call('b', 'show.push', old)
	assert.equal(r.status, 409)
	assert.match(r.json.error, /stale show/)
	assert.equal(looks(c.node('b'))[0].name, 'v3')
})

test('G2: a server in a hot-backup pair takes no shared show', async () => {
	const c = createShowCluster(['a', 'b'])
	c.link()
	c.master('a')
	c.node('b').pair = true
	c.share(true)
	const before = c.node('b').hash()
	await c.settle()
	assert.equal(c.node('b').hash(), before)
	assert.equal(c.node('b').show.view().blocked, 'hot-backup pair')
	assert.match(c.node('a').show.view().peers.b.error, /hot-backup pair/)
})

test('a follower restarts: no whole-show resend, and the stale gate still holds', async () => {
	const c = await shared()
	c.node('b').restart()
	const n0 = pushes(c, 'b').length
	c.advance(31000) // the heartbeat
	await c.settle()
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b', 'c'])
	assert.ok(pushes(c, 'b').slice(n0).every((w) => !w.args.show), 'its own disk is the base')
	c.node('b').edit((p) => { p.scenes.scenes[0].name = 'after restart' })
	await c.settle()
	assert.equal(looks(c.node('a'))[0].name, 'after restart', 'and its first edit after the restart is proposed')
})

test('the master restarts: a follower edit still merges (the base is the master\'s current show)', async () => {
	const c = await shared()
	c.node('a').restart()
	c.node('b').edit((p) => { p.scenes.scenes[0].name = 'after master restart' })
	await c.settle()
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b', 'c'])
	assert.equal(looks(c.node('c'))[0].name, 'after master restart')
})

test('switching off: the server keeps the shared show as its own project and takes nothing more', async () => {
	const c = await shared()
	c.share(false, ['c'])
	const keep = c.node('c').hash()
	c.node('a').edit((p) => { p.scenes.scenes[0].name = 'after c left' })
	await c.settle()
	assert.equal(c.node('c').hash(), keep)
	assert.deepEqual(c.inSyncWith('a'), ['a', 'b'])
})

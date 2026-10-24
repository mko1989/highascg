'use strict'

/**
 * WO-746 — the shared show on three throwaway sandbox servers over HTTP (tools/e2e/shared-show-scenario.js, the same
 * run as `node tools/e2e/run-cluster-e2e.js --scenario=show`): link, master, each its own show, sharing on (backup +
 * own cables kept), edits from the master and from a follower, three operators at once on different looks, two on the
 * same look, one server switching off, unlink. Plus the wiring the run cannot see.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startSandboxNodes } = require('../e2e/cluster-nodes')
const { runShowScenario, steps } = require('../e2e/shared-show-scenario')

const ROOT = path.resolve(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('WO-746 wiring', () => {
	it('every write of the project reaches the shared show (persistProject, after the unchanged no-op)', () => {
		const s = read('src/engine/project-scenes.js')
		const hook = s.indexOf('ctx._clusterShow?.written() // WO-746')
		assert.ok(hook > s.indexOf('unchanged: true }') && hook < s.indexOf('return { ok: true, slug, rev: projectRevOf(stamped), project: stamped }'))
	})
	it('the signed call carries show.push as information and show.propose as an action (accept_remote applies, G6)', () => {
		const s = read('src/api/routes-cluster.js')
		assert.match(s, /info: \{ \.\.\.exchangeOf\(ctx\)\.info, \.\.\.showOf\(ctx\)\.info, /)
		assert.match(s, /isFollower: \(\) => isClusterFollower\(ctx\) \}\), \.\.\.showOf\(ctx\)\.actions \},/)
		assert.match(s, /await showOf\(ctx\)\.tick\(\) \/\/ WO-746/)
		assert.match(s, /routes\.post\('\/api\/cluster\/show'/)
	})
	it('backups are box-local: Syncthing never carries projects/_cluster', () => {
		assert.match(read('.stignore'), /^\/projects\/_cluster$/m)
	})
	it('a taken show never restarts Caspar (G10): the commit path has no Caspar call', () => {
		const s = read('src/cluster/shared-show-ctx.js')
		const commit = s.slice(s.indexOf('function commitShow'), s.indexOf('function backupProject'))
		assert.doesNotMatch(commit, /caspar|restart|regenerate/i)
	})
})

describe('WO-746 shared show on three sandbox servers', { timeout: 180000 }, () => {
	let tmp, nodes, results
	before(async () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo746-show-'))
		nodes = await startSandboxNodes(tmp, ['sb-a', 'sb-b', 'sb-c'])
		results = await runShowScenario(nodes)
	})
	after(async () => {
		await Promise.all((nodes || []).map((n) => n.stop()))
		fs.rmSync(tmp, { recursive: true, force: true })
	})
	it('every step passes', () => {
		assert.equal(results.length, steps.length)
		const failed = results.filter((r) => r.status !== 'pass')
		assert.deepEqual(failed, [], JSON.stringify(failed, null, 1))
	})
	it('the shared show refuses real servers (it replaces their show)', async () => {
		await assert.rejects(runShowScenario([{ kind: 'live' }]), /sandbox servers only/)
	})
})

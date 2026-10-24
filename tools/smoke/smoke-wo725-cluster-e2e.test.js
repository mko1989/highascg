'use strict'

/**
 * WO-725 — the cluster end-to-end run on three throwaway sandbox servers (tools/e2e/run-cluster-e2e.js, every step):
 * link, API timing alone and linked, master + epoch fencing, signed calls + allow-list, sender choice in sync,
 * master restart, failover (SIGSTOP, ≈14 s), follower restart, unlink. ≈20 s.
 *
 * Plus the two sandbox guards it needed: a sandbox's cluster id is its own (every sandbox reported the box hostname,
 * so a third one replaced the second in the peer list), and a sandbox master never forwards takes (it connected to
 * the peer's Caspar = this box's LIVE 127.0.0.1:5250).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startSandboxNodes } = require('../e2e/cluster-nodes')
const { runScenario, steps } = require('../e2e/cluster-scenario')

const ROOT = path.resolve(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('WO-725 sandbox guards for cluster runs', () => {
	it('a sandbox never takes the live box hostname as its cluster id', () => {
		assert.match(read('src/replication/replication-local-identity.js'), /const hwHostname = isSandbox\(\) \? null : getHardwareHostnameSelfId\(\)/)
	})
	it('a sandbox master never forwards takes', () => {
		assert.match(read('src/api/routes-cluster.js'), /isMaster: \(\) => !isSandbox\(\) && masterOf\(ctx\)\.view\(\)\.is_master === true/)
	})
})

describe('WO-725 cluster e2e on three sandbox servers', { timeout: 180000 }, () => {
	let tmp, nodes, results
	before(async () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo725-cluster-'))
		nodes = await startSandboxNodes(tmp, ['sb-a', 'sb-b', 'sb-c'])
		results = await runScenario(nodes, { benchN: 20, calls: 10 })
	})
	after(async () => {
		if (nodes) await Promise.all(nodes.map((n) => n.stop()))
		if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
	})

	for (const s of steps) {
		it(s.name, () => {
			const r = results.find((x) => x.step === s.name)
			assert.ok(r, 'step ran')
			assert.equal(r.status, 'pass', r.error)
		})
	}
})

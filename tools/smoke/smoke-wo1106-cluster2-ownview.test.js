'use strict'

/**
 * WO-1106 C25 — the AMCP gate (destination-ownership.js `verdict`) asks for this server's own view on every line a
 * follower sends; ownership-ctx.js caches it per config revision (a replaced config slice, a local Devices write, the
 * poll tick) and cluster-media.js hashes a linked server's key once. Offline: no cluster, no ports.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

const channelMapMod = require('../../src/config/channel-map-from-ctx')
const { createOwnership } = require('../../src/cluster/destination-ownership')
const { ownershipDeps, invalidateOwnView } = require('../../src/cluster/ownership-ctx')
const { fingerprint } = require('../../src/cluster/cluster-media')

const cable = (ids) => ({
	connectors: ids.map((id) => ({ id: `c_${id}`, kind: 'destination_in', externalRef: id })),
	edges: ids.map((id) => ({ sourceId: `c_${id}`, sinkId: 'gpu' })),
})

function follower() {
	const dests = ['a', 'b'].map((id, i) => ({ id, label: `Screen ${id}`, mode: 'pgm_prv', mainScreenIndex: i }))
	const config = { screen_count: 2, screenDestinations: { version: 1, destinations: dests }, deviceGraph: cable(['a']) }
	const ctx = { config, log() {} }
	const peers = [{ id: 'M', name: 'srv-M', online: true }]
	const get = {
		cluster: () => ({ snapshot: () => ({ self: { id: 'F' }, peers }), deviceView: async () => ({ status: 200, body: { graph: cable(['b']) } }) }),
		master: () => ({ view: () => ({ epoch: 3, master_id: 'M', is_master: false }) }),
		report: () => ({ heldBy: () => '', forwardedBy: () => null, holderOf: () => '', view: () => ({}) }),
		call: () => ({ call: async () => ({ ok: true, status: 200 }) }),
	}
	return { ctx, own: createOwnership(ownershipDeps(ctx, get)) }
}

/** Count channel-map builds (the expensive part of the view) while fn runs. */
async function countBuilds(fn) {
	const orig = channelMapMod.buildChannelMap
	let n = 0
	channelMapMod.buildChannelMap = (...a) => (n++, orig(...a))
	try {
		await fn()
	} finally {
		channelMapMod.buildChannelMap = orig
	}
	return n
}

describe('WO-1106 C25 ownView cached per config revision', () => {
	it('1000 AMCP verdicts on a follower build this server\'s view once', async () => {
		const { own } = follower()
		const n = await countBuilds(() => {
			for (let i = 0; i < 1000; i++) own.verdict(3)
		})
		assert.equal(n, 1)
	})

	it('a replaced config slice, a local Devices write and the poll tick each rebuild it once', async () => {
		const { ctx, own } = follower()
		own.verdict(1)
		assert.equal(await countBuilds(() => {
			ctx.config.deviceGraph = cable(['a', 'b']) // a Devices write replaces the slice
			for (let i = 0; i < 100; i++) own.verdict(1)
		}), 1)
		assert.equal(await countBuilds(() => {
			invalidateOwnView(ctx) // cluster-device-view.js localChanged
			for (let i = 0; i < 100; i++) own.verdict(1)
		}), 1)
		assert.equal(await countBuilds(async () => {
			await own.refresh() // after every cluster poll
			for (let i = 0; i < 100; i++) own.verdict(1)
		}), 1)
	})

	it('a linked server\'s key is hashed once, whatever the number of lookups', () => {
		const key = `-----BEGIN PUBLIC KEY-----\nc25-${Math.random()}\n-----END PUBLIC KEY-----`
		const orig = crypto.createHash
		let n = 0
		crypto.createHash = (...a) => (n++, orig(...a))
		let fps
		try {
			fps = new Set(Array.from({ length: 1000 }, () => fingerprint(key)))
		} finally {
			crypto.createHash = orig
		}
		assert.equal(n, 1)
		assert.deepEqual([...fps], [orig('sha256').update(key.trim()).digest('hex').slice(0, 16)])
		assert.equal(fingerprint(''), '')
	})
})

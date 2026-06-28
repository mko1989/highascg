'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	manifestSignature,
	compareProjectMediaManifests,
} = require('../src/replication/project-media-parity')

describe('project-media-parity', () => {
	it('manifestSignature is stable for same entries', () => {
		const entries = [
			{ path: 'projects/demo/a.mp4', size: 100, mtime: 1 },
			{ path: 'projects/demo/b.mp4', size: 200, mtime: 2 },
		]
		assert.equal(manifestSignature(entries), manifestSignature([...entries].reverse()))
	})

	it('compareProjectMediaManifests finds localOnly, peerOnly, and size mismatch', () => {
		const local = [
			{ path: 'projects/demo/a.mp4', size: 100 },
			{ path: 'projects/demo/b.mp4', size: 50 },
		]
		const peer = [
			{ path: 'projects/demo/a.mp4', size: 100 },
			{ path: 'projects/demo/c.mp4', size: 10 },
		]
		const cmp = compareProjectMediaManifests(local, peer)
		assert.equal(cmp.inSync, false)
		assert.deepEqual(cmp.localOnly, ['projects/demo/b.mp4'])
		assert.deepEqual(cmp.peerOnly, ['projects/demo/c.mp4'])
		assert.equal(cmp.mismatched.length, 0)
	})

	it('compareProjectMediaManifests reports size mismatch', () => {
		const cmp = compareProjectMediaManifests(
			[{ path: 'projects/demo/a.mp4', size: 100 }],
			[{ path: 'projects/demo/a.mp4', size: 99 }],
		)
		assert.equal(cmp.inSync, false)
		assert.equal(cmp.mismatched.length, 1)
	})
})

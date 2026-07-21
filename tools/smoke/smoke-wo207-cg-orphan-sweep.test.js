'use strict'

/**
 * WO-207 smokes — template CG orphan lifecycle:
 *  - startup/reconnect sweep clears undeclared hosts 700-789, skips declared ones
 *  - POST /api/countdown/off emits a CG CLEAR and records `off` in the registry
 * (Written by the orchestrator: the implementer checked T207.5 without shipping this file.)
 */

const { test } = require('node:test')
const assert = require('node:assert')

const { sweepTemplateCgOrphansOnCasparConnected } = require('../../src/engine/template-cg-orphan-sweep')

function mockAmcp() {
	const lines = []
	return {
		lines,
		batchSendChunked: async (ls) => {
			lines.push(...ls)
		},
	}
}

test('WO-207 T207.3: sweep clears undeclared hosts, skips hosts declared by live looks', async () => {
	const amcp = mockAmcp()
	const liveState = {
		'3': {
			scene: {
				layers: [
					// countdown template layer on logical 11 → host 701 must be preserved
					{ layerNumber: 11, source: { value: 'countdown/countdown', type: 'template' } },
					// plain media layer — contributes nothing
					{ layerNumber: 10, source: { value: 'clip.mov', type: 'media' } },
				],
			},
		},
	}
	const res = await sweepTemplateCgOrphansOnCasparConnected({ amcp, liveState, channels: [3] })
	assert.equal(res.declaredCount, 1, 'one declared host')
	assert.ok(!amcp.lines.includes('CG 3-701 CLEAR'), 'declared host 701 is NOT cleared')
	assert.ok(amcp.lines.includes('CG 3-700 CLEAR'), 'undeclared host 700 IS cleared')
	assert.ok(amcp.lines.includes('CG 3-789 CLEAR'), 'band end 789 cleared')
	assert.ok(!amcp.lines.includes('CG 3-790 CLEAR'), 'sweep stays within 700-789')
	assert.equal(res.clearedCount, 89, '90-host band minus 1 declared')
})

test('WO-207 T207.3: sweep with no live looks clears the whole band per channel', async () => {
	const amcp = mockAmcp()
	const res = await sweepTemplateCgOrphansOnCasparConnected({ amcp, liveState: {}, channels: [1, 3] })
	assert.equal(res.clearedCount, 180, 'both channels fully swept')
	assert.ok(amcp.lines.includes('CG 1-700 CLEAR'))
	assert.ok(amcp.lines.includes('CG 3-789 CLEAR'))
})

test('WO-207 T207.3: sweep is a no-op without a usable amcp client', async () => {
	const res = await sweepTemplateCgOrphansOnCasparConnected({ amcp: null, liveState: {}, channels: [1] })
	assert.deepEqual(res, { clearedCount: 0, declaredCount: 0 })
})

test('WO-207 T207.4: POST /api/countdown/off emits CG CLEAR and records off in the registry', async () => {
	const routes = require('../../src/api/routes-countdown')
	const sent = []
	const ctx = {
		amcp: {
			cg: {
				cgUpdate: async () => {},
				cgClear: async (ch, layer) => sent.push(`CG ${ch}-${layer} CLEAR`),
			},
			raw: async (line) => sent.push(String(line).trim()),
			batchSendChunked: async (ls) => sent.push(...ls),
		},
		config: {},
	}
	const res = await routes.handlePost('/api/countdown/off', { channel: 3, layer: 11 }, ctx)
	assert.equal(res.status, 200, `off returns 200 (got ${res.status}: ${res.body})`)
	assert.ok(
		sent.some((l) => /CG 3-701/.test(l) && /CLEAR/i.test(l)),
		`a CG CLEAR for host 701 was emitted (sent: ${JSON.stringify(sent)})`,
	)
	const registry = routes.commandRegistry
	assert.ok(registry instanceof Map, 'registry exported')
	assert.equal(registry.get('3:11')?.lastCmd, 'off', 'registry records off')
})

test('sweep forces BEGIN…COMMIT batching (180 sequential sends saturate AMCP on every reconnect)', async () => {
	/** @type {object|undefined} */
	let seenOpts
	const amcp = {
		batchSendChunked: async (_lines, opts) => {
			seenOpts = opts
		},
	}
	await sweepTemplateCgOrphansOnCasparConnected({ amcp, liveState: {}, channels: [1, 2] })
	assert.equal(
		seenOpts?.forceBatch,
		true,
		'forceBatch must be set: config.amcp_batch is off, so without it batchSendChunked ' +
			'degrades to one serialized _send per line (~180 round-trips per startup)',
	)
	assert.equal(seenOpts?.skipMixerPreCommit, true, 'still must not inject a mixer pre-commit')
})

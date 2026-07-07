'use strict'

/**
 * WO-144 smoke — compose-preview defects:
 * 1. channel whose ADD is rejected (400) is blocklisted and never retried
 * 2. unchanged-signature refresh produces zero REMOVE/ADD AMCP commands
 * 3. legacy-index cleanup (REMOVE 98/700) runs once per process, not every cycle
 * AMCP client is mocked; REMOVE/ADD lines are counted.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const os = require('os')
const path = require('path')

const consumer = require('../../src/preview/compose-preview-consumer')
const blocklist = require('../../src/preview/compose-preview-blocklist')

const MEDIA_DIR = path.join(os.tmpdir(), `highascg-smoke-wo144-${process.pid}`)

/**
 * @param {{ channels?: number[], fps?: number, failChannels?: number[] }} [opts]
 */
function makeMockCtx(opts = {}) {
	const failChannels = new Set(opts.failChannels || [])
	/** @type {string[]} */
	const commands = []
	/** @type {{ type: string, payload: object }[]} */
	const events = []
	const ctx = {
		config: {
			local_media_path: MEDIA_DIR,
			composePreview: {
				mode: 'ffmpeg_jpeg',
				channels: opts.channels || [1, 3],
				fps: opts.fps ?? 5,
				resolutionScale: 'half',
				jpegQuality: 8,
				basenamePrefix: 'highascg_preview',
			},
		},
		log: () => {},
		_wsBroadcast: (type, payload) => events.push({ type, payload }),
		amcp: {
			isConnected: true,
			basic: {
				add: async (ch, cons, params, idx) => {
					commands.push(`ADD ${ch}-${idx} ${cons} ${params}`)
					if (failChannels.has(ch)) {
						throw new Error(`COMMAND_UNKNOWN_DATA: ADD ${ch}-${idx} FILE ${params}`)
					}
					return { ok: true }
				},
				remove: async (ch, _cons, idx) => {
					commands.push(`REMOVE ${ch}-${idx}`)
					return { ok: true }
				},
			},
			info: async () => ({ ok: true, data: [] }),
			raw: async (cmd) => {
				commands.push(cmd)
				return { ok: true }
			},
		},
	}
	return { ctx, commands, events, failChannels }
}

const addLines = (commands) => commands.filter((c) => c.startsWith('ADD '))
const removeLines = (commands) => commands.filter((c) => c.startsWith('REMOVE '))

describe('compose-preview WO-144 defects', () => {
	beforeEach(() => {
		consumer.resetComposeConsumerState()
		consumer.resetComposeLegacySweep()
		blocklist.resetComposeBlocklist()
	})

	it('classifies AMCP client errors as permanent, transports as retryable', () => {
		assert.equal(blocklist.isPermanentAddRejection('400 ERROR'), true)
		assert.equal(blocklist.isPermanentAddRejection('COMMAND_UNKNOWN_DATA: ADD 3-701 FILE x'), true)
		assert.equal(blocklist.isPermanentAddRejection('401 ERROR'), true)
		assert.equal(blocklist.isPermanentAddRejection('Not connected'), false)
		assert.equal(blocklist.isPermanentAddRejection('AMCP timeout after 8000ms: ADD 3-701'), false)
		assert.equal(blocklist.isPermanentAddRejection('501 FAILED'), false)
	})

	it('blocklists a channel whose ADD is rejected and never retries it', async () => {
		const { ctx, commands, events } = makeMockCtx({ channels: [1, 3], failChannels: [3] })
		const first = await consumer.syncComposeFileConsumers(ctx)
		assert.equal(first.attached, 1)
		assert.equal(first.blocked, 1)
		assert.equal(addLines(commands).filter((c) => c.startsWith('ADD 3-')).length, 1)
		assert.deepEqual(blocklist.getComposeBlocklistedChannels(), [3])
		const blockEvents = events.filter((e) => e.type === 'compose.preview' && e.payload.blocklisted === true)
		assert.equal(blockEvents.length, 1)
		assert.equal(blockEvents[0].payload.channel, 3)
		assert.deepEqual(blockEvents[0].payload.blocklistedChannels, [3])

		// Retry cycles: blocklisted ch3 must not be probed again, ch1 is untouched.
		commands.length = 0
		for (let i = 0; i < 3; i++) {
			const res = await consumer.syncComposeFileConsumers(ctx)
			assert.equal(res.blocked, 1)
			assert.equal(res.unchanged, 1)
		}
		assert.equal(addLines(commands).length, 0, `no ADD retries expected, got: ${commands.join(', ')}`)
		assert.equal(removeLines(commands).length, 0)

		// Surface: stats expose blocklist for the UI / routes.
		const stats = consumer.getComposeConsumerStats(ctx.config)
		assert.deepEqual(stats.blocklistedChannels, [3])
		assert.equal(stats.byChannel[3].blocklisted, true)
		assert.match(stats.byChannel[3].blocklistReason, /COMMAND_UNKNOWN_DATA/)
		assert.equal(stats.byChannel[1].blocklisted, false)
	})

	it('unchanged-signature refresh produces zero REMOVE/ADD commands', async () => {
		const { ctx, commands } = makeMockCtx({ channels: [1, 3] })
		await consumer.syncComposeFileConsumers(ctx)
		assert.equal(consumer.composeConsumersSettled(ctx.config), true)

		commands.length = 0
		const res = await consumer.syncComposeFileConsumers(ctx)
		assert.deepEqual(res, { attached: 0, detached: 0, unchanged: 2, blocked: 0 })
		assert.equal(removeLines(commands).length, 0, `zero REMOVE expected, got: ${commands.join(', ')}`)
		assert.equal(addLines(commands).length, 0, `zero ADD expected, got: ${commands.join(', ')}`)
		assert.equal(commands.length, 0)
	})

	it('signature change recycles only affected channels and re-arms blocklist probe', async () => {
		const { ctx, commands, failChannels } = makeMockCtx({ channels: [1, 3], failChannels: [3] })
		await consumer.syncComposeFileConsumers(ctx)
		assert.deepEqual(blocklist.getComposeBlocklistedChannels(), [3])

		// Config change affecting both channels: ch1 recycles, ch3 gets exactly one reprobe.
		ctx.config.composePreview.fps = 10
		commands.length = 0
		await consumer.syncComposeFileConsumers(ctx)
		assert.equal(commands.filter((c) => c === 'REMOVE 1-701').length, 1)
		assert.equal(commands.filter((c) => c.startsWith('ADD 1-701')).length, 1)
		assert.equal(commands.filter((c) => c.startsWith('ADD 3-701')).length, 1)
		assert.deepEqual(blocklist.getComposeBlocklistedChannels(), [3], 'reprobe failed → re-blocklisted')

		// Channel becomes valid (e.g. Caspar config fixed) + args change again → recovers.
		failChannels.delete(3)
		ctx.config.composePreview.fps = 12
		commands.length = 0
		await consumer.syncComposeFileConsumers(ctx)
		assert.deepEqual(blocklist.getComposeBlocklistedChannels(), [])
		assert.equal(consumer.composeConsumersSettled(ctx.config), true)
	})

	it('legacy-index cleanup (REMOVE 98/700) runs once per process, not every cycle', async () => {
		const { ctx, commands } = makeMockCtx({ channels: [1] })
		await consumer.syncComposeFileConsumers(ctx)
		assert.equal(commands.filter((c) => c === 'REMOVE 1-98').length, 1)
		assert.equal(commands.filter((c) => c === 'REMOVE 1-700').length, 1)

		// Force a real recycle (signature change) — legacy REMOVEs must not repeat.
		ctx.config.composePreview.jpegQuality = 5
		commands.length = 0
		await consumer.syncComposeFileConsumers(ctx)
		assert.equal(commands.filter((c) => c === 'REMOVE 1-701').length, 1)
		assert.equal(commands.filter((c) => c === 'REMOVE 1-98').length, 0)
		assert.equal(commands.filter((c) => c === 'REMOVE 1-700').length, 0)
	})

	it('routing shrink detaches only the removed channel', async () => {
		const { ctx, commands } = makeMockCtx({ channels: [1, 2] })
		await consumer.syncComposeFileConsumers(ctx)

		ctx.config.composePreview.channels = [1]
		commands.length = 0
		const res = await consumer.syncComposeFileConsumers(ctx)
		assert.equal(res.detached, 1)
		assert.equal(res.unchanged, 1)
		assert.deepEqual(removeLines(commands), ['REMOVE 2-701'])
		assert.equal(addLines(commands).length, 0)
	})
})

'use strict'

/**
 * WO-144 smoke — compose-preview defects:
 * 1. channel whose ADD is rejected (400) is blocklisted and never retried
 * 2. unchanged-signature refresh produces zero REMOVE/ADD AMCP commands
 * 3. legacy-index cleanup (REMOVE 98/700) runs once per process, not every cycle
 * AMCP client is mocked; REMOVE/ADD lines are counted.
 *
 * WO-159 smoke — stale-frame defects:
 * 4. blocklist truncates chN.jpg so the size<=32 serve gate 404s (no stale frame)
 * 5. detach without replacement truncates chN.jpg
 * 6. meta staleness gate 404s only for attached live-writing channels
 * 7. initial-state payload (WS bootstrap) carries the blocklist
 * 8. client blocklist survives resetComposePreviewClientCache (re-seed)
 *
 * WO-159 follow-up (T159.3 root cause) — blocklist reset on Caspar reconnect:
 * a "channel doesn't exist" 400 is only valid for the Caspar instance that produced it;
 * `resetComposeBlocklistOnReconnect` must clear the blocklist (even with an UNCHANGED
 * ADD-params signature, unlike the existing config-change re-arm path) so the next sync
 * reprobes, and must broadcast the cleared state on the existing `compose.preview` shape.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const consumer = require('../../src/preview/compose-preview-consumer')
const blocklist = require('../../src/preview/compose-preview-blocklist')
const cache = require('../../src/preview/compose-preview-cache')

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

describe('compose-preview WO-159 stale-frame defects', () => {
	const jpgPath = (ch) => path.join(MEDIA_DIR, 'highascg_preview', `ch${ch}.jpg`)

	/** Simulate a frame the FILE consumer wrote earlier (like the stale Jul 5 ch3.jpg). */
	function writeFakeFrame(ch, bytes = 4096) {
		const fp = jpgPath(ch)
		fs.mkdirSync(path.dirname(fp), { recursive: true })
		fs.writeFileSync(fp, Buffer.alloc(bytes, 7))
		return fp
	}

	beforeEach(() => {
		consumer.resetComposeConsumerState()
		consumer.resetComposeLegacySweep()
		blocklist.resetComposeBlocklist()
	})

	it('blocklist truncates the stale chN.jpg so the serve gate 404s', async () => {
		const { ctx } = makeMockCtx({ channels: [1, 3], failChannels: [3] })
		const fp = writeFakeFrame(3)
		await consumer.syncComposeFileConsumers(ctx)
		assert.deepEqual(blocklist.getComposeBlocklistedChannels(), [3])
		assert.equal(fs.statSync(fp).size, 0, 'blocklist must truncate the stale frame')
		const meta = await cache.handleComposePreviewMetaGet({ config: ctx.config }, 3)
		assert.equal(meta.status, 404)
		assert.match(String(meta.body), /empty/)
		const img = await cache.handleComposePreviewImageGet({ config: ctx.config }, 3)
		assert.equal(img.status, 404)
	})

	it('detach without replacement truncates the channel jpg', async () => {
		const { ctx } = makeMockCtx({ channels: [1, 2] })
		await consumer.syncComposeFileConsumers(ctx)
		const fp = writeFakeFrame(2)

		ctx.config.composePreview.channels = [1]
		const res = await consumer.syncComposeFileConsumers(ctx)
		assert.equal(res.detached, 1)
		assert.equal(fs.statSync(fp).size, 0, 'detached channel must not keep a stale frame')
	})

	it('meta staleness gate 404s only for attached live-writing channels', async () => {
		const { ctx } = makeMockCtx({ channels: [1] })
		await consumer.syncComposeFileConsumers(ctx)
		assert.equal(consumer.isComposeConsumerAttached(1), true)
		const fp = writeFakeFrame(1)
		const old = new Date(Date.now() - 10 * 60_000)
		fs.utimesSync(fp, old, old)

		let meta = await cache.handleComposePreviewMetaGet({ config: ctx.config }, 1)
		assert.equal(meta.status, 404, 'attached but not written for 10 min → stale')
		assert.match(String(meta.body), /stale/)

		const now = new Date()
		fs.utimesSync(fp, now, now)
		meta = await cache.handleComposePreviewMetaGet({ config: ctx.config }, 1)
		assert.equal(meta.status, 200, 'fresh frame from attached consumer is served')

		// Detached channel: an old frame is legitimate (not expected to be live-writing).
		fs.utimesSync(fp, old, old)
		consumer.resetComposeConsumerState()
		meta = await cache.handleComposePreviewMetaGet({ config: ctx.config }, 1)
		assert.equal(meta.status, 200, 'staleness gate must not 404 paused/detached previews')
	})

	it('initial-state payload (WS bootstrap) carries the blocklist', () => {
		const defaults = require('../../src/config/defaults')
		const { getState } = require('../../src/api/get-state')
		blocklist.blocklistComposeChannel(3, { reason: '400 ERROR', signature: 'sig' })
		const st = getState({ config: { ...defaults }, log: () => {} })
		assert.deepEqual(st.composePreview.blocklist.channels, [3])
		assert.match(st.composePreview.blocklist.byChannel[3].reason, /400 ERROR/)
	})

	it('client blocklist survives resetComposePreviewClientCache (re-seed)', async () => {
		const mod = await import('../../client/components/preview-canvas-compose-snapshot.js')
		mod.syncComposePreviewBlocklist({ channels: [3], byChannel: { 3: { reason: '400 ERROR' } } })
		assert.equal(mod.isComposePreviewChannelBlocklisted(3), true)

		mod.resetComposePreviewClientCache()
		assert.equal(
			mod.isComposePreviewChannelBlocklisted(3),
			true,
			'cache reset must re-seed the server blocklist',
		)

		// Server bootstrap saying "nothing blocklisted" clears both live map and seed.
		mod.syncComposePreviewBlocklist({ channels: [] })
		assert.equal(mod.isComposePreviewChannelBlocklisted(3), false)
		mod.resetComposePreviewClientCache()
		assert.equal(mod.isComposePreviewChannelBlocklisted(3), false)
	})
})

describe('compose-preview WO-159 follow-up: blocklist reset on Caspar reconnect', () => {
	beforeEach(() => {
		consumer.resetComposeConsumerState()
		consumer.resetComposeLegacySweep()
		blocklist.resetComposeBlocklist()
	})

	it('clears the blocklist and lets a subsequent sync reprobe an UNCHANGED signature', async () => {
		const { ctx, commands, events, failChannels } = makeMockCtx({ channels: [1, 3], failChannels: [3] })
		await consumer.syncComposeFileConsumers(ctx)
		assert.deepEqual(blocklist.getComposeBlocklistedChannels(), [3])

		// Simulate the WO-159 T159.3 race resolving itself: Caspar restarts with the
		// channel now present, but the ADD params signature the app sends is UNCHANGED —
		// without the reconnect reset this stays blocklisted forever (WO-144 only re-arms
		// on a signature change).
		failChannels.delete(3)
		events.length = 0
		commands.length = 0
		const cleared = blocklist.resetComposeBlocklistOnReconnect(ctx)
		assert.deepEqual(cleared, [3])
		assert.deepEqual(blocklist.getComposeBlocklistedChannels(), [])

		// Cleared state broadcasts on the existing compose.preview event shape.
		const clearEvents = events.filter((e) => e.type === 'compose.preview' && e.payload.blocklisted === false)
		assert.equal(clearEvents.length, 1)
		assert.equal(clearEvents[0].payload.channel, 3)
		assert.equal(clearEvents[0].payload.reason, null)
		assert.deepEqual(clearEvents[0].payload.blocklistedChannels, [])

		// Next sync (same, unchanged signature) reprobes because the blocklist gate is gone.
		const res = await consumer.syncComposeFileConsumers(ctx)
		assert.equal(
			commands.filter((c) => c.startsWith('ADD 3-701')).length,
			1,
			'ch3 must be reprobed with an unchanged signature after reconnect reset',
		)
		assert.equal(res.attached, 1)
		assert.equal(res.blocked, 0)
		assert.deepEqual(blocklist.getComposeBlocklistedChannels(), [])
		assert.equal(consumer.composeConsumersSettled(ctx.config), true)
	})

	it('reprobe that still fails re-blocklists the channel (race not actually resolved)', async () => {
		const { ctx, commands } = makeMockCtx({ channels: [1, 3], failChannels: [3] })
		await consumer.syncComposeFileConsumers(ctx)
		assert.deepEqual(blocklist.getComposeBlocklistedChannels(), [3])

		commands.length = 0
		blocklist.resetComposeBlocklistOnReconnect(ctx)
		const res = await consumer.syncComposeFileConsumers(ctx)
		assert.equal(commands.filter((c) => c.startsWith('ADD 3-701')).length, 1)
		assert.equal(res.blocked, 1)
		assert.deepEqual(blocklist.getComposeBlocklistedChannels(), [3])
	})

	it('no-op reset when nothing is blocklisted: no broadcast, empty return', () => {
		const { ctx, events } = makeMockCtx({ channels: [1, 3] })
		const cleared = blocklist.resetComposeBlocklistOnReconnect(ctx)
		assert.deepEqual(cleared, [])
		assert.equal(events.filter((e) => e.type === 'compose.preview').length, 0)
	})

	it('tolerates a missing ctx (no _wsBroadcast/log) without throwing', () => {
		blocklist.blocklistComposeChannel(3, { reason: '400 ERROR', signature: 'sig' })
		assert.doesNotThrow(() => blocklist.resetComposeBlocklistOnReconnect())
		assert.deepEqual(blocklist.getComposeBlocklistedChannels(), [])
	})
})

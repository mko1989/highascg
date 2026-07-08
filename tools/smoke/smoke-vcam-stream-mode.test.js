'use strict'

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
	attachV4l2BridgeConsumer,
	detachV4l2BridgeConsumer,
	resetV4l2BridgeConsumerState,
	getV4l2BridgeConsumerStats,
} = require('../../src/virtual-output/v4l2-bridge-consumer')
const { buildV4l2BridgeRelayArgs } = require('../../src/virtual-output/v4l2-bridge-relay')
const { normalizeVirtualCameraConfig } = require('../../src/virtual-output/v4l2-bridge-config')
const { validateVirtualCameraConfig } = require('../../src/virtual-output/v4l2-bridge-config-validate')

const tmpMedia = fs.mkdtempSync(path.join(os.tmpdir(), 'vcam-stream-smoke-'))

/** Mock AMCP that records wire-equivalent command lines (amcp-basic.js formatting). */
function mockCtx(virtualCamera) {
	const lines = []
	return {
		lines,
		config: { local_media_path: tmpMedia, virtualCamera },
		log: () => {},
		amcp: {
			isConnected: true,
			basic: {
				add: (ch, consumerType, params, idx) => {
					lines.push(`ADD ${ch}${idx != null ? '-' + idx : ''} ${consumerType} ${params}`)
					return Promise.resolve({ ok: true })
				},
				remove: (ch, consumerType, idx) => {
					lines.push(`REMOVE ${ch}${idx != null ? '-' + idx : consumerType ? ' ' + consumerType : ''}`)
					return Promise.resolve({ ok: true })
				},
			},
			raw: (cmd) => {
				lines.push(cmd)
				return Promise.resolve({ ok: true })
			},
			info: () => Promise.resolve({ ok: true, data: '' }),
		},
	}
}

describe('vcam stream mode (WO-145)', () => {
	beforeEach(() => resetV4l2BridgeConsumerState())

	it('jpeg mode attaches a FILE consumer on slot 710', async () => {
		const ctx = mockCtx({ enabled: true, channel: 1, mode: 'jpeg' })
		await attachV4l2BridgeConsumer(ctx, 1)
		const adds = ctx.lines.filter((l) => l.startsWith('ADD '))
		assert.equal(adds.length, 1)
		assert.match(adds[0], /^ADD 1-710 FILE media\/highascg_vcam\/ch1\.jpg /)
		assert.match(adds[0], /-format image2 -update 1/)
		assert.ok(!adds[0].includes('udp://'))
		assert.equal(getV4l2BridgeConsumerStats(ctx.config).transport, 'file_mjpeg_update1')
		await detachV4l2BridgeConsumer(ctx)
	})

	it('stream mode attaches a STREAM udp consumer on slot 710 (nut/mjpeg + stereo aac)', async () => {
		const ctx = mockCtx({ enabled: true, channel: 1, mode: 'stream', streamPort: 5555 })
		await attachV4l2BridgeConsumer(ctx, 1)
		const adds = ctx.lines.filter((l) => l.startsWith('ADD '))
		assert.equal(adds.length, 1)
		assert.match(adds[0], /^ADD 1-710 STREAM udp:\/\/127\.0\.0\.1:5555\?localport=15555 /)
		assert.match(adds[0], /-format nut /)
		assert.match(adds[0], /-codec:v mjpeg/)
		// mpegts default mp2 audio rejects Caspar's 16-ch layout — stream must carry stereo aac.
		assert.match(adds[0], /-filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a aac/)
		assert.ok(!adds[0].includes(' FILE '))
		assert.equal(getV4l2BridgeConsumerStats(ctx.config).transport, 'stream_udp_nut_mjpeg')
		await detachV4l2BridgeConsumer(ctx)
	})

	it('relay args branch on mode: jpeg loops the buffer, stream reads udp', () => {
		const jpeg = buildV4l2BridgeRelayArgs({ local_media_path: tmpMedia, virtualCamera: { mode: 'jpeg' } }, 1)
		assert.equal(jpeg.mode, 'jpeg')
		assert.ok(jpeg.args.includes('-stream_loop'))
		assert.ok(jpeg.args.includes(path.join(tmpMedia, 'highascg_vcam/ch1.jpg')))
		assert.equal(jpeg.args[jpeg.args.length - 1], '/dev/video10')

		const stream = buildV4l2BridgeRelayArgs(
			{ local_media_path: tmpMedia, virtualCamera: { mode: 'stream', streamPort: 6001 } },
			1,
		)
		assert.equal(stream.mode, 'stream')
		assert.ok(stream.args.includes('udp://127.0.0.1:6001?timeout=5000000'))
		assert.ok(!stream.args.includes('-stream_loop'))
		assert.ok(stream.args.includes('-an'))
		assert.equal(stream.args[stream.args.length - 1], '/dev/video10')
		assert.notDeepEqual(stream.args, jpeg.args)
	})

	it('rejects invalid mode, defaults to jpeg', () => {
		const bad = validateVirtualCameraConfig({ mode: 'rtmp' })
		assert.equal(bad.ok, false)
		assert.ok(bad.errors.some((e) => e.includes('mode')))

		assert.equal(normalizeVirtualCameraConfig({}).mode, 'jpeg')
		assert.equal(normalizeVirtualCameraConfig({ mode: 'STREAM' }).mode, 'stream')
		assert.equal(normalizeVirtualCameraConfig({ mode: 'bogus' }).mode, 'jpeg')
		assert.equal(validateVirtualCameraConfig({ mode: 'stream' }).ok, true)
		assert.equal(validateVirtualCameraConfig({ mode: 'stream', streamPort: 80 }).ok, false)
	})
})

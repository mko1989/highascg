'use strict'

const {
	casparUdpStreamUriVariantsForRemove,
	getActiveStreamUris,
} = require('../streaming/caspar-ffmpeg-setup')
const { buildV4l2BridgeCasparAddParams } = require('./v4l2-bridge-args')
const { ensureV4l2BridgeJpgStub } = require('./v4l2-bridge-cache')

/** AMCP slot for v4l2 bridge FILE (mjpeg image2 -update 1). */
const V4L2_BRIDGE_CONSUMER_INDEX = 710
/** Legacy manual test consumers. */
const LEGACY_CONSUMER_INDICES = [96]
/** Legacy UDP test port from earlier experiments. */
const LEGACY_UDP_PORT = 52301

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/** @type {{ attached: boolean, channel: number|null, lastError?: string, attachedAt?: number, amcpPath?: string }} */
let _state = { attached: false, channel: null }

/**
 * @param {object} ctx
 * @param {number} channel
 */
async function removeV4l2BridgeConsumer(ctx, channel) {
	if (!ctx?.amcp?.isConnected) return
	const ch = parseInt(String(channel), 10)
	const variants = casparUdpStreamUriVariantsForRemove(LEGACY_UDP_PORT)

	if (ctx.amcp.basic?.remove) {
		for (const idx of [V4L2_BRIDGE_CONSUMER_INDEX, ...LEGACY_CONSUMER_INDICES]) {
			try {
				await ctx.amcp.basic.remove(ch, null, idx)
			} catch {
				/* ok */
			}
		}
	}
	try {
		const active = await getActiveStreamUris(ctx.amcp, ch)
		for (const u of active) {
			if (variants.includes(u) || u.includes(`:${LEGACY_UDP_PORT}`)) {
				try {
					await ctx.amcp.raw(`REMOVE ${ch} STREAM ${u}`)
				} catch {
					/* ok */
				}
			}
		}
	} catch {
		/* ok */
	}
}

/**
 * Caspar FILE consumer → overwriting JPEG under media/ (compose-preview pattern).
 * @param {object} ctx
 * @param {number} channel
 */
async function attachV4l2BridgeConsumer(ctx, channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return
	if (!ctx?.amcp?.isConnected) {
		_state = { attached: false, channel: ch, lastError: 'AMCP not connected' }
		return
	}

	await ensureV4l2BridgeJpgStub(ctx.config || {}, ch)
	await removeV4l2BridgeConsumer(ctx, ch)
	await delay(150)

	const { amcpPath, params } = buildV4l2BridgeCasparAddParams(ctx.config || {}, ch)
	try {
		const res = await ctx.amcp.basic.add(ch, 'FILE', params, V4L2_BRIDGE_CONSUMER_INDEX)
		if (res && res.ok === false) {
			throw new Error(res.error || 'ADD FILE failed')
		}
		_state = { attached: true, channel: ch, attachedAt: Date.now(), amcpPath, lastError: undefined }
		ctx.log?.('info', `[v4l2-bridge] ch${ch} FILE consumer → ${amcpPath} (image2 -update 1, full-res buffer)`)
	} catch (e) {
		const msg = e?.message || String(e)
		_state = { attached: false, channel: ch, lastError: msg }
		ctx.log?.('warn', `[v4l2-bridge] ch${ch} ADD FILE failed: ${msg}`)
	}
}

/**
 * @param {object} ctx
 */
async function detachV4l2BridgeConsumer(ctx) {
	const ch = _state.channel
	if (ch && ctx?.amcp?.isConnected) {
		await removeV4l2BridgeConsumer(ctx, ch)
	}
	_state = { attached: false, channel: ch ?? null }
	if (ctx) ctx.log?.('debug', '[v4l2-bridge] Caspar consumer removed')
}

function getV4l2BridgeConsumerStats(config) {
	const vc = config?.virtualCamera || {}
	const ch = Math.max(1, parseInt(String(vc.channel ?? _state.channel ?? 1), 10) || 1)
	const { amcpPath } = buildV4l2BridgeCasparAddParams(config || {}, ch)
	return {
		consumerIndex: V4L2_BRIDGE_CONSUMER_INDEX,
		transport: 'file_mjpeg_update1',
		channel: ch,
		attached: !!_state.attached && _state.channel === ch,
		lastError: _state.lastError || null,
		attachedAt: _state.attachedAt || null,
		amcpPath: _state.amcpPath ?? amcpPath,
	}
}

function resetV4l2BridgeConsumerState() {
	_state = { attached: false, channel: null }
}

module.exports = {
	V4L2_BRIDGE_CONSUMER_INDEX,
	attachV4l2BridgeConsumer,
	detachV4l2BridgeConsumer,
	removeV4l2BridgeConsumer,
	getV4l2BridgeConsumerStats,
	resetV4l2BridgeConsumerState,
}

'use strict'

const fs = require('fs')
const path = require('path')
const { getMediaIngestBasePath, resolveSafe } = require('../media/local-media-paths')
const { getV4l2BridgeJpgBasename } = require('./v4l2-bridge-args')

/**
 * Absolute path for the overwriting JPEG buffer (Caspar image2 -update 1).
 * @param {object} config
 * @param {number} channel
 * @returns {string | null}
 */
function resolveV4l2BridgeJpgPath(config, channel) {
	const base = getV4l2BridgeJpgBasename(config, channel)
	return resolveSafe(getMediaIngestBasePath(config), base)
}

/**
 * AMCP path under media/ (Caspar resolves relative to media-path).
 * @param {object} config
 * @param {number} channel
 * @returns {string}
 */
function getV4l2BridgeJpgAmcpPath(config, channel) {
	return `media/${getV4l2BridgeJpgBasename(config, channel)}`
}

/**
 * Ensure media dir + empty stub exist before ADD FILE (same pattern as compose preview).
 * @param {object} config
 * @param {number} channel
 */
async function ensureV4l2BridgeJpgStub(config, channel) {
	const outPath = resolveV4l2BridgeJpgPath(config, channel)
	if (!outPath) return
	await fs.promises.mkdir(path.dirname(outPath), { recursive: true }).catch(() => {})
	try {
		if (!fs.existsSync(outPath)) fs.writeFileSync(outPath, Buffer.alloc(0))
	} catch {
		/* ok */
	}
}

/**
 * Wait until Caspar has written a non-empty JPEG.
 * @param {string} filePath
 * @param {number} timeoutMs
 */
async function waitForV4l2BridgeJpgReady(filePath, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const st = await fs.promises.stat(filePath)
			if (st.size > 256) return true
		} catch {
			/* not ready */
		}
		await new Promise((r) => setTimeout(r, 80))
	}
	return false
}

module.exports = {
	resolveV4l2BridgeJpgPath,
	getV4l2BridgeJpgAmcpPath,
	ensureV4l2BridgeJpgStub,
	waitForV4l2BridgeJpgReady,
}

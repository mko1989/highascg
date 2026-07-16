'use strict'

/**
 * host-live-sources-browser-runtime.js — WO-258 T258.2/T258.3: the async "make sure the OS-level
 * pipeline is actually running" step for browser_display sources, called by
 * host-live-sources-setup.js right before it runs `amcpCommandsForHostLiveSource`'s
 * `PLAY ch-layer udp://...` (host-live-sources.js itself stays synchronous/pure, mirroring how
 * v4l2-bridge.js's startV4l2BridgeInternal sequences kernel-modules -> relay -> Caspar consumer
 * before anything can play; here it's Firefox session -> capture bridge -> PLAY).
 *
 * Kept in its own file (rather than inside host-live-sources.js) to avoid a require cycle:
 * host-live-sources.js is pure config/string-building with no process/child_process reach, while
 * this module pulls in the region resolver, session manager, and capture bridge (all of which spawn
 * real processes outside of NODE_TEST_CONTEXT).
 */

const { isBrowserDisplayCandidate } = require('./host-live-sources')
const { resolveBrowserOffscreenRegion } = require('../capture/browser-source-region')
const { launchBrowserSource } = require('../system/browser-source-session')
const { ensureBrowserCaptureBridge } = require('../capture/browser-capture-bridge')

function isTestContext() {
	return !!process.env.NODE_TEST_CONTEXT
}

/**
 * @param {object} ctx
 * @param {object} item - normalized browser_display extraLiveSources entry
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function ensureBrowserDisplaySourceReady(ctx, item) {
	if (!isBrowserDisplayCandidate(item)) return { ok: false, reason: 'not_browser_display' }
	// Curated-gate/unit-test safety (mirrors operator-shape-overlay.js's NODE_TEST_CONTEXT guard):
	// never shell out to real Xvfb/firefox/ffmpeg from `node --test`.
	if (isTestContext()) return { ok: true, reason: 'test_context_skip' }

	const region = resolveBrowserOffscreenRegion(item.width, item.height)
	if (!region) {
		ctx?.log?.(
			'warn',
			`[browser-source] ${item.sourceId}: no off-screen dead zone fits ${item.width}x${item.height} in the current :0 layout — refusing to grow the framebuffer live (see T258.0 report)`,
		)
		return { ok: false, reason: 'no_offscreen_region' }
	}

	const launch = await launchBrowserSource(ctx, item, region)
	if (!launch.ok) return { ok: false, reason: launch.reason || 'launch_failed' }

	const bridgeReady = await ensureBrowserCaptureBridge(ctx, item.sourceId, region, item.hostChannel, {
		fps: item.fps,
	})
	if (!bridgeReady) return { ok: false, reason: 'capture_bridge_failed' }

	return { ok: true }
}

module.exports = { ensureBrowserDisplaySourceReady }

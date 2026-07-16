'use strict'

/**
 * WO-258 smoke tests — browser_display live source (real Firefox on an off-screen `:0` region,
 * captured via x11grab, relayed into Caspar as a udp:// clip). Curated-gate rule: pure logic only —
 * NO real Xvfb/ffmpeg/firefox spawns (see browser-source-session.js/browser-capture-bridge.js, which
 * spawn real child_process regardless of NODE_TEST_CONTEXT — this file must never call
 * launchBrowserSource/startBrowserCaptureBridge/moveBrowserSourceToOperator directly, only their pure
 * helpers and "unknown id" status paths, mirroring smoke-wo255-shaped-overlay.test.js's convention
 * for operator-gui-launcher.js).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { REPO_ROOT } = require('../../src/repo-paths')
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8')

const { computeDeadZoneRegion, parseResolutionString } = require('../../src/capture/browser-source-region')
const {
	browserCaptureUdpPort,
	browserCapturePlayClip,
	clampBrowserCaptureFps,
	buildBrowserCaptureFfmpegArgs,
	BROWSER_CAPTURE_UDP_PORT_BASE,
} = require('../../src/capture/browser-capture-args')
const { browserCaptureBridgeStatus, resetBrowserCaptureBridgeStateForTests } = require('../../src/capture/browser-capture-bridge')
const { slugSourceId, profileDirFor, browserSourceStats, resetBrowserSourceSessionStateForTests } = require('../../src/system/browser-source-session')
const {
	isBrowserDisplayCandidate,
	isWebpageHostCandidate,
	isHostLiveSource,
	normalizeBrowserDisplaySource,
	amcpCommandsForHostLiveSource,
	hostChannelDestinationId,
	listHostLiveChannelEntries,
} = require('../../src/config/host-live-sources')
const { enrichExtraLiveSource } = require('../../src/config/extra-live-source-enrich')

describe('WO-258 T258.0: off-screen dead-zone region resolver (pure)', () => {
	it('parseResolutionString parses "WxH"', () => {
		assert.deepEqual(parseResolutionString('1920x1080'), { w: 1920, h: 1080 })
		assert.equal(parseResolutionString('bogus'), null)
		assert.equal(parseResolutionString(''), null)
	})

	it('finds the real live-box dead zone: DP-0 3072x1728@0,0 + DP-5 1920x1080@3072,0 -> 1920x648 gap at 3072,1080 (read-only xrandr-probed 2026-07-16)', () => {
		const canvas = { width: 4992, height: 1728 }
		const monitors = [
			{ x: 0, y: 0, w: 3072, h: 1728 },
			{ x: 3072, y: 0, w: 1920, h: 1080 },
		]
		const region = computeDeadZoneRegion(canvas, monitors, 1280, 600)
		assert.deepEqual(region, { x: 3072, y: 1080, w: 1280, h: 600 })
	})

	it('refuses (returns null) when the requested size exceeds every dead zone — never silently grows the canvas', () => {
		const canvas = { width: 4992, height: 1728 }
		const monitors = [
			{ x: 0, y: 0, w: 3072, h: 1728 },
			{ x: 3072, y: 0, w: 1920, h: 1080 },
		]
		// Full 1080p (WO-258's stated default) does NOT fit the 1920x648 dead zone's height.
		assert.equal(computeDeadZoneRegion(canvas, monitors, 1920, 1080), null)
	})

	it('returns null for equal-height side-by-side monitors (no dead zone exists, not a bug)', () => {
		const canvas = { width: 3840, height: 1080 }
		const monitors = [
			{ x: 0, y: 0, w: 1920, h: 1080 },
			{ x: 1920, y: 0, w: 1920, h: 1080 },
		]
		assert.equal(computeDeadZoneRegion(canvas, monitors, 640, 480), null)
	})

	it('degenerate inputs (zero canvas/monitors/size) return null, not NaN/throw', () => {
		assert.equal(computeDeadZoneRegion({ width: 0, height: 0 }, [], 100, 100), null)
		assert.equal(computeDeadZoneRegion({ width: 1920, height: 1080 }, [], 100, 100), null)
		assert.equal(computeDeadZoneRegion({ width: 1920, height: 1080 }, [{ x: 0, y: 0, w: 1920, h: 1080 }], 0, 0), null)
	})
})

describe('WO-258 T258.2: capture-args pure builders', () => {
	it('browserCaptureUdpPort is BASE + hostChannel, distinct from v4l2-input-bridge\'s 52400 base', () => {
		assert.equal(BROWSER_CAPTURE_UDP_PORT_BASE, 53000)
		assert.equal(browserCaptureUdpPort(3), 53003)
		assert.equal(browserCaptureUdpPort(0), 53001, 'clamped to channel >= 1')
	})

	it('browserCapturePlayClip builds a passthrough udp:// clip', () => {
		assert.equal(browserCapturePlayClip(3), 'udp://127.0.0.1:53003?overrun_nonfatal=1&fifo_size=65536')
	})

	it('clampBrowserCaptureFps defaults to 25 and clamps to [1,60]', () => {
		assert.equal(clampBrowserCaptureFps(undefined), 25)
		assert.equal(clampBrowserCaptureFps('bogus'), 25)
		assert.equal(clampBrowserCaptureFps(0), 1)
		assert.equal(clampBrowserCaptureFps(999), 60)
		assert.equal(clampBrowserCaptureFps(30), 30)
	})

	it('buildBrowserCaptureFfmpegArgs: x11grab of the region, h264/mpegts to the derived udp port', () => {
		const args = buildBrowserCaptureFfmpegArgs({ x: 3072, y: 1080, w: 1280, h: 600 }, 3, { fps: 25 })
		assert.ok(args.includes('x11grab'))
		assert.ok(args.includes('1280x600'))
		assert.ok(args.includes(':0.0+3072,1080'))
		assert.ok(args.includes('libx264'))
		assert.ok(args.some((a) => String(a).includes('53003')))
		assert.ok(args.includes('-an'), 'audio explicitly out of scope for v1')
	})

	it('browserCaptureBridgeStatus for an unknown sourceId is {running:false} (no spawn)', () => {
		resetBrowserCaptureBridgeStateForTests()
		assert.deepEqual(browserCaptureBridgeStatus('nope'), { running: false })
	})
})

describe('WO-258 T258.1: session-manager pure logic (no real firefox spawn)', () => {
	it('slugSourceId normalizes to a filesystem-safe slug', () => {
		assert.equal(slugSourceId('My Browser Source!!'), 'my_browser_source')
		assert.equal(slugSourceId(''), 'browser')
	})

	it('profileDirFor is a dedicated per-source directory under .browser-source-profiles', () => {
		const dir = profileDirFor('scoreboard widget')
		assert.match(dir, /\.browser-source-profiles[/\\]scoreboard_widget$/)
	})

	it('browserSourceStats for an unknown sourceId is {running:false} (no spawn)', () => {
		resetBrowserSourceSessionStateForTests()
		assert.deepEqual(browserSourceStats('nope'), { running: false })
	})

	it('spawns firefox-esr --kiosk with a dedicated per-source profile, xdotool positions via --pid (not --class, N-instance safe)', () => {
		const src = read('src/system/browser-source-session.js')
		assert.match(src, /--kiosk/)
		assert.match(src, /--new-instance/)
		assert.match(src, /browser-source-profiles/)
		assert.match(src, /search', '--pid'/)
		assert.match(src, /windowmove/)
		assert.match(src, /windowsize/)
		assert.match(src, /windowactivate/)
		assert.match(src, /displaySessionEnv/, 'reuses the existing :0 session env unchanged (T258.0 strategy 2)')
	})
})

describe('WO-258 T258.3: source type/config + host-channel routing', () => {
	it('isBrowserDisplayCandidate / isWebpageHostCandidate are mutually exclusive for a browser_display item', () => {
		const item = { type: 'browser', routeType: 'browser_display', mode: 'browser_display', url: 'https://example.com' }
		assert.equal(isBrowserDisplayCandidate(item), true)
		assert.equal(isWebpageHostCandidate(item), false)
		assert.equal(isHostLiveSource(item), true)
	})

	it('normalizeBrowserDisplaySource requires an http(s) url and fills in defaults', () => {
		assert.throws(() => normalizeBrowserDisplaySource({}, { config: {} }), /http\(s\) URL/)
		const out = normalizeBrowserDisplaySource({ url: 'https://example.com/widget', hostChannel: 7 }, { config: {} })
		assert.equal(out.routeType, 'browser_display')
		assert.equal(out.type, 'browser')
		assert.equal(out.hostChannel, 7)
		assert.equal(out.hostLayer, 1)
		assert.equal(out.width, 1920)
		assert.equal(out.height, 1080)
		assert.equal(out.fps, 25)
		assert.equal(out.interactiveCapable, true)
		assert.equal(out.value, 'route://7-1')
		assert.match(out.sourceId, /^browser_/)
	})

	it('config round-trip: normalize -> amcpCommandsForHostLiveSource plays the derived udp clip', () => {
		const item = normalizeBrowserDisplaySource({ url: 'https://example.com', hostChannel: 5, hostLayer: 1 }, { config: {} })
		const cmds = amcpCommandsForHostLiveSource(item)
		assert.equal(cmds[0], 'PLAY 5-1 udp://127.0.0.1:53005?overrun_nonfatal=1&fifo_size=65536')
		assert.equal(cmds[1], 'MIXER 5-1 FILL 0 0 1 1')
		assert.equal(cmds[2], 'MIXER 5 COMMIT')
	})

	it('listHostLiveChannelEntries reports kind browser_display and DEFAULT_HOST_MODE (like ndi_host)', () => {
		const item = normalizeBrowserDisplaySource({ url: 'https://example.com', hostChannel: 9 }, { config: {} })
		const config = { extraLiveSources: [item] }
		const entries = listHostLiveChannelEntries(config)
		assert.equal(entries.length, 1)
		assert.equal(entries[0].kind, 'browser_display')
		assert.equal(entries[0].mode, '1080p5000')
	})

	it('hostChannelDestinationId("browser_display", ch, sourceId) is stable and distinct from webpage/ndi', () => {
		assert.equal(hostChannelDestinationId('browser_display', 3, 'browser_x'), 'host_browser_browser_x')
		// slotOrSourceId ?? ch: with no sourceId, ch itself is the fallback (same behavior as the
		// existing webpage_host/ndi_host branches this mirrors).
		assert.equal(hostChannelDestinationId('browser_display', 3, null), 'host_browser_3')
	})

	it('enrichExtraLiveSource uses the item\'s own declared width/height for browser_display resolution', () => {
		const item = normalizeBrowserDisplaySource({ url: 'https://example.com', hostChannel: 4, width: 1280, height: 600 }, { config: {} })
		const enriched = enrichExtraLiveSource(item, { config: {} })
		assert.equal(enriched.resolution, '1280×600')
		assert.equal(enriched.thumbnailChannel, 4)
	})
})

describe('WO-258 T258.2: capture relay reuses the v4l2-input-bridge PRECEDENT, not the (opposite-direction) v4l2-bridge output relay', () => {
	it('browser-capture-args.js documents why v4l2-input-bridge.js (not virtual-output/v4l2-bridge.js) is the reused precedent', () => {
		const src = read('src/capture/browser-capture-args.js')
		assert.match(src, /v4l2-input-bridge\.js/)
		assert.match(src, /virtual-output\/v4l2-bridge/)
	})

	it('host-live-sources-browser-runtime.js never spawns under NODE_TEST_CONTEXT (mirrors operator-shape-overlay.js\'s test guard)', () => {
		const src = read('src/config/host-live-sources-browser-runtime.js')
		assert.match(src, /NODE_TEST_CONTEXT/)
	})
})

describe('WO-258 T258.4: operator interaction flow — conscious grab-follows-window choice', () => {
	it('API routes registered: update/reload + interact toggle', () => {
		const src = read('src/api/router.js')
		assert.match(src, /routes\.post\('\/api\/host-live\/browser'/)
		assert.match(src, /routes\.post\('\/api\/host-live\/browser\/interact'/)
	})

	it('interact handler moves the window AND restarts the capture bridge at the new region (grab-follows-window, not grab-freezes)', () => {
		const src = read('src/api/host-live-browser.js')
		assert.match(src, /moveBrowserSourceToOperator/)
		assert.match(src, /restartBrowserCaptureBridge/)
		assert.match(src, /returnBrowserSourceToOffscreen/)
		assert.match(src, /grab-follows-window/)
	})

	it('browser-capture-bridge.js exposes a restart (respawn at new region) path for the interact toggle', () => {
		const src = read('src/capture/browser-capture-bridge.js')
		assert.match(src, /function restartBrowserCaptureBridge/)
	})
})

describe('WO-258 T258.2/T258.4: shutdown hygiene', () => {
	it('shutdown.js stops browser capture bridges and firefox sessions', () => {
		const src = read('src/bootstrap/shutdown.js')
		assert.match(src, /stopAllBrowserCaptureBridges/)
		assert.match(src, /stopAllBrowserSources/)
	})
})

'use strict'

/**
 * WO-425 — the monitor audio output is a plain "Audio 2" with the Monitor tickbox (role),
 *          never a special "USB headphones" device, and a factory/fresh system ships NO
 *          audio outputs at all.
 * WO-426 — nothing load-bearing hardcodes 50 fps: mode ids carry the rate ("1080p6000" = 60)
 *          and frames→ms conversions use the project rate. 60-family modes must exist.
 * WO-427 — DeckLink driver install is reachable by a normal user: browser upload endpoint,
 *          local vendor dir scanned everywhere, and the (previously dead) Settings buttons
 *          actually wired.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('WO-425: no "USB headphones" anywhere; monitor entry is Audio 2 + role; factory ships none', () => {
	for (const rel of ['config/audio_outputs.json', 'config/device_graph.json']) {
		assert.ok(!read(rel).includes('USB headphones'), `${rel} carries no special headphone label`)
	}
	/* WO-468 supersedes WO-425 here. WO-425 renamed the label but deliberately kept this box's
	 * `sc60mon` monitor entry in the committed config; it then rode a stick to highascg7579, whose
	 * Caspar threw "Failed to initialize audio device" for an alias that machine does not expose.
	 * The committed slices now ship NO audio outputs — the operator adds "Audio N" and ticks
	 * Monitor. See smoke-config-defaults-no-machine-audio.test.js for the standing gate. */
	const outs = JSON.parse(read('config/audio_outputs.json'))
	assert.equal(outs.length, 0, 'committed config ships no audio outputs (WO-468)')
	for (const o of outs) {
		assert.match(String(o.label), /^Audio \d+$/, 'any shipped audio output keeps a generic Audio N label')
	}

	const defaults = require('../../src/config/defaults')
	const { finalizeScreenDestinationsConfig, normalizeScreenDestinations } = require('../../src/config/screen-destinations')
	const { buildFactoryModularConfig } = require('../../src/config/factory-starter')
	const cfg = buildFactoryModularConfig(defaults, finalizeScreenDestinationsConfig, normalizeScreenDestinations)
	assert.ok(!('audioOutputs' in cfg), 'factory config ships zero audio outputs')
	assert.ok(!JSON.stringify(cfg).includes('USB headphones'), 'factory config never mentions headphones')
})

test('WO-426: rates derive from data — 60-family modes exist and mode ids carry their fps', () => {
	const modes = require('../../src/config/config-modes')
	for (const id of ['1080p5994', '1080p6000', '2160p6000', '720p5994']) {
		assert.ok(modes.STANDARD_VIDEO_MODES[id], `${id} available`)
	}
	assert.equal(modes.getLowestStandardVideoModeIdForFps(60), '720p6000')
	assert.equal(modes.getLowestStandardVideoModeIdForFps(59.94), '720p5994')

	// Client mode parser reads the rate out of the id instead of assuming 50 (ESM → source pin).
	const svc = read('client/lib/mapping-node-service.js')
	assert.match(svc, /\^\(720\|1080\|2160\)\[pi\]\(\\d\{4\}\)\$/, 'mode id rate parser present')
	assert.match(svc, /parseInt\(std\[2\], 10\) \/ 100/, 'fps = rate digits / 100')

	// Mixer settle converts frames→ms at the project rate, not 50.
	const mixer = read('src/api/routes-mixer.js')
	assert.match(mixer, /inferProjectFpsFromConfig\(ctx\?\.config\) \|\| 50/, 'settle timing uses project fps')
	assert.ok(!/const fps = 50\b/.test(mixer), 'no hardcoded fps in routes-mixer')
})

test('WO-427: driver install is user-reachable — upload endpoint, local vendor dir, live buttons', () => {
	const router = read('src/api/router.js')
	assert.match(router, /routes\.post\('\/api\/system\/decklink\/upload'/, 'upload route registered')

	const install = read('src/api/system-hardware-decklink-install.js')
	assert.match(install, /Blackmagic_Desktop_Video_Linux_\[\\w.-\]\+\\.tar\\.gz/, 'filename whitelist')
	assert.match(install, /vendor\/decklink/, 'uploads land in the local vendor dir')

	const LOCAL = 'vendor/decklink'
	assert.ok(read('scripts/lib/decklink-install-lib.sh').includes(`/home/casparcg/highascg/${LOCAL}`), 'bash lib scans the local dir')
	assert.ok(read('src/api/system-hardware-decklink.js').includes(`/home/casparcg/highascg/${LOCAL}`), 'vendorAvailable sees the local dir')

	const tpl = read('client/components/settings-modal-templates.js')
	for (const id of ['decklink-upload-input', 'decklink-upload-btn', 'decklink-install-btn']) {
		assert.ok(tpl.includes(`id="${id}"`), `template has #${id} (the WO-188 install button never existed in the DOM)`)
	}
	const modal = read('client/components/settings-modal.js')
	assert.match(modal, /wireDecklinkInstallListener\(modal\)/, 'install listener actually wired')
	assert.match(modal, /wireDecklinkUploadListener\(modal\)/, 'upload listener wired')

	assert.ok(read('.gitignore').includes('/vendor/'), 'vendor dir never committed')
	assert.ok(read('.stignore').includes('/vendor'), 'vendor dir never synced to peers')
})

'use strict'

/**
 * WO-719 — HIGHASCG_SANDBOX=1 (tools/e2e/sandbox-server.js) runs a throwaway server NEXT TO the live one for the GUI
 * end-to-end scenarios. Every side effect that reaches outside the instance must stay off. The pure gates are run;
 * the rest are pinned by source text ON PURPOSE: executing them with a missing guard would pkill the live barrier
 * daemon, run hostnamectl, or drive xrandr / xdotool on the operator's :0 — on the production box this suite runs on.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

function withEnv(vars, fn) {
	const old = {}
	for (const k of Object.keys(vars)) {
		old[k] = process.env[k]
		if (vars[k] == null) delete process.env[k]
		else process.env[k] = vars[k]
	}
	try {
		return fn()
	} finally {
		for (const k of Object.keys(old)) {
			if (old[k] === undefined) delete process.env[k]
			else process.env[k] = old[k]
		}
	}
}

test('isSandbox reads HIGHASCG_SANDBOX (1 / true / yes)', () => {
	const { isSandbox } = require('../../src/bootstrap/sandbox')
	for (const v of ['1', 'true', 'YES', ' yes ']) withEnv({ HIGHASCG_SANDBOX: v }, () => assert.equal(isSandbox(), true, v))
	for (const v of [null, '', '0', 'false', 'no']) withEnv({ HIGHASCG_SANDBOX: v }, () => assert.equal(isSandbox(), false, String(v)))
})

test('the WO-718 leak path is shut: no exFAT sync on save, no project volume sync', () => {
	const { exfatSyncOnSaveEnabled } = require('../../src/system/exfat-sync-on-save')
	const { volumeSyncAllowed } = require('../../src/engine/projects-root')
	withEnv({ HIGHASCG_SANDBOX: '1', HIGHASCG_EXFAT_SYNC_ON_SAVE: '1' }, () => {
		assert.equal(exfatSyncOnSaveEnabled(), false)
		assert.equal(volumeSyncAllowed(), false)
	})
	assert.match(src('src/engine/projects-root.js'), /if \(require\('\.\.\/bootstrap\/sandbox'\)\.isSandbox\(\)\) return false/)
})

test('every machine-wide side effect checks isSandbox (source pins — see the header for why not executed)', () => {
	const pins = [
		['src/system/pointer-confine.js', /if \(isSandbox\(\)\) return \/\/ WO-719/],
		['src/system/pointer-confine.js', /if \(isSandbox\(\)\) return \{ ok: false, reason: 'sandbox instance \(WO-719\)' \}/],
		['src/system/pointer-confine.js', /if \(isSandbox\(\)\) return \{ ok: true, enabled: false, reason: 'sandbox instance \(WO-719\)' \}/],
		['src/system/hardware-identity.js', /if \(isSandbox\(\)\) return \(_cached = \{ \.\.\.derived, hostname: os\.hostname\(\) \}\)/],
		['src/system/hardware-identity.js', /if \(isSandbox\(\)\) return \{ identity: getHardwareIdentity\(\), hostnameApplied: false \}/],
		['src/system/exfat-sync-on-save.js', /isSandbox\(\)\) return false/],
		['src/utils/os-config-xrandr-apply.js', /isSandbox\(\)\) \{\n\t\tlogger\.info\('\[OS-Config\] applyX11Layout skipped — sandbox instance \(WO-719\)'\)/],
		['src/system/screen-consumer-placement.js', /isSandbox\(\)\) return \{ placed: 0, missing: 0, skipped: 'sandbox' \}/],
		['src/api/settings-post.js', /if \(newPath !== oldPath && require\('\.\.\/bootstrap\/sandbox'\)\.isSandbox\(\)\) \{/],
		['src/config/host-live-sources-browser-runtime.js', /NODE_TEST_CONTEXT \|\| require\('\.\.\/bootstrap\/sandbox'\)\.isSandbox\(\)/],
		['src/media/media-library-registry.js', /isSandbox\(\) \? path\.join\(process\.cwd\(\), 'data', 'media-library'\)/],
		['src/system/video-surfaces.js', /if \(require\('\.\.\/bootstrap\/sandbox'\)\.isSandbox\(\)\) return \{ shm: `\/highascg-\$\{role\}`, path: require\('path'\)\.join\(process\.cwd\(\), 'shm'/],
		['src/system/video-feed.js', /isSandbox\(\) \? path\.join\(process\.cwd\(\), 'shm'\) : '\/dev\/shm'/],
		['src/replication/replication-local-identity.js', /isSandbox\(\) && process\.env\.HIGHASCG_CONFIG_PATH\n\t\? path\.join\(path\.dirname\(path\.resolve\(process\.env\.HIGHASCG_CONFIG_PATH\)\)/],
	]
	for (const [file, re] of pins) assert.match(src(file), re, file)
})

test('the e2e launcher always sets the switch and keeps the instance off the live paths', () => {
	const s = src('tools/e2e/sandbox-server.js')
	for (const needle of [
		"HIGHASCG_SANDBOX: '1'",
		'HIGHASCG_CONFIG_PATH: configFile',
		'HIGHASCG_PROJECTS_DIR: dirs.projects',
		"HIGHASCG_EXFAT_SYNC_ON_SAVE: '0'",
		"XAUTHORITY: '/nonexistent'",
		"DISPLAY: ''",
		'HOME: dirs.home',
		"'--no-caspar'",
		"bindAddress: '127.0.0.1'",
	]) assert.ok(s.includes(needle), needle)
	// the Godot client takes its pictures over the sandbox's feed, never by mapping the live /dev/shm segments
	assert.ok(src('tools/e2e/run-gui-e2e.js').includes("'--video=feed'"), '--video=feed')
})

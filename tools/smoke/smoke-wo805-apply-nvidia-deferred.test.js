'use strict'

/**
 * WO-805 — the Devices "Apply Caspar config (restart)" latency fixes around the display session:
 *   - the NVIDIA policy runs ONCE per Apply, after the Caspar restart, with the display session's env (incl.
 *     HIGHASCG_NVIDIA_SYNC_OUTPUT) — both applyOperatorDisplaySession calls of the Apply skip their blocking run;
 *   - `xdotool mousemove` has no `--sync` (a pointer already at the target waited out the 5 s timeout);
 *   - a sandbox instance stops after the config write (every later step reaches the live box);
 *   - the node relay gives the Caspar applies a long timeout (they answer only when Caspar is back).
 * Nothing here touches X, Caspar or the network: every side-effecting module is replaced.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const ROOT = path.join(__dirname, '..', '..')
const FULL = require.resolve('../../src/utils/full-config-apply')
const RUNTIME = require.resolve('../../src/utils/x-display-session-runtime')
const GUI_WINDOWS = require.resolve('../../src/utils/x-display-session-gui-windows')

/** Swap modules by request suffix while `fn` loads + runs `file` fresh. */
async function withMocks(mocks, files, fn) {
	const origLoad = Module._load
	Module._load = function (request, parent) {
		for (const [suffix, mock] of mocks) {
			if (typeof suffix === 'function' ? suffix(request, parent) : request.endsWith(suffix)) return mock
		}
		return origLoad.apply(this, arguments)
	}
	for (const f of files) delete require.cache[f]
	try {
		return await fn()
	} finally {
		Module._load = origLoad
		for (const f of files) delete require.cache[f]
	}
}

function fullApplyMocks(events, { needsNodm = false } = {}) {
	return [
		[
			'/os-config',
			{
				applyX11Layout(_config, opts = {}) {
					events.push(`xrandr live=${opts.live !== false}`)
					return { applied: opts.live !== false, persisted: opts.persist !== false, xrandrCommand: 'xrandr --mock' }
				},
				restartDisplayManager() {
					events.push('nodm restart')
					return true
				},
			},
		],
		['/display-stable-wait', { waitForDisplayStable: async () => ({ ok: true }) }],
		[
			'/caspar-restart',
			{
				killStuckCasparMainProcess: () => true,
				isAmcpTcpConnected: () => false,
				waitForAmcpDisconnect: async () => true,
				async reloadCasparAfterConfigWrite() {
					events.push('caspar restart')
					return { attempted: true, restartSent: true, reconnected: true }
				},
			},
		],
		[
			'/xrandr-layout-verify',
			{
				needsNodmRestartForLayout: () => ({
					needed: needsNodm,
					plannedCanvas: { width: 3840, height: 1080 },
					currentCanvas: { width: 3840, height: 1080 },
					reason: needsNodm ? 'canvas_expansion' : 'canvas_fits',
				}),
				verifyXrandrMatchesLayout: () => ({ ok: true }),
			},
		],
		[
			'/x-display-session',
			{
				async applyOperatorDisplaySession(_config, opts = {}) {
					events.push(`operator session skipNvidia=${opts.skipNvidia === true}`)
				},
				displaySessionEnv: () => ({ DISPLAY: ':0' }),
				nvidiaPolicyEnv: () => ({ DISPLAY: ':0', HIGHASCG_NVIDIA_SYNC_OUTPUT: 'DP-4' }),
			},
		],
		[
			'/nvidia-display-policy',
			{
				async applyNvidiaDisplayPolicy(env) {
					events.push(`nvidia sync=${env.HIGHASCG_NVIDIA_SYNC_OUTPUT || '-'}`)
					return { ok: true }
				},
			},
		],
		['/caspar-gl-sync-env', { writeCasparGlSyncEnvFile: () => {} }],
	]
}

async function runFullApply(events, opts) {
	return withMocks(fullApplyMocks(events, opts), [FULL], async () => {
		const { applyFullServerConfig } = require(FULL)
		const res = await applyFullServerConfig(
			{ config: { screen_count: 1 }, amcp: {} },
			{
				writeCasparConfig: async () => {
					events.push('write caspar')
					return { ok: true, path: '/tmp/casparcg.config' }
				},
			},
		)
		await new Promise((r) => setImmediate(r)) // the deferred NVIDIA run is fire-and-forget
		return res
	})
}

test('WO-805: Apply runs the NVIDIA policy once, after the Caspar restart, with the sync-output env', async () => {
	const events = []
	const res = await runFullApply(events)
	assert.equal(res.ok, true)
	assert.deepEqual(events, [
		'write caspar',
		'xrandr live=false',
		'xrandr live=true',
		'operator session skipNvidia=true',
		'caspar restart',
		'nvidia sync=DP-4',
	])
	assert.equal(res.nvidiaDisplay.deferred, true)
})

test('WO-805: canvas-expansion Apply (nodm path) also skips the blocking NVIDIA run', async () => {
	const events = []
	await runFullApply(events, { needsNodm: true })
	assert.deepEqual(
		events.filter((e) => e.startsWith('operator') || e.startsWith('nvidia') || e === 'caspar restart'),
		['operator session skipNvidia=true', 'caspar restart', 'nvidia sync=DP-4'],
	)
})

test('WO-805: a sandbox instance stops after the config write (no display, restart or NVIDIA on the live box)', async () => {
	const events = []
	const prev = process.env.HIGHASCG_SANDBOX
	process.env.HIGHASCG_SANDBOX = '1'
	try {
		const res = await runFullApply(events)
		assert.equal(res.step, 'sandbox')
		assert.deepEqual(events, ['write caspar'])
	} finally {
		if (prev === undefined) delete process.env.HIGHASCG_SANDBOX
		else process.env.HIGHASCG_SANDBOX = prev
	}
})

/** The REAL applyOperatorDisplaySession against a recorded execFile + stubbed X helpers. */
async function runDisplaySession(opts) {
	const execs = []
	const nvidia = []
	const fakeChildProcess = {
		execFile(cmd, args, _o, cb) {
			execs.push([cmd, ...args])
			;(typeof _o === 'function' ? _o : cb)(null, '', '')
		},
	}
	const mine = (parent) => parent && (parent.filename === RUNTIME || parent.filename === GUI_WINDOWS)
	const mocks = [
		[(req, parent) => req === 'child_process' && mine(parent), fakeChildProcess],
		[
			'/x-display-session-layout',
			{
				isOperatorPointerConfineDesired: () => true,
				resolveOperatorMonitorRect: () => ({ sysId: 'DP-2', kind: 'gpu', index: 2, x: 1000, y: 0, width: 1920, height: 1080 }),
				nvidiaSyncToDisplayPortIndex: () => 3,
				readCasparSetting: (_c, k) => (k === 'screen_3_system_id' ? 'DP-4' : ''),
				resolveOperatorDisplayRect: () => null,
				resolveHelperWindowRect: () => null,
			},
		],
		[
			'/x-display-session-runtime-env',
			{
				displaySessionEnv: () => ({ DISPLAY: ':0' }),
				lookupCommandPath: () => null,
				commandExists: async () => true,
				resolveConfineCursorScript: () => null,
				resolveConfineBarriersScript: () => null,
				resolveXdotoolBin: () => 'xdotool',
			},
		],
		[
			'/nvidia-display-policy',
			{
				resolveNvidiaXApplyScript: () => null,
				buildNvidiaDisplayPolicyShellLines: () => ['# nvidia'],
				async applyNvidiaDisplayPolicy(env) {
					nvidia.push(env.HIGHASCG_NVIDIA_SYNC_OUTPUT || '-')
					return { ok: true }
				},
			},
		],
		['/system/pointer-confine', { syncOperatorPointerConfine: () => {}, stopPointerConfine: () => {} }],
	]
	return withMocks(mocks, [RUNTIME, GUI_WINDOWS], async () => {
		const rt = require(RUNTIME)
		await rt.applyOperatorDisplaySession({}, { layout: {}, log: () => {}, ...opts })
		return { execs, nvidia, lines: rt.buildOperatorDisplaySessionShellLines({}, {}), envFn: rt.nvidiaPolicyEnv }
	})
}

test('WO-805: skipNvidia leaves the policy out; the pointer warp has no --sync', async () => {
	const { execs, nvidia, lines } = await runDisplaySession({ skipNvidia: true })
	assert.deepEqual(nvidia, [], 'no NVIDIA run in the display session of an Apply')
	const warp = execs.find((e) => e[0] === 'xdotool')
	assert.deepEqual(warp, ['xdotool', 'mousemove', '1960', '540'], 'centre of the operator monitor, no --sync')
	assert.ok(execs.some((e) => e[0] === 'xrandr' && e.includes('--primary')), 'primary still set')
	assert.ok(!lines.some((l) => /mousemove\b.*--sync|--sync\b/.test(l)), 'apply-layout.sh warp has no --sync either')
	assert.ok(lines.some((l) => l.includes('xdotool mousemove 1960 540')))
})

test('WO-805: without skipNvidia the display session still runs the policy with the sync output', async () => {
	const { nvidia, envFn } = await runDisplaySession({})
	assert.deepEqual(nvidia, ['DP-4'])
	assert.deepEqual(envFn({}, { DISPLAY: ':0' }), { DISPLAY: ':0', HIGHASCG_NVIDIA_SYNC_OUTPUT: 'DP-4' })
})

test('WO-805: the GUI-window pointer park has no --sync', () => {
	const src = fs.readFileSync(path.join(ROOT, 'src/utils/x-display-session-gui-windows.js'), 'utf8')
	assert.ok(!/mousemove'[^\]]*'--sync'/.test(src) && !src.includes("'--sync'"), 'no --sync argument left')
})

test('WO-805: the relay gives only the Caspar applies the long timeout', async () => {
	const { createRelay, TIMEOUT_MS, LONG_TIMEOUT_MS } = require('../../src/cluster/cluster-relay')
	assert.ok(LONG_TIMEOUT_MS > 100_000 && LONG_TIMEOUT_MS < 120_000, 'over the server waits, under the client 120 s')
	assert.equal(TIMEOUT_MS, 14000)
	const seen = []
	const relay = createRelay({
		cluster: { saved: () => ({ host: '10.0.0.9', port: 4200, name: 'b' }) },
		request: async (...args) => {
			seen.push(args)
			return { status: 200, contentType: 'application/json', body: Buffer.from('{}') }
		},
	})
	await relay({ method: 'POST', id: 'b', tail: 'api/caspar-config/apply', query: {}, body: '{}' })
	await relay({ method: 'POST', id: 'b', tail: 'api/replication/apply-device-view-caspar', query: {}, body: '{}' })
	await relay({ method: 'POST', id: 'b', tail: 'api/caspar-config/applyx', query: {}, body: '{}' })
	await relay({ method: 'GET', id: 'b', tail: 'api/device-view', query: {} })
	assert.deepEqual(
		seen.map((a) => a[5]),
		[LONG_TIMEOUT_MS, LONG_TIMEOUT_MS, undefined, undefined],
	)
	assert.equal(seen[3].length, 5, 'ordinary requests keep the 5-argument call (default 14 s)')
})

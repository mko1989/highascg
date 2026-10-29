'use strict'

/**
 * WO-805 fix 3 — one system inventory per Apply, one payload build per write.
 *
 * 1. full-config-apply: the persist-only applyX11Layout call passes skipInventory; only the live call (canvas-fits
 *    path and nodm path) writes the inventory.
 * 2. applyX11Layout honours skipInventory (source pin — the function needs a live X server to run).
 * 3. writeSystemInventoryFile probes the hardware ONCE even when the device-graph sync updates the config, and the
 *    file it writes is byte-identical to the pre-WO-805 output (golden below, frozen clock, stubbed probes) —
 *    with or without the device-graph update.
 */

const { describe, it, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('node:module')

const ROOT = path.join(__dirname, '..', '..')

/**
 * Run fn(mod) with `rel` (repo-relative) freshly required while module requests ending in a key of `mocks` are
 * replaced — kept installed for the whole call, so lazy require()s inside the module are mocked too.
 */
async function withMocks(rel, mocks, fn) {
	const abs = require.resolve(path.join(ROOT, rel))
	const orig = Module._load
	Module._load = function (request, parent, isMain) {
		for (const [suffix, value] of Object.entries(mocks)) if (request.endsWith(suffix)) return value
		return orig.apply(this, arguments)
	}
	try {
		delete require.cache[abs]
		return await fn(require(abs))
	} finally {
		Module._load = orig
		delete require.cache[abs]
	}
}

describe('WO-805: inventory written once per Apply', () => {
	async function apply(needsNodm) {
		const calls = []
		const mocks = {
			'/os-config': {
				applyX11Layout: (config, opts = {}) => {
					calls.push({ live: opts.live !== false, inventory: opts.skipInventory !== true })
					return { applied: opts.live !== false, persisted: opts.persist !== false, xrandrCommand: 'xrandr --mock' }
				},
				restartDisplayManager: () => true,
			},
			'/display-stable-wait': { waitForDisplayStable: async () => ({ ok: true }) },
			'/caspar-restart': {
				killStuckCasparMainProcess: async () => true,
				isAmcpTcpConnected: () => false,
				waitForAmcpDisconnect: async () => true,
				reloadCasparAfterConfigWrite: async () => ({ attempted: true, restartSent: true, reconnected: true }),
			},
			'/xrandr-layout-verify': {
				verifyXrandrMatchesLayout: () => ({ ok: true }),
				needsNodmRestartForLayout: () => ({
					needed: needsNodm,
					plannedCanvas: { width: 3840, height: 1080 },
					currentCanvas: { width: 3840, height: 1080 },
					reason: needsNodm ? 'canvas_expansion' : 'canvas_fits',
				}),
			},
			'/x-display-session': { applyOperatorDisplaySession: async () => {}, displaySessionEnv: () => ({}) },
			'/nvidia-display-policy': { applyNvidiaDisplayPolicy: async () => ({ ok: true }) },
			'/caspar-gl-sync-env': { writeCasparGlSyncEnvFile: () => {} },
		}
		const res = await withMocks('src/utils/full-config-apply.js', mocks, ({ applyFullServerConfig }) =>
			applyFullServerConfig(
				{ config: { screen_count: 1 }, amcp: {} },
				{ log: () => {}, force: true, writeCasparConfig: async () => ({ ok: true, changed: true, path: '/tmp/x.config' }) },
			),
		)
		assert.equal(res.ok, true, JSON.stringify(res))
		return calls
	}

	it('canvas fits: persist-only call skips it, the live call writes it', async () => {
		assert.deepEqual(await apply(false), [
			{ live: false, inventory: false },
			{ live: true, inventory: true },
		])
	})

	it('canvas expansion (nodm): same — one write, on the live call', async () => {
		assert.deepEqual(await apply(true), [
			{ live: false, inventory: false },
			{ live: true, inventory: true },
		])
	})

	it('applyX11Layout gates its inventory write on skipInventory', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/utils/os-config-xrandr-apply.js'), 'utf8')
		assert.match(src, /if \(opts\.skipInventory !== true\) \{\n\t\ttry \{\n\t\t\tconst \{ writeSystemInventoryFile \} = require\('\.\.\/bootstrap\/system-inventory-file'\)/)
		assert.equal(src.match(/writeSystemInventoryFile\(/g).length, 1, 'one write site')
	})
})

describe('WO-805: writeSystemInventoryFile builds its payload once, same bytes', () => {
	const NOW = Date.UTC(2026, 9, 29, 10, 14, 7, 123)

	async function run({ dgUpdated }) {
		const counts = { xr: 0, displays: 0, connectors: 0, physMap: 0, alsa: 0, pa: 0, decklink: 0, dg: 0 }
		const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wo805-inv-')), 'inv.json')
		const mocks = {
			'../utils/hardware-info': {
				getDisplaysXrandrDetailed: () => (counts.xr++, { raw: 'Screen 0: current 3840 x 1080\nDP-0 connected primary\n' }),
				getDisplayDetails: () => (counts.displays++, [{ name: 'DP-0', width: 1920, height: 1080, x: 0, y: 0 }]),
				getGpuConnectorInventory: () => (counts.connectors++, [{ name: 'DP-0', connected: true }]),
			},
			'../audio/audio-devices': {
				listAudioDevices: () => (counts.alsa++, { devices: [{ id: 'hw:1,3', name: 'HDMI 0' }] }),
				listPortAudioDevices: () => (counts.pa++, { devices: [{ id: 7, name: 'DM3' }] }),
			},
			'../utils/gpu-physical-map': {
				buildGpuPhysicalMap: () => (counts.physMap++, { ports: [{ physicalPortId: 'gpu_p0', pair: { name: 'DP-0/DP-1' }, runtime: { activePort: 'DP-0', connected: true } }], topologySource: 'drm' }),
			},
			'../utils/gpu-topology-xrandr': { ensureGpuPhysicalTopologyFromXrandr: () => {} },
			'./device-graph-boot-sync': {
				ensureDeviceGraphHardwareSyncFromLive: ({ config }) => {
					counts.dg++
					if (dgUpdated) config.deviceGraph = { connectors: [{ id: 'gpu_out_dp0' }] }
					return { updated: dgUpdated }
				},
			},
			'../system/hardware-identity': { getHardwareIdentity: () => ({ hardwareId: 'hw-805', mac: 'aa:bb:cc:dd:ee:ff' }) },
			'../utils/decklink-enum': { probeDecklinkFromCasparLog: () => (counts.decklink++, { source: 'caspar_log', connectors: [] }) },
		}
		const prev = process.env.HIGHASCG_SYSTEM_INVENTORY_PATH
		process.env.HIGHASCG_SYSTEM_INVENTORY_PATH = out
		mock.timers.enable({ apis: ['Date'], now: NOW })
		try {
			const res = await withMocks('src/bootstrap/system-inventory-file.js', mocks, ({ writeSystemInventoryFile }) =>
				writeSystemInventoryFile(() => {}, { deviceGraph: { connectors: [] } }),
			)
			assert.ok(res, 'wrote')
			return { counts, body: fs.readFileSync(out, 'utf8') }
		} finally {
			mock.timers.reset()
			if (prev === undefined) delete process.env.HIGHASCG_SYSTEM_INVENTORY_PATH
			else process.env.HIGHASCG_SYSTEM_INVENTORY_PATH = prev
			fs.rmSync(path.dirname(out), { recursive: true, force: true })
		}
	}

	/** The pre-WO-805 file for the stubs above (its second build returned the same probes → same bytes). */
	function golden() {
		const ipv4 = []
		for (const [iface, entries] of Object.entries(os.networkInterfaces())) {
			for (const e of entries || []) {
				if (!e || e.family !== 'IPv4' || e.internal) continue
				ipv4.push({ iface, address: e.address, netmask: e.netmask || '', mac: e.mac || '' })
			}
		}
		const physicalMap = { ports: [{ physicalPortId: 'gpu_p0', pair: { name: 'DP-0/DP-1' }, runtime: { activePort: 'DP-0', connected: true } }], topologySource: 'drm' }
		const payload = {
			version: 1,
			collectedAt: new Date(NOW).toISOString(),
			host: { hostname: os.hostname(), hardwareId: 'hw-805', mac: 'aa:bb:cc:dd:ee:ff', platform: process.platform, release: os.release(), arch: process.arch },
			gpu: {
				displays: [{ name: 'DP-0', width: 1920, height: 1080, x: 0, y: 0 }],
				connectors: [{ name: 'DP-0', connected: true }],
				physicalMap,
				xrandrRawQuery: 'Screen 0: current 3840 x 1080\nDP-0 connected primary\n',
				topologySource: 'drm',
			},
			network: { ipv4 },
			decklink: { source: 'caspar_log', connectors: [] },
			audio: { alsa: [{ id: 'hw:1,3', name: 'HDMI 0' }], portaudio: [{ id: 7, name: 'DM3' }] },
		}
		return JSON.stringify(payload, null, 2) + '\n'
	}

	it('device graph updated: every probe runs once (was twice)', async () => {
		const { counts } = await run({ dgUpdated: true })
		assert.deepEqual(counts, { xr: 1, displays: 1, connectors: 1, physMap: 1, alsa: 1, pa: 1, decklink: 1, dg: 1 })
	})

	it('file bytes match the pre-WO-805 output, with and without the device-graph update', async () => {
		const want = golden()
		assert.equal((await run({ dgUpdated: true })).body, want)
		assert.equal((await run({ dgUpdated: false })).body, want)
	})
})

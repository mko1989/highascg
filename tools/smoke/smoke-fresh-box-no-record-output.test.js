'use strict'

/* WO-473. A fresh box and a "New project" must start with ZERO record outputs, the same rule
 * WO-468/470 set for audio outputs. `defaults-core.js` shipped a `rec_1` bound to `program_1`, and
 * four separate `Array.isArray(x) ? x : [rec_1]` fallbacks re-materialised it even when the config
 * said none — including the client's initial settings state, which drew a "Rec1" row before the
 * server had answered.
 *
 * Also pins the leak vector WO-470 left as manual owner action: this box's `audio_outputs.json`
 * (portaudio `hw:0,0` + the `sc60mon` monitor) rode the operator stick and bridge into a fresh
 * install, because the `configs/` sync pairs copied it in both directions. It is machine-local by
 * construction — a named ALSA/PortAudio alias means nothing on another box. */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const CONFIG_DIR = path.join(REPO_ROOT, 'config')

const defaults = require(path.join(REPO_ROOT, 'src/config/defaults'))
const { buildFactoryModularConfig } = require(path.join(REPO_ROOT, 'src/config/factory-starter'))
const {
	finalizeScreenDestinationsConfig,
	normalizeScreenDestinations,
} = require(path.join(REPO_ROOT, 'src/config/screen-destinations'))
const { buildStarterHardwareConfig } = require(path.join(REPO_ROOT, 'src/engine/new-project'))
const { readCommittedConfigSlice } = require('./lib/committed-config-slice')

/* 1. The factory shape — what a produced stick, an ISO install and "New project" all start from. */
const factory = buildFactoryModularConfig(defaults, finalizeScreenDestinationsConfig, normalizeScreenDestinations)
assert.ok(Array.isArray(factory.recordOutputs), 'factory config must define recordOutputs as an array')
assert.strictEqual(factory.recordOutputs.length, 0, 'buildFactoryModularConfig must not emit a record output')

const starter = buildStarterHardwareConfig(require(path.join(REPO_ROOT, 'src/utils/persistence')))
assert.strictEqual(
	(starter.hardwareConfig.recordOutputs || []).length,
	0,
	'a New project must not stamp a record output into its hardwareConfig',
)

/* 2. The COMMITTED slice must match the factory. Judged at HEAD, not in the working tree: this
 * repo is checked out on live boxes whose own record outputs legitimately sit in config/. */
const committed = readCommittedConfigSlice(REPO_ROOT, 'config/record_outputs.json')
if (committed.available) {
	const parsed = JSON.parse(committed.text)
	assert.ok(Array.isArray(parsed), 'config/record_outputs.json must be an array')
	assert.strictEqual(
		parsed.length,
		0,
		`config/record_outputs.json must ship empty — HEAD carries ${parsed.length}: ` +
			`${parsed.map((e) => `${e && e.id}→${e && e.source}`).join(', ')}. ` +
			"A box's own record outputs stay in its working tree; do not commit them.",
	)
}

/* 2b. The committed device graph must carry no connectors. HEAD shipped seven — `rec_1`,
 * `audio_1`, `audio_monitor_usb` (externalRef `sc60mon`) and this box's four GPU ports — so a
 * fresh install opened device view with bands for hardware it does not have. Connectors are
 * suggested from the live box at runtime (device-graph-suggest.js); none belong in the default. */
const committedGraph = readCommittedConfigSlice(REPO_ROOT, 'config/device_graph.json')
if (committedGraph.available) {
	const graph = JSON.parse(committedGraph.text)
	const conns = Array.isArray(graph.connectors) ? graph.connectors : []
	assert.deepStrictEqual(
		conns.map((c) => `${c && c.id}${c && c.externalRef ? `→${c.externalRef}` : ''}`),
		[],
		'config/device_graph.json must ship with no connectors — they describe one box\'s hardware',
	)
	assert.deepStrictEqual(
		(graph.devices || []).map((d) => d && d.id),
		['caspar_host'],
		'config/device_graph.json must ship only the caspar_host device',
	)
}

/* 3. No fallback may resurrect a rec_1 the operator never created. These four sites each did. */
const NO_REC1_FALLBACK = [
	'src/api/settings-get.js',
	'src/config/device-graph-suggest.js',
	'client/lib/settings-state.js',
	'client/components/device-view-bands-render.js',
]
for (const rel of NO_REC1_FALLBACK) {
	const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
	assert.ok(
		!/\[\s*\{\s*(\/\*[^]*?\*\/\s*)?id:\s*'rec_1'/.test(src),
		`${rel} must not default recordOutputs to a literal rec_1 — use [] and let the operator add one`,
	)
}

/* 4. audio_outputs.json must not ride the stick/bridge configs sync in either direction. WO-470
 * blanked the committed default but left the operator's volumes carrying the old entry, so the
 * next fresh install picked it straight back up. */
const syncPath = path.join(CONFIG_DIR, 'exfat-sync.json')
if (fs.existsSync(syncPath)) {
	const map = JSON.parse(fs.readFileSync(syncPath, 'utf8'))
	const modularPairs = (map.pairs || []).filter((p) => /modular-config$/.test(String(p && p.id)))
	assert.ok(modularPairs.length >= 2, 'exfat-sync map must define the bridge and usb modular-config pairs')
	for (const p of modularPairs) {
		assert.ok(
			(p.exclude || []).includes('audio_outputs.json'),
			`exfat-sync pair ${p.id} must exclude audio_outputs.json (machine-local device bindings)`,
		)
	}
}

console.log('smoke-fresh-box-no-record-output: ok')

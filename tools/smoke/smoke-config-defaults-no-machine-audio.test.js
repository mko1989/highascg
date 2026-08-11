'use strict'

/* Regression: config/audio_outputs.json was committed carrying THIS box's USB headset —
 * { id: audio_monitor_usb, type: system-audio, deviceName: 'sc60mon', role: 'monitor' }. It rode
 * along to a fresh install on highascg7579, whose Caspar then threw "Failed to initialize audio
 * device" for a device that machine does not expose under that alias.
 *
 * WO-425 diagnosed exactly this class ("lived only in THIS box's config ... re-committed with the
 * post-produce baseline") but only renamed the label, explicitly leaving the device in place — and
 * nothing gated it. `npm run config:write-defaults` (which sets audioOutputs = []) is a manual
 * script referenced nowhere in CI, so the live box's config kept being committed over the factory
 * default.
 *
 * The factory builder is already correct; this pins the committed slices to match it. */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const { readCommittedConfigSlice } = require('./lib/committed-config-slice')
const CONFIG_DIR = path.join(REPO_ROOT, 'config')

const { buildFactoryModularConfig } = require(path.join(REPO_ROOT, 'src/config/factory-starter'))
const defaults = require(path.join(REPO_ROOT, 'src/config/defaults'))
const {
	finalizeScreenDestinationsConfig,
	normalizeScreenDestinations,
} = require(path.join(REPO_ROOT, 'src/config/screen-destinations'))

/* A fresh box starts with zero audio outputs; the operator adds "Audio N" and ticks Monitor. */
const factory = buildFactoryModularConfig(defaults, finalizeScreenDestinationsConfig, normalizeScreenDestinations)
assert.ok(
	factory.audioOutputs == null || (Array.isArray(factory.audioOutputs) && factory.audioOutputs.length === 0),
	'buildFactoryModularConfig must not emit any audio outputs',
)

/* WO-473: judged AS COMMITTED. config/ is simultaneously the factory default and the live config
 * of the box this repo is checked out on, so reading the working tree failed forever on any box
 * that had added its own outputs — a permanently red gate teaches everyone to ignore it. */
const committedAudio = readCommittedConfigSlice(REPO_ROOT, 'config/audio_outputs.json')
if (committedAudio.available) {
	const parsed = JSON.parse(committedAudio.text)
	assert.ok(Array.isArray(parsed), 'config/audio_outputs.json must be an array')
	assert.strictEqual(
		parsed.length,
		0,
		`config/audio_outputs.json must ship empty — HEAD carries ${parsed.length} entr(y|ies): ` +
			`${parsed.map((e) => `${e && e.id}→${e && e.deviceName}`).join(', ')}. ` +
			'Run `npm run config:write-defaults` before committing, or move the entry to machine-local config.',
	)
}

/* Generic guard: no committed config slice may bind a monitor bus to a specific device. The monitor
 * bus resolves by role at runtime (monitor-bus.js), so a shipped role:'monitor' entry can only be a
 * box's own hardware that leaked into the defaults. */
const offenders = []
for (const ent of fs.readdirSync(CONFIG_DIR)) {
	if (!ent.endsWith('.json')) continue
	/* Committed content again — a box may legitimately bind its own monitor device locally. */
	const slice = readCommittedConfigSlice(REPO_ROOT, `config/${ent}`)
	if (!slice.available) continue
	const raw = slice.text
	if (/"role"\s*:\s*"monitor"/.test(raw)) offenders.push(`${ent} (ships a role:"monitor" audio output)`)
	/* Named ALSA/PortAudio aliases are per-machine by construction. sc60mon is the one that actually
	 * shipped; the check names it so a re-commit fails loudly rather than silently reaching a box. */
	if (/sc60/i.test(raw)) offenders.push(`${ent} (references the sc60 headset alias)`)
}
assert.deepStrictEqual(
	offenders,
	[],
	`machine-specific audio config committed under config/: ${offenders.join('; ')}`,
)

console.log('smoke-config-defaults-no-machine-audio: ok')

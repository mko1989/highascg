'use strict'

/**
 * WO-428 — the Devices tab must reflect DETECTED DeckLink hardware:
 *  - a machine with no card and no driver renders NO phantom card, even when cloned
 *    decklink_* config keys ask for ports (the owner's fresh second machine)
 *  - a machine with detection keeps its ports; a snapshot with no probe data fails OPEN
 *  - the tar.gz installer handles the REAL Blackmagic archive layout (top-level
 *    Blackmagic_Desktop_Video_Linux_<ver>/ folder — the old ^deb/x86_64 anchor matched
 *    nothing, so the whole tar.gz path silently skipped; proven against the real 16.2)
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { suggestConnectorsAndDevicesFromLive } = require('../../src/config/device-graph-suggest')

const CFG_WANTING_DECKLINK = {
	casparServer: {
		decklink_input_count: 4,
		decklink_input_1_device: 1,
		decklink_input_1_direction: 'in',
		decklink_input_2_device: 2,
		decklink_input_2_direction: 'in',
		decklink_input_3_device: 3,
		decklink_input_3_direction: 'in',
		decklink_input_4_device: 4,
		decklink_input_4_direction: 'in',
		screen_count: 1,
	},
}

const deckPorts = (r) => (r.connectors || []).filter((c) => String(c.kind).startsWith('decklink'))

test('WO-428: no detection → no phantom card, even with cloned decklink config', () => {
	const r = suggestConnectorsAndDevicesFromLive({ decklink: { detected: false, inputs: [], screenOutputs: [] } }, CFG_WANTING_DECKLINK)
	assert.equal(deckPorts(r).length, 0, 'driverless/cardless machine renders zero DeckLink ports')
})

test('WO-428: detection keeps ports; missing probe data fails open', () => {
	const detected = suggestConnectorsAndDevicesFromLive(
		{ decklink: { detected: true, inputs: [{ slot: 1, device: 1 }, { slot: 2, device: 2 }], screenOutputs: [] } },
		CFG_WANTING_DECKLINK,
	)
	assert.ok(deckPorts(detected).length >= 2, 'detected hardware keeps its SDI ports')

	const noProbe = suggestConnectorsAndDevicesFromLive({}, CFG_WANTING_DECKLINK)
	assert.ok(deckPorts(noProbe).length > 0, 'snapshot without probe data keeps the config fallback (Caspar-offline case)')
})

test('WO-428: tar.gz installer accepts the real nested Blackmagic archive layout', () => {
	const lib = read('scripts/lib/decklink-install-lib.sh')
	assert.match(lib, /\(\^\|\/\)deb\/x86_64\/\[\^\/\]\+\\.deb\$/, 'deb listing matches nested AND rooted layouts')
	assert.match(lib, /--wildcards '\*deb\/x86_64\/\*\.deb'/, 'extraction is layout-agnostic')
	assert.match(lib, /decklink_extracted_deb_dir/, 'finder locates the deb dir wherever it extracted')
	assert.ok(!lib.includes("grep -q '^deb/x86_64"), 'the root-anchored listing that missed real archives is gone')
	// Verified live 04.08 against the real Blackmagic_Desktop_Video_Linux_16.2.tar.gz:
	// version 16.2a1, main+gui debs found under the top-level folder.
})

test('WO-428 follow-up: Install reports the real reason and only prompts when the gate is on', () => {
	const install = read('src/api/system-hardware-decklink-install.js')
	assert.match(install, /spawnSync\('sudo'/, 'reads both streams (the script logs to STDERR — execFileSync saw nothing → "skipped: unknown")')
	assert.match(install, /\[run\.stdout, run\.stderr\]/, 'stdout+stderr combined')
	assert.ok(!install.includes('lines[lines.length - 2]'), 'no fixed-line-position parsing')
	assert.match(install, /installed system scripts predate it/, 'stale-scripts hint when a package is staged but unseen')

	const panel = read('client/components/settings-modal-mount-hardware.js')
	assert.match(panel, /nuclearRequirePassword === true/, 'password prompt gated on the nuclear setting')
	assert.match(panel, /window\.confirm\('Install\/update the DeckLink driver now\?/, 'gate off → plain confirm instead of a password ask')
})

test('WO-428 pipefail: tar listing must not use grep -q (SIGPIPE kills the match)', () => {
	const lib = read('scripts/lib/decklink-install-lib.sh')
	assert.ok(!/tar -tzf[^\n]*\| *grep -Eq/.test(lib), 'grep -q on the tar pipeline dies on pipefail — capture with || true instead')
	assert.match(lib, /deb_listing="\$\(tar -tzf[^\n]*\|\| true\)"/, 'listing captured pipefail-safe')
	assert.match(lib, /head -1 \|\| true/, 'find|head capture pipefail-safe too')
	assert.match(lib, /GUI upload/, 'skip reason names the upload dir')
})

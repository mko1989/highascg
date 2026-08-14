'use strict'

/**
 * WO-507 — never emit a DeckLink OUTPUT consumer on a device bound as an INPUT.
 * WO-508 — never launch a second casparcg main process.
 *
 * Owner 13.08 (`todos13.08.26`): *"just now wanted to test output of ch1 to two decklinks 1&2,
 * somehow it also tried to open a cosumer on decklink 3 at 2160p50 even though its used as an input
 * in the config. this makes the casparcg go into restart loop. also i want you to double and triple
 * check if there is only one instance of caspar running and there are appropriete safeguards for
 * ensuring only one runs at a time (counting subprocesses of course)."*
 *
 * Both faults end the same way: the server dies during channel construction and systemd restarts it
 * forever, with no picture at all.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const { buildScreenPairChannels } = require('../../src/config/config-generator-consumer-attach-screen.js')

const ROUTE_MAP = { programCh: () => 1, previewCh: () => 2, programChannels: [1], previewChannels: [2] }
const CTX = { n: 1, dims: { width: 1920, height: 1080 }, cumulativeX: 0, nextDevice: 1 }

/** DeckLink 3 and 4 declared as inputs in the device graph (the SSOT path). */
function cfgWithInputs(extra) {
	return {
		caspar_build_profile: 'custom_live',
		deviceGraph: {
			connectors: [
				{ id: 'dlsdi_1', kind: 'decklink_io', caspar: { ioDirection: 'out' } },
				{ id: 'dlsdi_2', kind: 'decklink_io', caspar: { ioDirection: 'out' } },
				{ id: 'dlsdi_3', kind: 'decklink_io', caspar: { ioDirection: 'in' } },
				{ id: 'dlsdi_4', kind: 'decklink_io', caspar: { ioDirection: 'in' } },
			],
		},
		...extra,
	}
}

test('WO-507: the fixture really does declare 3 and 4 as inputs', () => {
	const { resolveDecklinkInputSlots } = require('../../src/config/decklink-input-slots.js')
	assert.deepEqual(resolveDecklinkInputSlots(cfgWithInputs({})), [3, 4])
})

test('WO-507: a tile on an input-reserved device is dropped, output tiles survive', () => {
	const cfg = cfgWithInputs({
		screen_1_decklink_tiles: [
			{ device: 1, srcX: 0, srcY: 0, destX: 0, destY: 0, width: 1920, height: 1080, videoMode: '1080p5000' },
			{ device: 2, srcX: 1920, srcY: 0, destX: 0, destY: 0, width: 1920, height: 1080, videoMode: '1080p5000' },
			{ device: 3, srcX: 0, srcY: 0, destX: 0, destY: 0, width: 3840, height: 2160, videoMode: '2160p5000' },
		],
	})
	const xml = JSON.stringify(buildScreenPairChannels(cfg, ROUTE_MAP, { ...CTX }))
	assert.doesNotMatch(xml, /2160p5000/, 'THE BUG: a 2160p50 consumer on the input card would restart-loop Caspar')
	assert.match(xml, /<decklink>/, 'the legitimate outputs must still be emitted')
})

test('WO-507: a single decklink_device pointing at an input emits no consumer', () => {
	const cfg = cfgWithInputs({ screen_1_decklink_device: 3 })
	const xml = JSON.stringify(buildScreenPairChannels(cfg, ROUTE_MAP, { ...CTX }))
	assert.doesNotMatch(xml, /<decklink>/, 'DeckLink 3 is an input — no output consumer may be emitted')
})

test('WO-507: an output device that is NOT an input is untouched', () => {
	const cfg = cfgWithInputs({ screen_1_decklink_device: 1 })
	const xml = JSON.stringify(buildScreenPairChannels(cfg, ROUTE_MAP, { ...CTX }))
	assert.match(xml, /<decklink>/, 'DeckLink 1 is an output and must still be emitted')
})

test('WO-507: with no input declarations nothing is dropped', () => {
	const cfg = { caspar_build_profile: 'custom_live', screen_1_decklink_device: 3 }
	const xml = JSON.stringify(buildScreenPairChannels(cfg, ROUTE_MAP, { ...CTX }))
	assert.match(xml, /<decklink>/, 'absent input config must not silently disable outputs')
})

test('WO-508: run_caspar refuses to start a second main process', () => {
	const src = code(read('run.sh'))
	const body = /run_caspar\(\) \{([\s\S]*?)\n\t"\$CASPAR_BIN"/.exec(src)
	assert.ok(body, 'run_caspar must still launch the binary')
	assert.match(body[1], /caspar_list_main_pids/, 'it must check for an existing MAIN before launching')
	assert.match(body[1], /exit 3/, 'and refuse, so systemd backs off instead of stacking instances')
})

test('WO-508: the guard waits before refusing, so normal relaunches still work', () => {
	const body = /run_caspar\(\) \{([\s\S]*?)\n\t"\$CASPAR_BIN"/.exec(code(read('run.sh')))[1]
	assert.match(body, /while \[ "\$_wait" -lt \d+ \]/, 'must wait for our own just-exited child to be reaped')
	assert.match(body, /sleep 0\.1/, 'short poll, not a fixed long sleep on every restart')
})

test('WO-508: the guard confirms by /proc/exe, not by command-line matching', () => {
	// Measured on the box: a shell whose argv merely contains both CASPAR_BIN and CONFIG_PATH is
	// reported by caspar_list_main_pids (the WO-407 self-match). Refusing to launch on that would
	// leave the box dark, so the guard must verify the actual executable.
	const body = /run_caspar\(\) \{([\s\S]*?)\n\t"\$CASPAR_BIN"/.exec(code(read('run.sh')))[1]
	assert.match(body, /\/proc\/\$_p\/exe/, 'each candidate must be confirmed by its real executable')
	assert.match(body, /\[ "\$_p" = "\$\$" \] && continue/, 'and the guard must never match itself')
})

test('WO-508: the guard counts MAINS only — CEF children must not trip it', () => {
	const lib = code(read('tools/runtime/casparcg-supervisor-lib.sh'))
	assert.match(lib, /caspar_is_cef_child/, 'the helper distinguishing CEF children must still exist')
	const listMain = /caspar_list_main_pids\(\) \{([\s\S]*?)\n\}/.exec(lib)
	assert.ok(listMain, 'caspar_list_main_pids must exist')
	assert.match(listMain[1], /caspar_is_main_process/, 'and filter through the main-process predicate')
})

/**
 * WO-513 — "SDI (MVR)" is a synthesized port, and slot 99 is a sentinel.
 *
 * Owner 13.08: *"there is an additional sdi port on the decklink called sdi (mvr) wtf is it doing
 * there??"* `device-graph-suggest.js:156,177` invents it to represent "the multiview bus goes out on
 * DeckLink device N". 99 is a made-up index chosen to clear real ports 1..8; the real card is in
 * `externalRef`. Anything reading the slot out of the id therefore reasoned about a port that does
 * not exist — including WO-507's guard, which compares output devices against input slots.
 */

const { decklinkSlotFromConnector, DECKLINK_MVR_SENTINEL_SLOT } = require('../../src/config/decklink-input-slots.js')

test('WO-513: the MVR sentinel resolves to the device it actually drives', () => {
	assert.equal(DECKLINK_MVR_SENTINEL_SLOT, 99)
	assert.equal(
		decklinkSlotFromConnector({ id: 'dlsdi_99', externalRef: '2' }),
		2,
		'THE BUG: slot 99 is not a port — the real card is in externalRef',
	)
})

test('WO-513: real ports are unaffected', () => {
	assert.equal(decklinkSlotFromConnector({ id: 'dlsdi_3', externalRef: '3' }), 3)
	assert.equal(decklinkSlotFromConnector({ id: 'dlsdi_1', externalRef: '7' }), 1, 'a real id still wins over externalRef')
})

test('WO-513: a sentinel with no device never reports 99', () => {
	// Better to report "unknown" than a port number that cannot exist.
	assert.notEqual(decklinkSlotFromConnector({ id: 'dlsdi_99' }), 99)
})

test('WO-513/527: the MVR pseudo-port is gone entirely — superseded by the owner', () => {
	// WO-513 kept the synthesized port and merely stopped slot 99 poisoning slot-based rules. The
	// owner then ruled it out completely: "the mvr sdi should not ever appear. user can send mvr
	// channel to sdi port but it still stays an sdi port # not mvr sdi." See WO-527.
	const src = code(read('src/config/device-graph-suggest.js'))
	assert.doesNotMatch(src, /addDecklinkPort\(99,/, 'no pseudo-slot may be synthesized')
	assert.doesNotMatch(src, /SDI \(MVR\)/, 'and no MVR label')
})

test('WO-513: the sentinel resolver stays as a safety net for un-normalized graphs', () => {
	// normalizeDeviceGraph strips dlsdi_99 on load, but a caller holding a raw graph must still not
	// be told that slot 99 exists.
	assert.equal(decklinkSlotFromConnector({ id: 'dlsdi_99', externalRef: '2' }), 2)
})

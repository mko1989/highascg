'use strict'

/**
 * WO-506 — operator-editable labels for non-screen live sources, and the top-bar pill shorthand.
 *
 * Owner 13.08: *"labels for any live source (pgm, prv, decklink, ndi etc) … operators will want to
 * work mostly on their custom labels and not generic screen 1 etc."* and, on the decision that
 * unblocked it: *"the screen labels need to be over anything"* + *"for the small pils in the top bar
 * right side … a 3 later shorthand of the label, just first 3 letters, nothing else."*
 *
 * Screens are deliberately NOT handled here — a screen's name is its owning destination's name
 * (WO-385) and already outranks everything.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const {
	sourceLabelKey,
	sourceLabelsFromConfig,
	applySourceLabels,
	setSourceLabelInConfig,
	shortSourcePill,
	MAX_SOURCE_LABEL,
} = require('../../src/config/source-labels.js')

test('WO-506: the key prefers connectorId, which survives re-cabling', () => {
	assert.equal(sourceLabelKey({ connectorId: 'dlsdi_3', value: 'route://6-3' }), 'dlsdi_3')
	assert.equal(sourceLabelKey({ value: 'route://6-3' }), 'route://6-3', 'value is the fallback')
	assert.equal(sourceLabelKey({}), '', 'nothing stable → no key, so nothing can be mislabelled')
	assert.equal(sourceLabelKey(null), '')
})

test('WO-506: a custom label replaces the generated one and keeps it for revert', () => {
	const list = [
		{ connectorId: 'dlsdi_3', label: 'DeckLink 3' },
		{ connectorId: 'dlsdi_4', label: 'DeckLink 4' },
	]
	const out = applySourceLabels(list, { sourceLabels: { dlsdi_3: 'Camera 2 — Wide' } })
	assert.equal(out[0].label, 'Camera 2 — Wide')
	assert.equal(out[0].generatedLabel, 'DeckLink 3', 'the inspector must be able to show the revert target')
	assert.equal(out[0].labelIsCustom, true)
	assert.equal(out[1].label, 'DeckLink 4', 'an unnamed source is untouched')
	assert.equal(out[1].labelIsCustom, false)
})

test('WO-506: empty means ABSENCE, never a blank name', () => {
	const out = applySourceLabels([{ connectorId: 'dlsdi_3', label: 'DeckLink 3' }], {
		sourceLabels: { dlsdi_3: '   ' },
	})
	assert.equal(out[0].label, 'DeckLink 3', 'whitespace must not blank the tile')
	assert.equal(out[0].labelIsCustom, false)
	assert.deepEqual(sourceLabelsFromConfig({ sourceLabels: { a: '', b: '  ', c: 'Keep' } }), { c: 'Keep' })
})

test('WO-506: writing an empty label removes the override', () => {
	const cfg = { sourceLabels: { dlsdi_3: 'Camera 2' } }
	assert.deepEqual(setSourceLabelInConfig(cfg, 'dlsdi_3', '').sourceLabels, {})
	assert.deepEqual(setSourceLabelInConfig(cfg, 'dlsdi_4', 'Camera 3').sourceLabels, {
		dlsdi_3: 'Camera 2',
		dlsdi_4: 'Camera 3',
	})
	assert.equal(setSourceLabelInConfig(cfg, '   ', 'x').ok, false, 'a blank id must be rejected')
})

test('WO-506: labels are length-capped (operator free text reaches HTML/SVG payloads)', () => {
	const long = 'x'.repeat(MAX_SOURCE_LABEL + 50)
	assert.equal(setSourceLabelInConfig({}, 'k', long).sourceLabels.k.length, MAX_SOURCE_LABEL)
})

test('WO-506: the pill is the first three characters, nothing else', () => {
	assert.equal(shortSourcePill('Main'), 'Mai')
	assert.equal(shortSourcePill('Stage Left'), 'Sta')
	assert.equal(shortSourcePill('S1'), 'S1', 'shorter labels render whole')
	assert.equal(shortSourcePill('  Padded'), 'Pad', 'trimmed before slicing')
	assert.equal(shortSourcePill(''), '')
	assert.equal(shortSourcePill(null), '')
	// Explicitly NOT initials / uppercase — the owner asked for first three letters, nothing else.
	assert.notEqual(shortSourcePill('Stage Left'), 'SL')
	assert.notEqual(shortSourcePill('main'), 'MAI')
})

test('WO-506: the client pill helper agrees with the server one', () => {
	const src = read('client/lib/source-label.js')
	const body = /export function shortLabelPill\(label\) \{([\s\S]*?)\n\}/.exec(src)
	assert.ok(body, 'client helper must exist')
	assert.match(body[1], /\.slice\(0, 3\)/, 'same transform as shortSourcePill, or the two drift')
	assert.match(body[1], /\.trim\(\)/)
})

test('WO-506: the label is applied at the single enrich choke point', () => {
	const src = read('src/config/extra-live-source-enrich.js')
	assert.match(
		src,
		/applySourceLabels\(/,
		'applying it in enrichExtraLiveSources is what gives every existing .label render site the override for free',
	)
})

test('WO-506: the write route is REGISTERED — WO-222 called this the recurring failure', () => {
	const router = read('src/api/router.js')
	assert.match(router, /routes\.post\('\/api\/sources\/label'/, 'an unregistered handler is dead code')
	assert.match(router, /require\('\.\/routes-sources'\)/)
})

test('WO-506: the route parses a RAW STRING body and returns the {status,headers,body} shape', () => {
	const { handleSourceLabel } = require('../../src/api/routes-sources.js')
	const saved = []
	const ctx = {
		config: { sourceLabels: {} },
		configManager: { get: () => ({}), save: (c) => saved.push(c) },
	}
	// routes-screens.js shipped broken twice by property-accessing the raw string and by returning
	// a bare {ok} — both are pinned here by passing a real string.
	const res = handleSourceLabel(JSON.stringify({ sourceId: 'dlsdi_3', label: 'Camera 2' }), ctx)
	assert.equal(res.status, 200, `expected 200, got ${JSON.stringify(res)}`)
	assert.ok(res.headers && typeof res.body === 'string', 'must return the HTTP-layer shape')
	assert.deepEqual(JSON.parse(res.body).sourceLabels, { dlsdi_3: 'Camera 2' })
	assert.equal(saved.length, 1, 'and persist')
	assert.deepEqual(saved[0].sourceLabels, { dlsdi_3: 'Camera 2' })
})

test('WO-506: a bad body is rejected, not silently accepted', () => {
	const { handleSourceLabel } = require('../../src/api/routes-sources.js')
	const ctx = { config: {}, configManager: { get: () => ({}), save: () => {} } }
	assert.equal(handleSourceLabel('not json', ctx).status, 400)
	assert.equal(handleSourceLabel(JSON.stringify({ label: 'x' }), ctx).status, 400, 'sourceId is required')
})

test('WO-510: the streaming-bus DeckLink now gets consumer settings too', () => {
	const src = read('src/config/config-generator-consumer-attach.js')
	const block = /if \(deckN > 0 && mvStd\) \{([\s\S]*?)\n\t\}/.exec(src)
	assert.ok(block, 'the streaming-bus decklink branch must still exist')
	assert.match(block[1], /consumerSettings/, 'WO-509 §5: it passed none, so pixel-format et al were dropped')
	assert.match(block[1], /videoMode: modeId/, 'and no video mode either')
})

/**
 * WO-517 — the edit control the owner said was missing, now the SHARED one (WO-525).
 *
 * WO-517 first added a control local to this inspector. WO-525 replaced it with
 * `inspector-source-label.js`, mounted identically here and in the host-channel inspector, after the
 * owner reported the label "does not apply" and asked for one shared field. The behavioural
 * assertions (keying, placeholder, no restart-dirty) moved with it to
 * `smoke-wo525-shared-source-label.test.js`; what belongs here is that this inspector still offers
 * the control at all.
 */

test('WO-517: the DeckLink input inspector offers a label control', () => {
	const src = read('client/components/device-view-inspector-decklink-input.js')
	assert.match(src, /import \{ mountSourceLabelControl \}/, 'must use the shared control')
	assert.match(src, /mountSourceLabelControl\(inputSection, \{/, 'and mount it in the input section')
})

test('WO-517: it keys on the connector id, which survives re-cabling', () => {
	const src = read('client/components/device-view-inspector-decklink-input.js')
	assert.match(src, /connectorId: conn\.id/, 'connectorId is the stable key (WO-506)')
})

test('WO-517: the control is fed the payload this inspector actually holds', () => {
	// The original bug: it read a key that only exists in /api/state, off the device-view snapshot.
	const src = read('client/components/device-view-inspector-decklink-input.js')
	assert.match(src, /sources: lastPayload\?\.extraLiveSources/)
})

/**
 * WO-524 — the top-bar playback-timer chips show the operator's screen name.
 *
 * Owner pointed at the component (`button class header pgm timer chip`) after I failed to find it:
 * `client/lib/app-pgm-header-timer.js`, which hardcoded `P1`/`P2`. Owner's rule for these:
 * *"a 3 later shorthand of the label, just first 3 letters, nothing else."*
 */

test('WO-524: the chip renders the screen label shorthand, not a hardcoded P<n>', () => {
	const src = read('client/lib/app-pgm-header-timer.js')
	assert.match(src, /shortLabelPill\(full\)/, 'must use the shared 3-letter transform')
	assert.match(src, /screenLabel\(cm, idx\)/, 'resolved from the screen label, per WO-222/WO-385')
	assert.doesNotMatch(src, /b\.textContent = `P\$\{idx \+ 1\}`/, 'the hardcoded label must be gone')
})

test('WO-524: the full name stays reachable in the tooltip', () => {
	// The chip is three characters wide; the operator still needs to know which screen it is.
	const src = read('client/lib/app-pgm-header-timer.js')
	assert.match(src, /b\.title = `Show playback timer for \$\{full\} \(channel \$\{ch\}\)`/)
})

test('WO-524: a chip is never blank', () => {
	// screenLabel falls back to S<n>, and there is a P<n> backstop after that.
	const src = read('client/lib/app-pgm-header-timer.js')
	assert.match(src, /shortLabelPill\(full\) \|\| `P\$\{idx \+ 1\}`/)
})

test('WO-524: renaming a screen BROADCASTS, or no surface would update', () => {
	const src = read('src/api/routes-screens.js')
	assert.match(src, /_wsBroadcast\('change', \{ path: 'channelMap'/, 'the rename must announce itself')
	// The chips re-render on exactly this path.
	const chips = read('client/lib/app-pgm-header-timer.js')
	assert.match(chips, /if \(path === 'channelMap'\) renderPlaybackChannelChips\(\)/)
})

test('WO-524: a failed broadcast must not fail the rename', () => {
	const body = /if \(typeof ctx\._wsBroadcast === 'function'\) \{[\s\S]*?\n\t\t\}/.exec(read('src/api/routes-screens.js'))
	assert.ok(body, 'the broadcast must be guarded')
	assert.match(body[0], /catch/, 'the save already succeeded')
})

/**
 * WO-526 — the test card shows the operator's screen name.
 *
 * Owner named "test card (settings and display)" as one of the label-bar surfaces, and
 * `routes-led-test-card.js` hardcoded `Screen ${mainIdx + 1}`.
 */

test('WO-526: the test card resolves the screen name from channelMap.screenLabels', () => {
	const src = read('src/api/routes-led-test-card.js')
	assert.match(src, /getChannelMap\(ctx\?\.config \|\| \{\}\)\?\.screenLabels/, 'same authority as every other surface')
	assert.match(src, /\$\{screenName\} \(PGM ch \$\{channel\}\)/, 'the name must reach the payload')
})

test('WO-526: it still falls back to Screen <n>, and a lookup failure cannot block a test card', () => {
	const src = read('src/api/routes-led-test-card.js')
	assert.match(src, /if \(!screenName && mainIdx >= 0\) screenName = `Screen \$\{mainIdx \+ 1\}`/, 'never blank')
	const block = /let screenName = ''[\s\S]*?\n\t\t\}/.exec(src)
	assert.ok(block, 'the lookup must be parseable')
	assert.match(block[0], /catch \(_\) \{/, 'a label lookup must never stop a test card going up')
})

test('WO-526: the surfaces the owner named all resolve from the screen label', () => {
	// compose prv / looks / timelines / multiview all go through screenLabel or the enriched
	// extraLiveSources[].label; this pins the two client ones that resolve it directly.
	assert.match(read('client/components/scene-list.js'), /screenLabel\(cm, i\)/, 'looks selector')
	assert.match(read('client/lib/multiview-state-layout.js'), /screenLabel\(channelMap, s\)/, 'multiview cells')
	assert.match(read('client/components/timeline-editor.js'), /screenLabel\(cm, s\)/, 'timeline pgm/prv')
})

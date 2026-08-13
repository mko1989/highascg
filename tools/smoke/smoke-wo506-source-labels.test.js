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
 * WO-517 — the edit control the owner said was missing.
 *
 * Owner 13.08: *"the labels of screens is not finished. cant add labels to decklink inputs."*
 * WO-506 shipped the store, resolver, route and helpers, but nothing in the UI could SET a label.
 */

test('WO-517: the DeckLink input inspector mounts a label control', () => {
	const src = read('client/components/device-view-inspector-decklink-input.js')
	assert.match(src, /function mountSourceLabelControl\(/, 'the control must exist')
	assert.match(src, /mountSourceLabelControl\(inputSection, conn, ctx\)/, 'and actually be mounted')
})

test('WO-517: it keys on the connector id, which survives re-cabling', () => {
	const body = /function mountSourceLabelControl\([\s\S]*?\n\}/.exec(
		read('client/components/device-view-inspector-decklink-input.js'),
	)[0]
	assert.match(body, /String\(conn\?\.id \|\| ''\)/, 'connectorId is the stable key (WO-506)')
	assert.match(body, /sourceId: key/, 'and it is what the API is given')
	assert.match(body, /'\/api\/sources\/label'/, 'posting to the registered route')
})

test('WO-517: the placeholder shows the generated fallback, so empty reads as "revert"', () => {
	const body = /function mountSourceLabelControl\([\s\S]*?\n\}/.exec(
		read('client/components/device-view-inspector-decklink-input.js'),
	)[0]
	assert.match(body, /placeholder: generated/, 'the operator must see what clearing falls back to')
	assert.match(body, /generatedLabel/, 'which the server preserves on each source')
})

test('WO-517: renaming must NOT mark Caspar restart-dirty', () => {
	const body = /function mountSourceLabelControl\([\s\S]*?\n\}/.exec(
		read('client/components/device-view-inspector-decklink-input.js'),
	)[0]
	// A label changes no Caspar config; demanding a playout restart to rename a camera is absurd.
	assert.doesNotMatch(body, /setCasparRestartDirty|markCasparRestartDirty/)
})

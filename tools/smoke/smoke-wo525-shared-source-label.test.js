'use strict'

/**
 * WO-525 — the DeckLink input label must actually show, and be the SAME field in both inspectors.
 *
 * Owner 14.08: *"label for a decklink input does not apply. it should be shared label in host
 * channel and in decklink ports inspector."*
 *
 * Verified on the box first: the store, the route and the enrichment all worked — `/api/state`
 * showed `sourceLabels: {dlsdi_4: 'Cam2'}` and `extraLiveSources` carried the applied label. The
 * failure was purely on the way back into the UI: the control read `sourceLabels` off
 * `ctx.lastPayload`, which is the DEVICE-VIEW snapshot and does not carry that key (only
 * `/api/state` does), so the field opened blank and a saved name looked lost.
 *
 * It now reads `extraLiveSources`, which BOTH payloads carry, already enriched with `label`,
 * `generatedLabel` and `labelIsCustom`.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** Load the pure resolver out of the ESM component. */
const readSourceLabelState = new Function(
	read('client/components/inspector-source-label.js')
		.replace(/^import[^\n]*\n/gm, '')
		.replace(/export function/g, 'function') + '; return readSourceLabelState',
)()

test('WO-525: a custom label is read back from extraLiveSources', () => {
	const sources = [{ connectorId: 'dlsdi_4', label: 'Cam2', generatedLabel: 'DeckLink 4', labelIsCustom: true }]
	const { custom, generated } = readSourceLabelState(sources, 'dlsdi_4')
	assert.equal(custom, 'Cam2', 'THE BUG: this came back empty, so the saved name looked lost')
	assert.equal(generated, 'DeckLink 4', 'and the placeholder shows what clearing falls back to')
})

test('WO-525: an unnamed source reports no custom value but keeps its generated one', () => {
	const sources = [{ connectorId: 'dlsdi_3', label: 'DeckLink 3', labelIsCustom: false }]
	const { custom, generated } = readSourceLabelState(sources, 'dlsdi_3')
	assert.equal(custom, '', 'nothing was named, so the field must be empty')
	assert.equal(generated, 'DeckLink 3')
})

test('WO-525: a source missing from the payload falls back rather than blanking', () => {
	const { custom, generated } = readSourceLabelState([], 'dlsdi_9', 'DeckLink 9')
	assert.equal(custom, '')
	assert.equal(generated, 'DeckLink 9', 'the placeholder must never be empty when a fallback exists')
})

test('WO-525: it tolerates a missing/!array sources list', () => {
	assert.deepEqual(readSourceLabelState(undefined, 'dlsdi_1', 'X'), { custom: '', generated: 'X' })
	assert.deepEqual(readSourceLabelState(null, 'dlsdi_1', 'X'), { custom: '', generated: 'X' })
})

test('WO-525: the control does NOT read the key that only exists in /api/state', () => {
	// Comment-stripped: the file's own header explains the bug and names the key, which a naive
	// doesNotMatch over the whole source would trip on (same trap as WO-512's doc assertion).
	const src = read('client/components/inspector-source-label.js')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1')
	assert.doesNotMatch(src, /sourceLabels/, 'reading it off the device-view payload is what broke this')
	// The component is payload-agnostic on purpose: it takes a `sources` list, so it works with the
	// device-view snapshot AND /api/state. Which list the callers pass is asserted separately.
	assert.match(src, /function readSourceLabelState\(sources, connectorId/, 'resolves from a passed list')
})

test('WO-525: BOTH inspectors mount the same control on the same key', () => {
	const ports = read('client/components/device-view-inspector-decklink-input.js')
	const host = read('client/components/inspector-decklink-host.js')
	for (const [name, src] of [['ports inspector', ports], ['host channel', host]]) {
		assert.match(src, /import \{ mountSourceLabelControl \}/, `${name} must import the shared control`)
		assert.match(src, /mountSourceLabelControl\(/, `${name} must mount it`)
		assert.match(src, /connectorId: (conn\.id|source\?\.connectorId)/, `${name} must key on the connector`)
		assert.match(src, /sources: lastPayload\?\.extraLiveSources/, `${name} must feed it the payload it holds`)
	}
})

test('WO-525: there is only ONE implementation, not a copy per inspector', () => {
	const ports = read('client/components/device-view-inspector-decklink-input.js')
	assert.doesNotMatch(ports, /function mountSourceLabelControl\(/, 'the local copy must be gone')
})

test('WO-525: renaming never marks Caspar restart-dirty', () => {
	// A label changes no Caspar config; demanding a playout restart to rename a camera is absurd.
	const src = read('client/components/inspector-source-label.js')
	assert.doesNotMatch(src, /setCasparRestartDirty|markCasparRestartDirty/)
})

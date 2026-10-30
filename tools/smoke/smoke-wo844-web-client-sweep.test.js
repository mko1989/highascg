'use strict'

/**
 * WO-844: web client sweep fixes — video-mode matching, shortcut focus guard, numbered ids, cached-GET RMW,
 * MIX + MERGE migration, device-graph-suggest DeckLink ids, electron launcher markup.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const esm = (rel) => import(pathToFileURL(path.join(ROOT, rel)))

test('4p: progressive wins an interlaced tie; interlaced only when asked for', () => {
	const m = require('../../client/components/device-view-destinations-inspector-modes.js')
	assert.equal(m.matchCasparVideoModeFromDimensions(1920, 1080, 50), '1080p5000')
	assert.equal(m.matchCasparVideoModeFromDimensions(1920, 1080, 59.94), '1080p5994')
	assert.equal(m.matchCasparVideoModeFromDimensions(1920, 1080, 60), '1080p6000')
	assert.equal(m.matchCasparVideoModeFromDimensions(1920, 1080, 50, true), '1080i5000')
	assert.equal(m.matchCasparVideoModeFromDimensions(1920, 1080, 50, false), '1080p5000')
	assert.equal(m.matchCasparVideoModeFromDimensions(720, 576, 25), '576p2500')
	assert.equal(m.matchCasparVideoModeFromDimensions(720, 576, 25, true), 'PAL')
	assert.equal(m.matchCasparVideoModeFromDimensions(720, 486, 29.97), 'NTSC', 'no progressive twin: interlaced is the fallback')
	assert.equal(m.normalizeCasparVideoModeId('1920x1080p50'), '1080p5000')
	assert.equal(m.normalizeCasparVideoModeId('1920x1080@50'), '1080p5000')
	assert.equal(m.normalizeCasparVideoModeId('1920x1080i50'), '1080i5000')
	assert.equal(m.casparVideoModeFromDetectedDisplay({ resolution: '1920x1080', refreshHz: 50 }, []).modeId, '1080p5000')
	assert.equal(m.casparVideoModeFromDetectedDisplay(null, [{ mode: '1920x1080i', rate: '50' }]).modeId, '1080i5000')
	// every id in the table round-trips through its own spec (exact progressive/interlaced match)
	for (const id of m.STANDARD_VIDEO_MODES) {
		const spec = m.CASPAR_VIDEO_MODE_SPECS[id]
		const got = m.matchCasparVideoModeFromDimensions(spec.width, spec.height, spec.fps, m.isInterlacedCasparMode(id))
		assert.equal(got, id, `${id} resolves to itself`)
	}
	const saved = m.resolveGpuInspectorVideoMode({
		cs: { screen_1_mode: '1080p5000' },
		detectedDisplay: { resolution: '1920x1080', refreshHz: 50 },
		uniqueDetectedModes: [{ mode: '1920x1080', rate: '50', current: true }],
		defaultModeIdx: 0,
	})
	assert.equal(saved.modeId, '1080p5000')
})

test('4q: keyboard guard ignores text fields, hidden panels and other tabs', async () => {
	const { isTextEntryTarget, shouldIgnoreShortcut, isPanelActive } = await esm('client/lib/keyboard-guard.js')
	const el = (sel, extra = {}) => ({
		closest(s) { return s.split(',').map((x) => x.trim()).some((x) => x === sel || x.startsWith(sel)) ? this : null },
		...extra,
	})
	for (const tag of ['input', 'textarea', 'select']) assert.equal(isTextEntryTarget(el(tag)), true, tag)
	assert.equal(isTextEntryTarget({ closest: () => null, isContentEditable: true }), true)
	assert.equal(isTextEntryTarget({ closest: () => null }), false)

	const pane = (active) => ({ classList: { contains: (c) => c === 'active' && active } })
	const panel = (visible, active = true) => ({ isConnected: true, offsetParent: visible ? {} : null, closest: () => pane(active) })
	assert.equal(isPanelActive(panel(true)), true)
	assert.equal(isPanelActive(panel(false)), false)
	assert.equal(isPanelActive(panel(true, false)), false)
	assert.equal(shouldIgnoreShortcut({ target: { closest: () => null } }, panel(true)), false)
	assert.equal(shouldIgnoreShortcut({ target: { closest: () => null } }, panel(false)), true, 'panel hidden')
	assert.equal(shouldIgnoreShortcut({ target: { closest: (s) => (/input/.test(s) ? {} : null) } }, panel(true)), true, 'typing')
	const mine = { contains: () => false }
	const other = { contains: () => false }
	assert.equal(
		shouldIgnoreShortcut({ target: { closest: (s) => (s === '.tab-pane' ? other : null) } }, { ...panel(true), contains: () => false }),
		true,
		'event from a different tab pane',
	)
	assert.ok(mine && other)
})

test('4q: handlers use the shared guard (source pins)', () => {
	const ev = read('client/components/device-view-events.js')
	assert.match(ev, /shouldIgnoreShortcut\(ev, wrap\)/)
	assert.ok(ev.indexOf('shouldIgnoreShortcut(ev, wrap)') < ev.indexOf("const isZ = ev.key?.toLowerCase() === 'z'"), 'guard runs before Ctrl+Z')
	const tl = read('client/components/timeline-editor-inputs.js')
	assert.match(tl, /const inField = isTextEntryTarget\(e\.target\)/)
	assert.match(tl, /if \(inField && \(e\.key === ' ' \|\| \(mod && \(k === 'c' \|\| k === 'v'\)\)/)
	assert.match(read('client/components/scenes-editor-keyboard.js'), /isTextEntryTarget\(e\.target\)/)
})

test('7c: nextNumberedIndex never re-issues an id after a removal', async () => {
	const { nextNumberedIndex } = await esm('client/lib/next-numbered-id.js')
	assert.equal(nextNumberedIndex([], 'str'), 1)
	assert.equal(nextNumberedIndex([{ id: 'str_1' }, { id: 'str_2' }, { id: 'str_3' }].filter((x) => x.id !== 'str_2'), 'str'), 4)
	assert.equal(nextNumberedIndex([{ id: 'str_2' }], 'str'), 3, '[str_1,str_2] minus str_1 must not give str_2')
	assert.equal(nextNumberedIndex([{ id: 'custom' }, { id: 'rec_1' }], 'str'), 1)
})

test('7c: addMappingOutput after removing a middle output gets a fresh id', async () => {
	const svc = await esm('client/lib/mapping-node-service.js')
	const { api } = await esm('client/lib/api-client.js')
	const graph = {
		devices: [{ id: 'm1', role: 'pixel_mapping', settings: { outputs: [{ id: 'out_1' }, { id: 'out_3' }] } }],
		connectors: [],
	}
	const realGet = api.get
	const realPost = api.post
	let posted = null
	api.get = async () => ({ graph })
	api.post = async (url, body) => { posted = body; return { ok: true } }
	try {
		const r = await svc.addMappingOutput('m1')
		assert.equal(r.ok, true)
		const ids = posted.deviceGraph.devices[0].settings.outputs.map((o) => o.id)
		assert.deepEqual(ids, ['out_1', 'out_3', 'out_4'])
	} finally {
		api.get = realGet
		api.post = realPost
	}
})

test('7c: stream/record/audio add sites use nextNumberedIndex, not length + 1', () => {
	for (const rel of ['client/components/device-view-bands-render.js', 'client/components/device-view-matrix.js']) {
		const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
		assert.doesNotMatch(src, /cur\.length \+ 1/, rel)
		assert.match(src, /nextNumberedIndex\(cur, '(str|rec)'\)/, rel)
	}
	assert.match(read('client/components/device-view-bands-render.js'), /nextNumberedIndex\(cur, 'audio'\)/)
})

test('7c: device-graph-suggest keeps both DeckLink ports when slot ids clash across devices', () => {
	const { suggestConnectorsAndDevicesFromLive } = require('../../src/config/device-graph-suggest.js')
	const live = { decklink: { detected: true, inputs: [{ slot: 2, device: 2 }], screenOutputs: [{ screen: 2, device: 3 }] } }
	const ids = suggestConnectorsAndDevicesFromLive(live, {}).connectors.filter((c) => c.kind === 'decklink_io').map((c) => c.id)
	assert.deepEqual(ids, ['dlsdi_2', 'dlsdi_3'])
	assert.equal(new Set(ids).size, ids.length)
	// non-clashing layouts keep their slot-based ids
	const plain = { decklink: { detected: true, inputs: [{ slot: 1, device: 1 }, { slot: 2, device: 2 }], screenOutputs: [] } }
	assert.deepEqual(
		suggestConnectorsAndDevicesFromLive(plain, {}).connectors.filter((c) => c.kind === 'decklink_io').map((c) => c.id),
		['dlsdi_1', 'dlsdi_2'],
	)
})

test('RMW: whole-graph reads are cache-busted, reloads after writes are forced', () => {
	assert.match(read('client/lib/mapping-state.js'), /await MappingNodeService\.fetchDeviceView\(\)/)
	assert.doesNotMatch(read('client/lib/mapping-state.js'), /api\.get\('\/api\/device-view'\)/)
	assert.doesNotMatch(read('client/components/pixel-map-editor.js'), /api\.get\('\/api\/device-view'\)/)
	assert.doesNotMatch(read('client/components/sources-panel-decklink-drop.js'), /api\.get\('\/api\/device-view'\)/)
	const bare = /await load(\?\.)?\(\)/
	for (const rel of [
		'client/components/device-view-inspector-decklink-input.js',
		'client/components/device-view-inspector-decklink-output.js',
		'client/components/device-view-inspector-gpu-layout-editor.js',
	]) {
		assert.doesNotMatch(read(rel).replace(/\/\*[\s\S]*?\*\//g, ''), bare, `${rel}: bare load()`)
	}
})

test('MIX + MERGE migrates to MIX + ANIMATE (space kept), not a CUT', () => {
	const t = require('../../client/lib/transition-presets.js')
	assert.equal(t.migrateTransitionTypeToAnimate('MIX + MERGE'), 'MIX + ANIMATE')
	assert.equal(t.migrateTransitionTypeToAnimate('WIPE +MERGE'), 'WIPE + ANIMATE')
	assert.deepEqual(t.normalizeTransitionForPgmOnly({ type: 'MIX + MERGE', duration: 25 }), { type: 'MIX + ANIMATE', duration: 25, tween: 'linear' })
	for (const ty of t.TRANSITION_TYPES) assert.ok(ty === t.migrateTransitionTypeToAnimate(ty), `${ty} unchanged`)
})

test('4o: electron launcher markup uses ASCII quotes in tags', () => {
	const html = read('client/tools/electron-launcher/index.html')
	const tags = html.match(/<[^>]*>/g) || []
	assert.deepEqual(tags.filter((t) => /[“”‘’]/.test(t)), [])
	assert.match(html, /<section class="tab-pane" id="tab-partition" data-partial="partials\/tab-partition\.html">/)
})

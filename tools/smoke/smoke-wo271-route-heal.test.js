'use strict'

/**
 * WO-271: stale route:// channel healing (config live sources, persisted MV layouts, both belts).
 * Offline-only — heal functions run against a synthetic map fixture; wiring via source asserts.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const heal = require('../../src/config/live-source-route-heal')
const { routeForCell } = require('../../src/engine/multiview-layout-helper')

const REPO = path.join(__dirname, '../..')

function src(rel) {
	return fs.readFileSync(path.join(REPO, rel), 'utf8')
}

/** Mirrors the live box: operator channel inserted at 5 pushed the DeckLink host to 6. */
const MAP = {
	programChannels: [1, 3],
	previewChannels: [2, null],
	multiviewChannels: [4],
	inputsCh: 6,
	decklinkInputChannels: [6],
	inputChannels: [
		{ kind: 'decklink', slot: 4, channel: 6, layer: 4, route: 'route://6-4', label: 'DeckLink 4' },
		{ kind: 'ndi_host', slot: 0, channel: 7, layer: 1, route: 'route://7-1', label: 'NDI Cam', sourceId: 'ndi_cam' },
	],
	programCh: (n) => [1, 3][n - 1],
	previewCh: (n) => [2, null][n - 1],
}

describe('WO-271 T271.1: healMultiviewCellSource', () => {
	it('heals a stale decklink cell by label/type', () => {
		const cell = { id: 'cell_x', type: 'decklink', label: 'DeckLink 4', source: 'route://5-4' }
		assert.equal(heal.healMultiviewCellSource(cell, MAP), 'route://6-4')
	})

	it('leaves currently-valid routes alone', () => {
		assert.equal(heal.healMultiviewCellSource({ type: 'pgm', source: 'route://1' }, MAP), null)
		assert.equal(heal.healMultiviewCellSource({ type: 'decklink', label: 'DeckLink 4', source: 'route://6-4' }, MAP), null)
	})

	it('heals a stale number that COLLIDES with a different now-valid channel (identity wins)', () => {
		// 7 is in the known set, but it is the NDI host — the cell's decklink identity must win.
		const byId = { id: 'mv_decklink_3', type: 'decklink', source: 'route://7-4' }
		assert.equal(heal.healMultiviewCellSource(byId, MAP), 'route://6-4')
		const byLabel = { id: 'cell_x', type: 'decklink', label: 'DeckLink 4', source: 'route://7-4' }
		assert.equal(heal.healMultiviewCellSource(byLabel, MAP), 'route://6-4')
		// Symmetric collision: label identity beats a stale number squatting on the decklink channel.
		assert.equal(heal.healMultiviewCellSource({ type: 'ndi', label: 'NDI Cam', source: 'route://6-1' }, MAP), 'route://7-1')
		// No identity → the known-number fallback still applies (no regression).
		assert.equal(heal.healMultiviewCellSource({ type: 'media', source: 'route://7' }, MAP), null)
	})

	it('heals by label match for non-decklink kinds; unresolvable stays null', () => {
		assert.equal(heal.healMultiviewCellSource({ type: 'ndi', label: 'NDI Cam', source: 'route://9-1' }, MAP), 'route://7-1')
		assert.equal(heal.healMultiviewCellSource({ type: 'media', label: 'clip', source: 'route://99' }, MAP), null)
		assert.equal(heal.healMultiviewCellSource({ type: 'media', label: 'clip' }, MAP), null)
	})
})

describe('WO-271 T271.1: authoritativeEntryForSource', () => {
	it('resolves decklink by slot and ndi by sourceId', () => {
		assert.equal(heal.authoritativeEntryForSource({ routeType: 'decklink', decklinkSlot: 4 }, MAP).route, 'route://6-4')
		assert.equal(heal.authoritativeEntryForSource({ routeType: 'ndi_host', sourceId: 'ndi_cam' }, MAP).route, 'route://7-1')
		assert.equal(heal.authoritativeEntryForSource({ routeType: 'decklink', decklinkSlot: 2 }, MAP), null)
	})
})

describe('WO-271 T271.3: routeForCell heals before verbatim replay', () => {
	it('stale persisted decklink source re-resolves; valid sources replay verbatim', () => {
		const stale = { id: 'cell_x', type: 'decklink', label: 'DeckLink 4', source: 'route://5-4' }
		assert.equal(routeForCell(stale, MAP, MAP.inputsCh, [2]), 'route://6-4')
		const valid = { type: 'pgm', label: 'Program 1', source: 'route://1' }
		assert.equal(routeForCell(valid, MAP, MAP.inputsCh, [2]), 'route://1')
		// Collision: stale number 7 is valid on the CURRENT map (NDI host) — identity must still win.
		const collided = { id: 'cell_x', type: 'decklink', label: 'DeckLink 4', source: 'route://7-4' }
		assert.equal(routeForCell(collided, MAP, MAP.inputsCh, [2]), 'route://6-4')
	})
})

describe('WO-271 T271.2/T271.4: wiring (source asserts)', () => {
	it('routing-setup heals config + persisted layouts before replay', () => {
		const routing = src('src/config/routing-setup.js')
		assert.match(routing, /healExtraLiveSourceChannels\(self\.config/)
		assert.match(routing, /healPersistedMultiviewLayouts\(self\)/)
		const idx = routing.indexOf('healPersistedMultiviewLayouts')
		assert.ok(idx > 0 && idx < routing.indexOf('reapplyAllMultiviewLayouts'), 'heal must precede multiview reapply')
	})

	it('mv editor resolves srcCh through the heal-aware helper', () => {
		const editor = src('client/components/multiview-editor.js')
		assert.match(editor, /resolveMvCellSourceChannel\(c, parsed, cm\)/)
		assert.match(editor, /if \(srcCh == null\) continue/)
		const lib = src('client/lib/input-channels.js')
		assert.match(lib, /export function resolveMvCellSourceChannel/)
	})

	it('client resolver resolves identity BEFORE the known-number fallback (mirror lockstep)', () => {
		const lib = src('client/lib/input-channels.js')
		const body = lib.slice(lib.indexOf('export function resolveMvCellSourceChannel'))
		const identityAt = body.indexOf("e.kind === 'decklink' && e.slot === slot")
		const knownAt = body.indexOf('known.has(ch)')
		assert.ok(identityAt > 0 && knownAt > 0 && identityAt < knownAt, 'identity resolution must precede the known-number check')
	})
})

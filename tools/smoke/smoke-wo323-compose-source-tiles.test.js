'use strict'

/**
 * WO-323 smoke — compose preview: add/remove live sources as tiles.
 *
 * Covers the pure client logic (operator-compose-tiles.js is require-safe under plain node, same
 * pattern as smoke-wo256): the separate source-tile store, drag-payload normalization
 * (single + multi), the drop rejection guard (non-route / multiview output / compose channel
 * itself), mvcell channel resolution incl. WO-271 route-heal, the seed key that keeps source
 * tiles from colliding with PGM/PRV cells, and the invariant that the pgm/prv layout re-default
 * rule is computed WITHOUT source tiles (they must never be wiped by a role-set change).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
	sourceTilesStorageKey,
	loadSourceTiles,
	saveSourceTiles,
	normalizeSourceDropItems,
	sourceTileRejection,
	resolveSourceTileChannel,
	resolveTileChannel,
	tileSeedKey,
	resolveTileLayout,
} = require('../../client/components/operator-compose-tiles.js')

const { parseRouteValue } = require('../../client/lib/input-channels.js')

function memStorage(seed = {}) {
	const m = new Map(Object.entries(seed))
	return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }
}

const CM = {
	programChannels: [1],
	previewChannels: [2],
	inputChannels: [
		{ kind: 'decklink', slot: 1, channel: 5, label: 'DeckLink 1' },
		{ kind: 'ndi_host', channel: 6, label: 'Studio NDI' },
	],
	multiviewChannels: [7],
	operatorGuiCh: 4,
}

describe('WO-323: source-tile store', () => {
	it('key follows the storageKeyPrefix convention', () => {
		assert.equal(sourceTilesStorageKey('casparcg_preview'), 'casparcg_preview_operator_source_tiles')
		assert.equal(sourceTilesStorageKey(''), 'casparcg_preview_operator_source_tiles')
	})

	it('save/load round-trips and drops malformed entries', () => {
		const s = memStorage()
		const key = sourceTilesStorageKey('p')
		const tiles = [
			{ id: 'src_route_5', type: 'decklink', value: 'route://5', label: 'DeckLink 1', frac: { x: 0, y: 0, w: 0.3, h: 0.3 } },
		]
		saveSourceTiles(s, key, tiles)
		assert.deepEqual(loadSourceTiles(s, key), tiles)
		// Malformed store content must not throw and must be filtered.
		s.setItem(key, JSON.stringify([{ id: 'ok', value: 'route://5' }, { noId: true }, null, { id: 'noValue' }]))
		assert.deepEqual(loadSourceTiles(s, key).map((t) => t.id), ['ok'])
		s.setItem(key, '{not json')
		assert.deepEqual(loadSourceTiles(s, key), [])
	})
})

describe('WO-323: drag-payload normalization', () => {
	it('single payload (sources-panel makeDraggable shape)', () => {
		const items = normalizeSourceDropItems({ type: 'decklink', value: 'route://5-4', label: 'DeckLink 1', resolution: '1920×1080' })
		assert.equal(items.length, 1)
		assert.deepEqual(items[0], { type: 'decklink', value: 'route://5-4', label: 'DeckLink 1', resolution: '1920×1080' })
	})

	it('multi payload flattens items and skips value-less entries', () => {
		const items = normalizeSourceDropItems({
			type: 'multi',
			items: [
				{ type: 'decklink', value: 'route://5', label: 'DeckLink 1' },
				{ type: 'ndi', label: 'no value' },
				{ type: 'ndi_host', value: 'route://6', label: 'Studio NDI' },
			],
		})
		assert.deepEqual(items.map((i) => i.value), ['route://5', 'route://6'])
	})

	it('garbage in, empty out', () => {
		assert.deepEqual(normalizeSourceDropItems(null), [])
		assert.deepEqual(normalizeSourceDropItems('route://5'), [])
		assert.equal(normalizeSourceDropItems({ type: 'multi', items: 'nope' }).length, 0)
	})
})

describe('WO-323: drop rejection guard', () => {
	it('accepts a configured live-input route', () => {
		assert.equal(sourceTileRejection('route://5', CM), null)
		assert.equal(sourceTileRejection('route://5-4', CM), null)
	})

	it('rejects non-route values (no channel to compose)', () => {
		assert.match(sourceTileRejection('ndi://STUDIO (cam1)', CM), /no playout channel/)
	})

	it('rejects the multiview outputs (WO-156) and the compose channel itself', () => {
		assert.match(sourceTileRejection('route://7', CM), /multiview output/)
		assert.match(sourceTileRejection('route://4', CM), /compose output/)
	})

	it('legacy single multiviewCh field is honoured too', () => {
		const cm = { ...CM, multiviewChannels: undefined, multiviewCh: 9 }
		assert.match(sourceTileRejection('route://9', cm), /multiview output/)
	})
})

describe('WO-323: mvcell channel resolution', () => {
	it('resolveTileChannel returns the def srcCh for mvcell and null when unresolved', () => {
		assert.equal(resolveTileChannel({ role: 'mvcell', srcCh: 6 }, CM), 6)
		assert.equal(resolveTileChannel({ role: 'mvcell', srcCh: null }, CM), null)
		assert.equal(resolveTileChannel({ role: 'mvcell' }, CM), null)
		// pgm/prv paths untouched
		assert.equal(resolveTileChannel({ role: 'prv', mainIndex: 0 }, CM), 2)
		assert.equal(resolveTileChannel({ role: 'pgm', mainIndex: 0 }, CM), 1)
	})

	it('resolveSourceTileChannel heals a stale decklink route to the current slot channel (WO-271)', () => {
		// Stored when the DeckLink sat on channel 9; the map now has slot 1 on channel 5.
		const tile = { id: 'src_route_9_4', type: 'decklink', value: 'route://9-4', label: 'DeckLink 1' }
		assert.equal(resolveSourceTileChannel(tile, CM), 5)
	})

	it('unresolvable stale route yields null (tile reports no cell)', () => {
		const tile = { id: 'x', type: 'ndi', value: 'route://99', label: 'gone' }
		assert.equal(resolveSourceTileChannel(tile, CM), null)
		assert.equal(resolveSourceTileChannel({ id: 'x', type: 'ndi', value: 'not-a-route', label: 'x' }, CM), null)
	})
})

describe('WO-323: seed keys and layout-store separation', () => {
	it('source tiles key by channel, never by mainIndex (all 0)', () => {
		assert.equal(tileSeedKey({ role: 'mvcell', srcCh: 5, mainIndex: 0 }), 'mvcell:5')
		assert.equal(tileSeedKey({ role: 'mvcell', srcCh: 6, mainIndex: 0 }), 'mvcell:6')
		assert.equal(tileSeedKey({ role: 'pgm', mainIndex: 0 }), 'pgm:0')
		assert.equal(tileSeedKey({ role: 'prv', mainIndex: 1 }), 'prv:1')
	})

	it('pgm/prv layout re-default rule sees only base defs — a stored map without source-tile ids still wins', () => {
		const baseDefs = [
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0 },
			{ id: 'prv_1', role: 'prv', mainIndex: 0 },
		]
		const stored = {
			pgm_1: { x: 0.5, y: 0, w: 0.5, h: 1 },
			prv_1: { x: 0, y: 0, w: 0.5, h: 1 },
		}
		// The runtime passes ONLY base defs to resolveTileLayout (source tiles carry their own
		// frac from their own store) — so the stored pgm/prv layout is preserved even though a
		// user source tile exists that the stored map knows nothing about.
		const resolved = resolveTileLayout(baseDefs, stored)
		assert.deepEqual(resolved, stored)
	})
})

describe('WO-323: parseRouteValue relocation', () => {
	it('parseRouteValue is require-safe from input-channels.js and parses both route forms', () => {
		assert.deepEqual(parseRouteValue('route://5'), { channel: 5, layer: null })
		assert.deepEqual(parseRouteValue('route://5-4'), { channel: 5, layer: 4 })
		assert.equal(parseRouteValue('media/clip'), null)
	})

	it('scenes-shared.js re-exports it for its existing importers (source assertion)', () => {
		const fs = require('node:fs')
		const path = require('node:path')
		const src = fs.readFileSync(path.join(__dirname, '../../client/components/scenes-shared.js'), 'utf8')
		assert.match(src, /import \{ parseRouteValue \} from '\.\.\/lib\/input-channels\.js'/)
		assert.match(src, /export \{ parseRouteValue \}/)
	})
})

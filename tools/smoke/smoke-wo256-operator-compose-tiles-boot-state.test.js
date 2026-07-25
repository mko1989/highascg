'use strict'

/**
 * WO-256 smoke — Operator-GUI compose preview becomes a free-tile canvas (multiviewer-style
 * movable/resizable windows). Split out of smoke-wo256-operator-compose-tiles.test.js (line-count
 * refactor) — this file owns the 2026-07-19 boot-state regression: a provisional (pre-WS-state)
 * render must never report rects, or the kiosk client's own first render clobbers a layout the
 * server already re-applied from persistence. Default-layout math, chrome/body geometry,
 * persistence, T256.2/T256.4/T256.5 wiring, and resize behavior live in
 * smoke-wo256-operator-compose-tiles.test.js and its other siblings.
 *
 * 2026-07-19 bug (owner: "after highascg restart the operator gui starts with a stale compose
 * preview layout and only comes back to the saved one when i trigger a look").
 *
 * PROVEN mechanism: the kiosk client builds the compose tile canvas BEFORE the WS `state` message
 * lands, so `channelMap` is still `{}`. preview-canvas-panel.js's `getComposeCellDefs` then yields
 * ONE provisional `pgm_1` def, `resolveTileLayout` legitimately defaults it to a single
 * full-canvas tile, and the resulting rect report OVERWRITES the multi-cell layout the server had
 * just re-applied from `operatorGuiLayout` persistence ("Operator GUI re-apply: 3 cell(s)
 * applied" -> "[Operator GUI] timing: first rect report cells=1" -> shape overlay down to 1 rect).
 *
 * These tests drive the REAL `initOperatorComposeTiles` against a minimal DOM stub (no jsdom in
 * this repo) so they fail if the pre-state suppression regresses.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { layoutStorageKey } = require('../../client/components/operator-compose-tiles.js')

describe('2026-07-19 fix: a provisional (pre-state) render must never report rects', () => {
	const DEFAULT_CANVAS = { w: 1200, h: 700 }

	function px(v) {
		const n = parseFloat(String(v == null ? '0' : v))
		return Number.isFinite(n) ? n : 0
	}

	function makeEl(tag) {
		const el = {
			tagName: tag,
			className: '',
			textContent: '',
			title: '',
			type: '',
			disabled: false,
			dataset: {},
			style: {},
			children: [],
			parent: null,
			__h: {},
			classList: { add() {}, remove() {}, toggle() {} },
			appendChild(c) { c.parent = el; el.children.push(c); return c },
			append(...cs) { for (const c of cs) el.appendChild(c) },
			remove() { if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el); el.parent = null },
			addEventListener(type, fn) { (el.__h[type] = el.__h[type] || []).push(fn) },
			removeEventListener(type, fn) { el.__h[type] = (el.__h[type] || []).filter((f) => f !== fn) },
			fire(type, ev) { for (const fn of [...(el.__h[type] || [])]) fn(ev) },
			getBoundingClientRect() {
				let left = px(el.style.left)
				let top = px(el.style.top)
				for (let p = el.parent; p; p = p.parent) { left += px(p.style.left); top += px(p.style.top) }
				const width = el.style.width === undefined ? DEFAULT_CANVAS.w : px(el.style.width)
				const height = el.style.height === undefined ? DEFAULT_CANVAS.h : px(el.style.height)
				return { left, top, width, height, right: left + width, bottom: top + height }
			},
		}
		return el
	}

	/** Installs the DOM stub globals, runs `fn(harness)`, restores the globals unconditionally. */
	function withFakeDom(fn) {
		const saved = {}
		for (const k of ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'ResizeObserver', 'IntersectionObserver']) {
			saved[k] = Object.prototype.hasOwnProperty.call(globalThis, k) ? globalThis[k] : undefined
		}
		const rafQueue = []
		const docHandlers = {}
		const store = new Map()
		globalThis.document = {
			createElement: (tag) => makeEl(tag),
			addEventListener(type, f) { (docHandlers[type] = docHandlers[type] || []).push(f) },
			removeEventListener(type, f) { docHandlers[type] = (docHandlers[type] || []).filter((x) => x !== f) },
			dispatchEvent() {},
		}
		globalThis.window = { innerWidth: 1920, innerHeight: 1080, addEventListener() {}, removeEventListener() {} }
		globalThis.requestAnimationFrame = (f) => { rafQueue.push(f); return rafQueue.length }
		globalThis.cancelAnimationFrame = () => {}
		globalThis.localStorage = {
			getItem: (k) => (store.has(k) ? store.get(k) : null),
			setItem: (k, v) => { store.set(k, String(v)) },
		}
		delete globalThis.ResizeObserver
		delete globalThis.IntersectionObserver
		try {
			return fn({
				flushRaf: () => { while (rafQueue.length) rafQueue.shift()() },
				fireDoc: (type, ev) => { for (const f of [...(docHandlers[type] || [])]) f(ev) },
				storage: store,
			})
		} finally {
			for (const [k, v] of Object.entries(saved)) {
				if (v === undefined) delete globalThis[k]
				else globalThis[k] = v
			}
		}
	}

	/** Mirrors client/lib/state-store.js: a full `setState` emits ONLY '*', never 'channelMap'. */
	function makeStore(initialChannelMap) {
		const listeners = new Map()
		let state = initialChannelMap ? { channelMap: initialChannelMap } : {}
		return {
			getState: () => state,
			on(key, fn) {
				if (!listeners.has(key)) listeners.set(key, [])
				listeners.get(key).push(fn)
				return () => { listeners.set(key, (listeners.get(key) || []).filter((f) => f !== fn)) }
			},
			/** WS 'state' arrival — StateStore.setState() emits '*' only. */
			setFullState(channelMap) {
				state = { channelMap }
				for (const fn of listeners.get('*') || []) fn('*', null)
			},
		}
	}

	/** Mirrors preview-canvas-panel.js's `getComposeCellDefs` for the compose toggle path. */
	function defsFromChannelMap(cm) {
		const map = cm || {}
		const screenCount = Math.max(1, map.screenCount || 1)
		const out = []
		for (let i = 0; i < screenCount; i++) {
			out.push({ id: `pgm_${i + 1}`, role: 'pgm', mainIndex: i })
			const prvCh = map.previewChannels?.[i] ?? null
			if (map.previewEnabledByMain?.[i] !== false && prvCh != null) out.push({ id: `prv_${i + 1}`, role: 'prv', mainIndex: i })
		}
		return out
	}

	const REAL_CM = {
		screenCount: 3,
		programChannels: [1, 2, 3],
		previewChannels: [null, null, null],
		previewEnabledByMain: [false, false, false],
	}

	it('hasResolvedChannelState: {} is provisional, a server-built channelMap is real', () => {
		const { hasResolvedChannelState } = require('../../client/components/operator-compose-tiles.js')
		assert.equal(hasResolvedChannelState(null), false)
		assert.equal(hasResolvedChannelState({}), false, 'the pre-WS-state channelMap is NOT real state')
		assert.equal(hasResolvedChannelState({ screenCount: 0 }), false)
		assert.equal(hasResolvedChannelState(REAL_CM), true)
		assert.equal(hasResolvedChannelState({ programChannels: [1, 2] }), true, 'programChannels alone is enough')
	})

	it('pre-state render builds tiles but reports NOTHING (the single provisional tile never reaches the wire)', () => {
		withFakeDom(({ flushRaf }) => {
			const { initOperatorComposeTiles } = require('../../client/components/operator-compose-tiles.js')
			const reports = []
			const stateStore = makeStore(null)
			const handle = initOperatorComposeTiles(makeEl('div'), {
				getComposeCellDefs: () => defsFromChannelMap(stateStore.getState().channelMap),
				stateStore,
				onCellRects: (cells) => reports.push(cells),
			})
			flushRaf()
			assert.equal(defsFromChannelMap(stateStore.getState().channelMap).length, 1, 'pre-state defs really are the single provisional pgm_1 tile')
			assert.deepEqual(reports, [], 'no report at all while the channelMap is still empty')
			handle.destroy()
			assert.deepEqual(reports, [], 'destroy of a never-ready canvas must not send an empty withdrawal either')
		})
	})

	it('post-state render DOES report, with every cell of the real screen set', () => {
		withFakeDom(({ flushRaf }) => {
			const { initOperatorComposeTiles } = require('../../client/components/operator-compose-tiles.js')
			const reports = []
			const stateStore = makeStore(REAL_CM)
			initOperatorComposeTiles(makeEl('div'), {
				getComposeCellDefs: () => defsFromChannelMap(stateStore.getState().channelMap),
				stateStore,
				onCellRects: (cells) => reports.push(cells),
			})
			flushRaf()
			assert.equal(reports.length, 1, 'exactly one report once state is already present')
			assert.deepEqual(reports[0].map((c) => c.id), ['pgm_1', 'pgm_2', 'pgm_3'])
			for (const c of reports[0]) assert.ok(c.rect.width > 0 && c.rect.height > 0, 'real non-empty rects')
		})
	})

	it('boot sequence: a saved 3-cell layout survives the provisional window and is the FIRST thing reported', () => {
		withFakeDom(({ flushRaf, storage }) => {
			const { initOperatorComposeTiles } = require('../../client/components/operator-compose-tiles.js')
			// Operator's saved layout from the previous session, keyed by screen count (3).
			const saved = {
				pgm_1: { x: 0.02, y: 0.1, w: 0.3, h: 0.35 },
				pgm_2: { x: 0.35, y: 0.1, w: 0.3, h: 0.35 },
				pgm_3: { x: 0.68, y: 0.1, w: 0.3, h: 0.35 },
			}
			storage.set(layoutStorageKey('casparcg_preview', 3), JSON.stringify(saved))

			const reports = []
			const stateStore = makeStore(null) // kiosk boots: WS state has NOT arrived yet
			initOperatorComposeTiles(makeEl('div'), {
				getComposeCellDefs: () => defsFromChannelMap(stateStore.getState().channelMap),
				stateStore,
				onCellRects: (cells) => reports.push(cells),
			})
			flushRaf()
			assert.deepEqual(reports, [], 'provisional window: server keeps its re-applied layout')

			// WS 'state' lands. StateStore.setState emits ONLY '*' — the fix must latch on that.
			stateStore.setFullState(REAL_CM)
			flushRaf()

			assert.ok(reports.length >= 1, 'reports resume once real state arrives')
			assert.deepEqual(reports[0].map((c) => c.id), ['pgm_1', 'pgm_2', 'pgm_3'], 'FIRST report on the wire is the full saved 3-cell set, never a 1-cell shrink')
			const first = reports[0]
			// Saved fractions, not the default layout (which is one FULL-WIDTH row per screen at x=0).
			const savedLeft = saved.pgm_1.x * DEFAULT_CANVAS.w
			assert.ok(first[0].rect.left >= savedLeft && first[0].rect.left < savedLeft + 12, 'restored from the saved layout, not re-defaulted')
			assert.ok(first[0].rect.width < DEFAULT_CANVAS.w * 0.5, 'saved narrow tiles, not the full-width default row')
			assert.ok(first[1].rect.left > first[0].rect.left, 'saved side-by-side arrangement preserved')
		})
	})

	it('a genuine operator tile MOVE still reports immediately after state is ready', () => {
		withFakeDom(({ flushRaf, fireDoc }) => {
			const { initOperatorComposeTiles } = require('../../client/components/operator-compose-tiles.js')
			const reports = []
			const container = makeEl('div')
			const stateStore = makeStore(REAL_CM)
			initOperatorComposeTiles(container, {
				getComposeCellDefs: () => defsFromChannelMap(stateStore.getState().channelMap),
				stateStore,
				onCellRects: (cells) => reports.push(cells),
			})
			flushRaf()
			const before = reports.length
			// Default layout = one full-width row per screen, so the only free axis is vertical.
			const startTop = reports[before - 1][0].rect.top

			// The footer strip is the drag handle (operator grabs a tile and moves it right+down).
			const root = container.children[0]
			const tileEl = root.children.find((c) => c.className === 'operator-tile')
			const footerEl = tileEl.children.find((c) => c.className === 'operator-tile__footer')
			footerEl.fire('pointerdown', {
				button: 0, clientX: 100, clientY: 100, pointerId: 1,
				preventDefault() {}, stopPropagation() {}, target: { setPointerCapture() {} },
			})
			fireDoc('pointermove', { clientX: 260, clientY: 180 })
			flushRaf()
			assert.ok(reports.length > before, 'mid-drag reports still fire LIVE (WO-263 holes track the box)')
			assert.ok(reports[reports.length - 1][0].rect.top > startTop, 'the moved rect is what got reported')

			const midCount = reports.length
			fireDoc('pointerup', {})
			assert.equal(reports.length, midCount + 1, 'drag end reports the final settled rect immediately, no debounce')
		})
	})
})

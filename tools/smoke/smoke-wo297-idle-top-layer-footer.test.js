'use strict'

/**
 * WO-297 smoke (todos19.07.26): "in the compose preview when there is no 'running' source on the
 * screen it should show the highest layer's content in the progress-bar section under the preview
 * window, just without timers."
 *
 * Covers client/components/playback-timer.js:
 *  - `idleLayerContentLabel` — what a layer is showing, with no timing attached ('' for a cleared
 *    layer, so an idle tile shows NOTHING rather than a stale label).
 *  - `pickTopLayerContentForIdle` — the same bank/exclusion/staleness scan as WO-250's
 *    `pickTopLayerStateForPlayback` (single implementation, asserted structurally below).
 *  - `mountPgmTopLayerPlaybackTimer` idle rendering: label in the row, progress bar hidden,
 *    no per-frame DOM writes while idle, bar restored when playback resumes.
 *  - operator-compose-tiles.js `TILE_CHROME.footerH` is untouched (the hole geometry depends on it).
 *
 * playback-timer.js is plain ESM but has no top-level DOM access, so `require()` works under
 * node:test (same pattern as smoke-wo250-timer-bank-mv-bars.test.js). The mount tests install a
 * minimal DOM stub — this file owns its own, deliberately NOT the wo256 harness, so extending it
 * here can never perturb the compose-tile rect/readiness tests.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
	idleLayerContentLabel,
	pickTopLayerContentForIdle,
	pickTopLayerStateForPlayback,
	mountPgmTopLayerPlaybackTimer,
} = require('../../client/components/playback-timer.js')
const { TILE_CHROME } = require('../../client/components/operator-compose-tiles.js')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('WO-297: idleLayerContentLabel — what is on the layer, no timing', () => {
	it('a cleared layer (Caspar producer name "empty") has no content -> no label', () => {
		assert.equal(idleLayerContentLabel({ type: 'empty', file: {} }), '')
		assert.equal(idleLayerContentLabel({ type: 'empty', file: { name: 'stale.mp4' } }), '',
			'"empty" wins over a leftover file name — never show a stale label')
	})

	it('nothing at all -> no label (null/undefined/blank layer)', () => {
		assert.equal(idleLayerContentLabel(null), '')
		assert.equal(idleLayerContentLabel(undefined), '')
		assert.equal(idleLayerContentLabel({}), '')
		assert.equal(idleLayerContentLabel({ type: null, file: {} }), '')
	})

	it('file name wins, then the path basename', () => {
		assert.equal(idleLayerContentLabel({ type: 'ffmpeg', file: { name: 'BREAK.mp4' } }), 'BREAK.mp4')
		assert.equal(idleLayerContentLabel({ type: 'ffmpeg', file: { path: 'C:\\media\\clips\\SLIDE.png' } }), 'SLIDE.png',
			'Windows-style Caspar paths reduce to the basename')
	})

	it('a template layer falls back to its template basename', () => {
		assert.equal(
			idleLayerContentLabel({ type: 'html', file: {}, template: { path: '/opt/templates/lower-third.html' } }),
			'lower-third.html',
		)
	})

	it('a producer with neither file nor template still identifies itself', () => {
		assert.equal(idleLayerContentLabel({ type: 'route', file: {} }), 'route')
		assert.equal(idleLayerContentLabel({ type: 'decklink', file: {} }), 'decklink')
	})

	it('long labels are truncated like the running-clip label (no footer overflow)', () => {
		const long = 'A'.repeat(80) + '.mp4'
		const out = idleLayerContentLabel({ type: 'ffmpeg', file: { name: long } })
		assert.ok(out.length <= 32, `truncated to the shared 32-char budget, got ${out.length}`)
		assert.ok(out.endsWith('…'))
	})
})

describe('WO-297: pickTopLayerContentForIdle — same scan rules as the playback pick', () => {
	const layer = (extra) => ({ type: 'ffmpeg', file: {}, _lastOscAt: 0, ...extra })

	it('picks the HIGHEST layer that has content, ignoring cleared layers above it', () => {
		const ch = {
			layers: {
				10: layer({ file: { name: 'bed.mp4' } }),
				30: layer({ file: { name: 'TOP.png' } }),
				40: layer({ type: 'empty', file: {} }),
			},
		}
		const got = pickTopLayerContentForIdle(ch, {})
		assert.equal(got.layerNum, 30)
		assert.equal(got.label, 'TOP.png')
	})

	it('a channel with nothing on any layer -> null layer and an EMPTY label (show nothing)', () => {
		const ch = { layers: { 10: layer({ type: 'empty' }), 20: layer({ type: 'empty' }) } }
		const got = pickTopLayerContentForIdle(ch, {})
		assert.equal(got.layerNum, null)
		assert.equal(got.layerState, null)
		assert.equal(got.label, '')
	})

	it('no channel state at all -> null/empty, no throw', () => {
		assert.deepEqual(pickTopLayerContentForIdle(undefined, {}), { layerNum: null, layerState: null, label: '' })
		assert.deepEqual(pickTopLayerContentForIdle({}, undefined), { layerNum: null, layerState: null, label: '' })
	})

	it('WO-250 bank ranges are honoured: bank b reads 110-199, not bank a 10-99', () => {
		const ch = {
			layers: {
				20: layer({ file: { name: 'BANK-A.mp4' } }),
				120: layer({ file: { name: 'BANK-B.mp4' } }),
			},
		}
		assert.equal(pickTopLayerContentForIdle(ch, { bank: 'a' }).label, 'BANK-A.mp4')
		assert.equal(pickTopLayerContentForIdle(ch, { bank: 'b' }).label, 'BANK-B.mp4')
		assert.equal(pickTopLayerContentForIdle(ch, { bank: null }).label, 'BANK-A.mp4', 'bankless defaults to 10-99')
	})

	it('the excluded bands (timer band 980-989, border layer 998) never become the idle label', () => {
		const ch = {
			layers: {
				30: layer({ file: { name: 'REAL.mp4' } }),
				985: layer({ file: { name: 'timer-band' } }),
				998: layer({ file: { name: 'multiview-border' } }),
			},
		}
		assert.equal(pickTopLayerContentForIdle(ch, {}).layerNum, 30)
	})

	it('stale (about-to-be-pruned) layers are skipped, same as the playback pick', () => {
		const now = 1_000_000
		const ch = {
			layers: {
				20: { type: 'ffmpeg', file: { name: 'LIVE.mp4' }, _lastOscAt: now - 500 },
				40: { type: 'ffmpeg', file: { name: 'FROZEN.mp4' }, _lastOscAt: now - 30_000 },
			},
		}
		const got = pickTopLayerContentForIdle(ch, { nowTs: now })
		assert.equal(got.layerNum, 20, 'the losing bank\'s frozen layer must not outrank the live one')
		assert.equal(got.label, 'LIVE.mp4')
	})

	it('a RUNNING layer is still valid idle content (the mount only asks when nothing is running)', () => {
		const ch = { layers: { 20: layer({ file: { name: 'ROLL.mp4', duration: 30, elapsed: 4 } }) } }
		assert.equal(pickTopLayerStateForPlayback(ch, {}).layerNum, 20, 'the playback pick claims it first')
		assert.equal(pickTopLayerContentForIdle(ch, {}).label, 'ROLL.mp4')
	})

	it('ONE top-layer scan implementation, not two (no forked bank/exclusion/staleness logic)', () => {
		const src = read('client/components/playback-timer.js')
		const scans = src.match(/for \(const key of Object\.keys\(layers\)\)/g) || []
		assert.equal(scans.length, 1, 'both picks must delegate to the single pickTopLayerStateBy scan')
		assert.match(src, /function pickTopLayerStateBy\(/)
		assert.match(
			src,
			/export function pickTopLayerStateForPlayback\([^)]*\) \{\s*return pickTopLayerStateBy\(/,
			'the WO-250 playback pick is now a thin predicate over the shared scan',
		)
	})
})

/* -------------------------------------------------------------------------- */
/* Mount-level: what the compose-tile footer actually renders when idle.       */
/* -------------------------------------------------------------------------- */

/** Minimal element stub: enough for playback-timer.js's innerHTML + querySelector-by-class. */
function makeEl() {
	const el = {
		className: '',
		title: '',
		style: {},
		children: [],
		_text: '',
		/** Counts textContent WRITES — the per-frame-work assertion below reads this. */
		writes: 0,
		classList: {
			contains: (c) => el.className.split(/\s+/).includes(c),
			add() {},
			remove() {},
		},
		appendChild(c) { el.children.push(c); return c },
		append(...cs) { for (const c of cs) el.appendChild(c) },
		querySelector(sel) {
			const want = sel.replace(/^\./, '')
			for (const c of el.children) {
				if (c.className.split(/\s+/).includes(want)) return c
				const deep = c.querySelector?.(sel)
				if (deep) return deep
			}
			return null
		},
		set innerHTML(html) {
			el.children = []
			// Flat parse: one stub child per class="..." occurrence is all querySelector needs.
			for (const m of html.matchAll(/class="([^"]+)"/g)) {
				const c = makeEl()
				c.className = m[1]
				el.children.push(c)
			}
		},
		get innerHTML() { return '' },
	}
	Object.defineProperty(el, 'textContent', {
		get: () => el._text,
		set: (v) => { el._text = String(v); el.writes++ },
	})
	return el
}

function withStubDom(fn) {
	const keys = ['document', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame']
	const saved = {}
	for (const k of keys) saved[k] = Object.prototype.hasOwnProperty.call(globalThis, k) ? globalThis[k] : undefined
	const rafQueue = []
	const head = makeEl()
	globalThis.document = { createElement: () => makeEl(), head }
	globalThis.performance = { now: () => 0 }
	globalThis.requestAnimationFrame = (f) => { rafQueue.push(f); return rafQueue.length }
	globalThis.cancelAnimationFrame = () => {}
	try {
		// Runs exactly `n` queued frames (the tick loop re-queues itself each frame).
		const runFrames = (n) => { for (let i = 0; i < n; i++) { const f = rafQueue.shift(); if (!f) return; f() } }
		return fn({ runFrames })
	} finally {
		for (const k of keys) {
			if (saved[k] === undefined) delete globalThis[k]
			else globalThis[k] = saved[k]
		}
	}
}

/** Stub OscClient with just the surface mountPgmTopLayerPlaybackTimer touches. */
function makeOsc(channels) {
	const subs = []
	return {
		channels,
		onAfterIngest(fn) { subs.push(fn); return () => {} },
		/** Simulate an OSC ingest tick (what really drives `refresh`). */
		ingest() { for (const f of subs) f() },
	}
}

const mount = (osc) => {
	const container = makeEl()
	const handle = mountPgmTopLayerPlaybackTimer(container, {
		oscClient: osc,
		getChannel: () => 1,
		getState: () => null,
	})
	return {
		container,
		handle,
		row: container.querySelector('.playback-timer__row'),
		bar: container.querySelector('.playback-timer__bar'),
	}
}

describe('WO-297: compose-tile footer with NO running source', () => {
	it('shows the top layer\'s content label with the timer/progress bar hidden', () => {
		withStubDom(() => {
			const osc = makeOsc({ 1: { layers: { 20: { type: 'ffmpeg', file: { name: 'STING.png' } } } } })
			const { row, bar, container, handle } = mount(osc)
			assert.equal(row.textContent, 'STING.png', 'the highest layer\'s content, in the footer strip')
			assert.equal(bar.style.display, 'none', 'no progress bar when nothing is running')
			assert.doesNotMatch(row.textContent, /--:--|\d+:\d\d/, 'and definitely no timer text')
			assert.match(container.className, /playback-timer--idle/)
			handle.destroy()
		})
	})

	it('a channel with nothing on any layer shows NOTHING (no stale label, no dashes)', () => {
		withStubDom(() => {
			const osc = makeOsc({ 1: { layers: { 20: { type: 'empty', file: {} } } } })
			const { row, bar, handle } = mount(osc)
			assert.equal(row.textContent, '', 'empty layers -> blank footer line')
			assert.equal(bar.style.display, 'none')
			handle.destroy()
		})
	})

	it('an unknown channel (no OSC yet) shows nothing rather than throwing', () => {
		withStubDom(() => {
			const { row, handle } = mount(makeOsc({}))
			assert.equal(row.textContent, '')
			handle.destroy()
		})
	})

	it('the highest layer wins even when a LOWER layer is the one with content-free chrome above', () => {
		withStubDom(() => {
			const osc = makeOsc({
				1: {
					layers: {
						10: { type: 'ffmpeg', file: { name: 'BED.mp4' } },
						50: { type: 'html', file: {}, template: { path: '/tpl/BUG.html' } },
						998: { type: 'ffmpeg', file: { name: 'border' } },
					},
				},
			})
			const { row, handle } = mount(osc)
			assert.equal(row.textContent, 'BUG.html', 'layer 50, not the layer-10 bed and not the 998 border')
			handle.destroy()
		})
	})

	it('idle costs NO per-frame DOM work (the rAF tick loop is guarded by a stored record)', () => {
		withStubDom(({ runFrames }) => {
			const osc = makeOsc({ 1: { layers: { 20: { type: 'ffmpeg', file: { name: 'STILL.png' } } } } })
			const { row, handle } = mount(osc)
			const afterFirstPaint = row.writes
			assert.ok(afterFirstPaint >= 1, 'the idle label was painted once')
			runFrames(60)
			assert.equal(row.writes, afterFirstPaint, '60 animation frames of steady idle wrote to the DOM zero times')
			handle.destroy()
		})
	})

	it('idle -> playing restores the progress bar; playing -> idle hides it again', () => {
		withStubDom(({ runFrames }) => {
			const layers = { 20: { type: 'ffmpeg', file: { name: 'ROLL.mp4' } } }
			const osc = makeOsc({ 1: { layers } })
			const { row, bar, container, handle } = mount(osc)
			assert.equal(bar.style.display, 'none', 'starts idle')

			// Caspar starts rolling: the same layer now reports file/time.
			layers[20].file = { name: 'ROLL.mp4', duration: 30, elapsed: 5 }
			osc.ingest()
			assert.notEqual(bar.style.display, 'none', 'progress bar comes back for a running source')
			assert.match(row.textContent, /ROLL\.mp4 · \d+:\d\d \/ \d+:\d\d/, 'normal clip + timer line')
			assert.doesNotMatch(container.className, /playback-timer--idle/)

			// Clip ends and the layer is cleared.
			layers[20] = { type: 'empty', file: {} }
			layers[30] = { type: 'ffmpeg', file: { name: 'NEXT-SLIDE.png' } }
			osc.ingest()
			assert.equal(bar.style.display, 'none', 'back to idle -> bar hidden again')
			assert.equal(row.textContent, 'NEXT-SLIDE.png')

			const settled = row.writes
			runFrames(30)
			assert.equal(row.writes, settled, 'still no per-frame writes after the round trip')
			handle.destroy()
		})
	})

	it('the footer height contract is untouched (hole geometry depends on TILE_CHROME)', () => {
		assert.equal(TILE_CHROME.footerH, 34, 'idle mode hides the bar with display:none — it must not resize the footer')
		const src = read('client/components/playback-timer.js')
		assert.match(src, /bar\.style\.display = 'none'/, 'idle hides the bar rather than removing it from the DOM')
		assert.doesNotMatch(src, /container\.style\.height/, 'the timer never sizes its own host — the footer owns that')
	})

	it('the idle paint never mutates its host container\'s box', () => {
		withStubDom(() => {
			const osc = makeOsc({ 1: { layers: { 20: { type: 'ffmpeg', file: { name: 'IDLE.png' } } } } })
			const { container, handle } = mount(osc)
			assert.equal(container.style.height, undefined, 'no height written by the idle path')
			assert.equal(container.style.display, undefined, 'the host stays laid out, only the bar hides')
			handle.destroy()
		})
	})
})

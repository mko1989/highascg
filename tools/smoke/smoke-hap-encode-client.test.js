'use strict'

/* WO-575: client side of "Encode to HAP" — pure status helpers (required directly; client/ is ESM but
 * has no top-level await, so Node's require(esm) loads them) + source pins for the wiring. */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const H = require('../../client/lib/hap-encode-status.js')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

test('format label mirrors the server rule: alpha wins over HQ', () => {
	assert.deepStrictEqual(H.hapFormatFor({ alpha: false, hq: false }), { format: 'hap', label: 'HAP', downgraded: false })
	assert.strictEqual(H.hapFormatFor({ alpha: true, hq: false }).label, 'HAP Alpha')
	assert.strictEqual(H.hapFormatFor({ alpha: false, hq: true }).label, 'HAP Q')
	assert.deepStrictEqual(H.hapFormatFor({ alpha: true, hq: true }), {
		format: 'hap_alpha',
		label: 'HAP Alpha',
		downgraded: true,
	})
	// keep client and server in lock-step
	const server = require('../../src/media/hap-encode-args')
	for (const alpha of [false, true])
		for (const hq of [false, true]) {
			assert.strictEqual(H.hapFormatFor({ alpha, hq }).format, server.pickHapFormat({ alpha, hq }).format)
		}
})

test('on-air detection reads the playback matrix', () => {
	assert.strictEqual(H.isAnythingPlaying({}), false)
	assert.strictEqual(H.isAnythingPlaying({ playback: { matrix: { '1-10': { playing: false } } } }), false)
	assert.strictEqual(
		H.isAnythingPlaying({ playback: { matrix: { '1-10': { playing: false }, '2-10': { playing: true } } } }),
		true
	)
	assert.strictEqual(H.isAnythingPlaying({ playbackMatrix: { '1-10': { playing: true } } }), true)
})

test('modal warnings: D1 note, alpha-drop, skips, nothing-to-do, on-air', () => {
	const probe = [
		{ ok: true, hasAlpha: true },
		{ ok: true, hasAlpha: false },
		{ ok: false, reason: 'already HAP' },
	]
	assert.deepStrictEqual(
		H.hapModalWarnings({ alpha: false, hq: false, onAir: false, probe: null }),
		[],
		'defaults + no probe yet → silent'
	)
	assert.match(H.hapModalWarnings({ alpha: true, hq: true, onAir: false, probe: null })[0], /HAP Alpha/)
	const w = H.hapModalWarnings({ alpha: false, hq: false, onAir: true, probe })
	assert.ok(w.some((x) => /1 file has an alpha channel that will be dropped/.test(x)))
	assert.ok(w.some((x) => /1 file will be skipped/.test(x)))
	assert.ok(w.some((x) => /on-air/.test(x)))
	assert.ok(
		!H.hapModalWarnings({ alpha: true, hq: false, onAir: false, probe }).some((x) => /dropped/.test(x)),
		'alpha on → no drop warning'
	)
	assert.ok(
		H.hapModalWarnings({ alpha: false, hq: false, onAir: false, probe: [{ ok: false }] }).some((x) =>
			/Nothing to encode/.test(x)
		)
	)
})

const job = (over) => ({ jobId: 'j', format: 'hap_alpha', finished: false, counts: {}, items: [], ...over })

test('progress line counts only files that take time', () => {
	assert.strictEqual(H.hapProgressText([]), null)
	assert.strictEqual(H.hapProgressText([job({ finished: true })]), null)
	const items = [
		{ id: 'a', state: 'done', pct: 1 },
		{ id: 'b', state: 'running', pct: 0.43 },
		{ id: 'c', state: 'queued', pct: 0 },
		{ id: 'd', state: 'skipped', pct: 0 },
		{ id: 'e', state: 'queued', pct: 0 },
	]
	assert.strictEqual(H.hapProgressText([job({ items })]), 'Encoding HAP Alpha 2/4 · 43%')
	assert.strictEqual(
		H.hapProgressText([job({ format: 'hap', items: [{ id: 'a', state: 'queued', pct: 0 }] })]),
		'Encoding HAP 1/1'
	)
})

test('finished summary: severity and the first failure reason', () => {
	const ok = H.hapFinishedSummary(
		job({
			finished: true,
			counts: { done: 2, skipped: 1 },
			items: [
				{ id: 'a', state: 'done' },
				{ id: 'b', state: 'done', note: 'resized 70×50 → 72×52' },
				{ id: 'c', state: 'skipped', reason: 'already HAP' },
			],
		})
	)
	assert.deepStrictEqual([ok.kind, ok.text], ['ok', 'HAP: 2 encoded, 1 skipped, 1 resized to a multiple of 4'])
	const bad = H.hapFinishedSummary(
		job({
			finished: true,
			counts: { done: 1, failed: 1 },
			items: [{ id: 'x.mov', state: 'failed', reason: 'not enough disk space' }],
		})
	)
	assert.strictEqual(bad.kind, 'error')
	assert.match(bad.text, /1 failed — x\.mov: not enough disk space/)
	const nothing = H.hapFinishedSummary(
		job({ finished: true, counts: { skipped: 1 }, items: [{ id: 'h', state: 'skipped', reason: 'already HAP' }] })
	)
	assert.deepStrictEqual([nothing.kind, nothing.text], ['info', 'HAP: 1 skipped (already HAP)'])
})

test('wiring pins: button, cancel, defaults off, ws event, API paths', () => {
	const shell = read('client/components/sources-panel-shell.js')
	assert.match(shell, /id="sources-hap-selected"[^>]*>Encode to HAP…</)
	assert.match(shell, /id="sources-hap-cancel"/)
	assert.match(shell, /hapBtn: root\.querySelector\('#sources-hap-selected'\)/)
	const panel = read('client/components/sources-panel.js')
	assert.match(panel, /hapBtn\.onclick = \(\) => void hapEncode\.run\(\)/)
	assert.match(panel, /createHapEncode\(\{[\s\S]*?selectedMedia[\s\S]*?\}\)/)
	const modal = read('client/components/media-hap-encode-modal.js')
	assert.match(modal, /<input type="checkbox" id="hap-alpha" \/>/, 'alpha toggle present and NOT pre-checked')
	assert.match(modal, /<input type="checkbox" id="hap-hq" \/>/, 'HQ toggle present and NOT pre-checked')
	assert.ok(!/checked\s*=\s*true|\schecked[\s>=]/.test(modal.replace(/\.checked/g, '')), 'no toggle may default on')
	assert.ok(!/localStorage|sessionStorage/.test(modal), 'toggle state is deliberately not remembered')
	const ctl = read('client/components/sources-panel-hap-encode.js')
	assert.match(ctl, /wsClient\.on\('media:hap-encode'/)
	const ops = read('client/lib/media-file-ops.js')
	for (const p of ['/api/media/hap-encode', '/api/media/hap-encode/probe', '/api/media/hap-encode/cancel'])
		assert.ok(ops.includes(`'${p}'`), p)
	assert.ok(
		read('src/media/hap-encode-queue.js').includes("'media:hap-encode'"),
		'client and server agree on the ws event name'
	)
})

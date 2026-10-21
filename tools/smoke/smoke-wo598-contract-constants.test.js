'use strict'

/**
 * WO-598 C4 — GET /api/contract/constants is built from the server modules that own the layer bands, and every
 * compile-time copy in the web client, the Godot client and src/ itself must equal it. A band change in src/
 * fails here until each copy below is updated (or deleted in favour of the endpoint).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { contractConstants, register } = require('../../src/api/routes-contract')

const ROOT = path.join(__dirname, '../..')
const L = contractConstants().layers

/** [file, constant name, expected value]. JS: `const NAME = n`; GDScript: `const NAME := n`. */
const COPIES = [
	['client/lib/pip-overlay-registry.js', 'PIP_OVERLAY_BAND_BASE', L.pipOverlay.base],
	['client/lib/pip-overlay-registry.js', 'PIP_OVERLAY_MAX_STACK', L.pipOverlay.maxStack],
	['client/lib/pip-overlay-registry.js', 'LOOK_LAYER_MIN', L.look.min],
	['client/lib/pip-overlay-registry.js', 'LOOK_LAYER_MAX', L.look.max],
	['client/lib/pip-overlay-registry.js', 'BANK_B_OFFSET', L.bankBOffset],
	['client/lib/scene-state-helpers.js', 'LOOK_LAYER_FIRST', L.look.min],
	['client/lib/scene-state-helpers.js', 'LOOK_LAYER_MAX', L.look.max],
	['client/lib/scenes-preview-look-stack.js', 'TIMELINE_LAYER_BASE', L.timeline.base],
	['client/lib/scenes-preview-look-stack.js', 'PREVIEW_SCENE_LAYER_MIN', L.look.min],
	['client/lib/scenes-preview-edit-chrome.js', 'EDIT_CHROME_LAYER', L.editChrome],
	['client/lib/scenes-preview-global-border.js', 'GB_LAYER_PGM_A', L.globalBorder.pgmA],
	['client/lib/scenes-preview-global-border.js', 'GB_LAYER_PGM_B', L.globalBorder.pgmB],
	['client/lib/scenes-preview-global-border.js', 'GB_LAYER_PRV_MIRROR', L.globalBorder.prvMirror],
	['client/lib/live-audio-inputs.js', 'LIVE_AUDIO_LAYER_BASE', L.liveAudioInput],
	['client/lib/input-channels.js', 'LIVE_AUDIO_INPUT_LAYER', L.liveAudioInput],
	['client/lib/audio-mixer-rows.js', 'AUDIO_ONLY_LOOK_LAYER', L.audioOnlyLook],
	['src/config/routing-map.js', 'LIVE_AUDIO_INPUT_LAYER', L.liveAudioInput],
	['godot/client/features/audio/audio_rows.gd', 'TIMELINE_LAYER_BASE', L.timeline.base],
	['godot/client/features/audio/audio_rows.gd', 'AUDIO_ONLY_LOOK_LAYER', L.audioOnlyLook],
	['godot/client/features/audio/audio_rows.gd', 'LIVE_AUDIO_LAYER_BASE', L.liveAudioInput],
	['godot/client/features/multiview/mv_layout.gd', 'LIVE_AUDIO_INPUT_LAYER', L.liveAudioInput],
	['godot/client/features/live/pgm_timer_model.gd', 'BORDER_LAYER', L.globalBorder.pgmA],
]

function readConst(file, name) {
	const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
	const m = new RegExp(`\\bconst ${name}\\s*:?=\\s*(\\d+)\\b`).exec(src)
	return m ? Number(m[1]) : undefined
}

test('the document: bands are ordered and never overlap', () => {
	assert.equal(contractConstants().version, 1)
	assert.ok(L.pgmAudioTrackMax < L.look.min && L.look.max < L.bankBOffset + L.pgmAudioTrackMax + 1)
	assert.ok(L.look.max + L.bankBOffset < L.audioOnlyLook && L.audioOnlyLook < L.timeline.base)
	assert.ok(L.timeline.base + L.timeline.maxCount <= L.pipOverlay.base)
	assert.ok(L.pipOverlay.max < L.editChrome && L.editChrome < L.globalBorder.pgmB && L.globalBorder.pgmA < L.hardMax)
	assert.deepEqual([L.globalBorder.pgmB, L.globalBorder.prvMirror, L.globalBorder.pgmA], [996, 997, 998])
	assert.ok(L.shaderStack.min >= L.look.min && L.shaderStack.max <= L.look.max)
	assert.ok(L.multiview.bg < L.multiview.cellStart)
})

test('every client / src copy equals the contract', () => {
	const drift = COPIES.map(([f, n, want]) => [f, n, want, readConst(f, n)]).filter(([, , want, got]) => got !== want)
	assert.deepEqual(drift.map(([f, n, want, got]) => `${f} ${n}=${got} (contract ${want})`), [])
})

test('the reader catches a drifted or missing copy', () => {
	assert.equal(readConst('godot/client/features/live/pgm_timer_model.gd', 'BORDER_LAYER'), 998)
	assert.equal(readConst('client/lib/pip-overlay-registry.js', 'NO_SUCH_CONST'), undefined)
})

test('GET /api/contract/constants serves the document without Caspar', () => {
	const h = {}
	register({ get: (p, fn, opts) => (h[p] = { fn, opts }) })
	const r = h['/api/contract/constants']
	assert.equal(r.opts.requireCaspar, false)
	const res = r.fn({})
	assert.equal(res.status, 200)
	assert.deepEqual(JSON.parse(res.body), contractConstants())
	const router = fs.readFileSync(path.join(ROOT, 'src/api/router.js'), 'utf8')
	assert.match(router, /require\('\.\/routes-contract'\)\.register\(routes\)/)
})

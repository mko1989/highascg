'use strict'

/**
 * Offline smoke — WO-326: look-layer W/H inspector edits must reach air, aspect lock must
 * actually unlock (2026-07-24).
 *
 * Two verified client bugs:
 * 1. `flushPreviewPush` (the inspector-edit flush path) never armed the mixer nudge. In
 *    edit-on-PGM mode, geometry-only edits early-return in pushEditsToPgmLive ("the PGM
 *    nudge owns it") — so inspector W/H edits reached NOTHING on air. Drags worked only
 *    because schedulePreviewPush arms the nudge.
 * 2. The W/H input handlers in inspector-fill.js read `layer.aspectLocked` from a STALE
 *    captured layer object and cosmetically paired the other input from it — after
 *    unlocking, the UI kept showing locked-aspect numbers the model never had.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

describe('WO-326 inspector geometry edits reach air', () => {
	it('flushPreviewPush arms the mixer nudge (inspector path)', () => {
		const src = read('client/components/scenes-preview-runtime.js')
		const fn = src.slice(src.indexOf('function flushPreviewPush'), src.indexOf('function scheduleFlushPreviewFromInspector'))
		assert.match(fn, /scheduleMixerNudge\(\)/, 'inspector flush must schedule the nudge — edit-on-PGM geometry rides ONLY the nudge')
	})

	it('schedulePreviewPush still arms the nudge (drag path unchanged)', () => {
		const src = read('client/components/scenes-preview-runtime.js')
		const fn = src.slice(src.indexOf('function schedulePreviewPush'), src.indexOf('function flushPreviewPush'))
		assert.match(fn, /scheduleMixerNudge\(\)/)
	})
})

describe('WO-326 aspect lock honesty', () => {
	it('W/H handlers no longer pair from the stale captured layer', () => {
		const src = read('client/components/inspector-fill.js')
		const wh = src.slice(src.indexOf("label: 'Width'"), src.indexOf('fillGrp.appendChild(xInp.wrap)'))
		assert.doesNotMatch(wh, /layer\.aspectLocked/, 'handlers must not read the stale captured layer (WO-326 regression)')
		assert.match(wh, /syncGeometryInputsFromLayer\(\)/, 'inputs must resync from the model after a patch')
	})

	it('aspect pairing lives in patchFillPx with a FRESH layer read', () => {
		const src = read('client/components/inspector-scene-layer.js')
		const fn = src.slice(src.indexOf('function patchFillPx'), src.indexOf('function patchFillAlign'))
		assert.match(fn, /const sc = sceneState\.getScene\(sceneId\)/, 'patchFillPx must read fresh scene state')
		assert.match(fn, /L\.aspectLocked !== false/, 'lock check must use the fresh layer')
	})
})

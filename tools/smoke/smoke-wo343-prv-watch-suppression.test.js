'use strict'

/**
 * WO-343 smoke — the look editor's live-PRV watch mode had NO test, for a feature that was
 * already shipped and reverted once (`9cc305a`): X SHAPE input is input∩bounding, so a click
 * inside an open punch-hole falls through to the input-dead consumer and never reaches the GUI
 * ([[operator-gui-holes-click-dead]]). The suppression state machine is what keeps that from
 * happening again, so it is pinned behaviourally here, not just by source text.
 *
 * The design-2 contract (`ba8970f`):
 *   press on a preview surface  → holes BLANK immediately (the press must never race an open hole)
 *   still held after 150 ms     → holes RE-OPEN (the X implicit pointer grab keeps delivering
 *                                 motion/release to Firefox, so the operator sees real video
 *                                 through the drag)
 *   release / cancel            → back to normal, and a fresh press blanks again
 *   modal open                  → blank regardless of any of the above
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

/** Minimal DOM the detector needs: capture-phase document listeners + querySelector. */
function installDom() {
	const listeners = new Map()
	let modalPresent = false

	const doc = {
		body: {},
		addEventListener(type, fn) {
			if (!listeners.has(type)) listeners.set(type, new Set())
			listeners.get(type).add(fn)
		},
		removeEventListener(type, fn) {
			listeners.get(type)?.delete(fn)
		},
		querySelector(sel) {
			return sel === '.modal-overlay' && modalPresent ? {} : null
		},
	}

	globalThis.document = doc
	globalThis.MutationObserver = class {
		constructor(cb) {
			this.cb = cb
			installDom.lastObserver = this
		}
		observe() {}
		disconnect() {}
	}
	globalThis.localStorage = { getItem: () => null, setItem: () => {} }
	globalThis.location = { search: '?operatorGui=1', protocol: 'http:', port: '4200', host: 'x', origin: 'http://x' }
	globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })

	return {
		fire(type, target) {
			for (const fn of listeners.get(type) || []) fn({ target })
		},
		setModal(v) {
			modalPresent = v
			installDom.lastObserver?.cb?.([])
		},
	}
}

/** A target inside a preview surface, per PREVIEW_SURFACE_SELECTOR. */
const inPreview = { closest: (sel) => (/preview-panel__compose-cell/.test(sel) ? {} : null) }
/** A target outside every preview surface (the layer strip, inspector, toolbar…). */
const outsidePreview = { closest: () => null }

/* Two timers gate the observable state: the reopen latch (DRAG_REOPEN_MS = 150 in the detector)
 * and the report layer's RESTORE_DEBOUNCE_MS = 300 before holes are actually handed back. Blanking
 * is immediate in both directions of "suppress"; only UN-suppressing is debounced. */
const REOPEN_MS = 150
const RESTORE_MS = 300
const settle = (ms) => new Promise((r) => setTimeout(r, ms))
const sleepReopenAndRestore = () => settle(REOPEN_MS + RESTORE_MS + 120)
const sleepRestore = () => settle(RESTORE_MS + 120)

test('WO-343 PRV watch-mode suppression state machine', async (t) => {
	const dom = installDom()
	const suppress = await import('../../client/lib/operator-gui-interaction-suppress.js')
	const report = await import('../../client/lib/operator-gui-mode-report.js')

	suppress.initOperatorGuiInteractionSuppress()
	assert.equal(report.isInteractionSuppressed(), false, 'idle must not suppress')

	await t.test('press on a preview surface blanks the holes immediately', () => {
		dom.fire('pointerdown', inPreview)
		assert.equal(report.isInteractionSuppressed(), true)
	})

	await t.test('holding the drag RE-OPENS the holes (design 2 — real video through the drag)', async () => {
		await sleepReopenAndRestore()
		assert.equal(report.isInteractionSuppressed(), false, 'the operator must see video mid-drag')
	})

	await t.test('release returns to idle and a fresh press blanks again', async () => {
		dom.fire('pointerup', inPreview)
		assert.equal(report.isInteractionSuppressed(), false)
		dom.fire('pointerdown', inPreview)
		assert.equal(report.isInteractionSuppressed(), true, 'the reopen latch must not survive the previous drag')
		dom.fire('pointerup', inPreview)
		await sleepRestore()
	})

	await t.test('a short click never leaves the holes reopened', async () => {
		dom.fire('pointerdown', inPreview)
		dom.fire('pointerup', inPreview)
		await sleepReopenAndRestore() // the reopen timer must not fire after the release
		assert.equal(report.isInteractionSuppressed(), false)
	})

	await t.test('presses outside a preview surface are ignored (GUI chrome stays live)', () => {
		dom.fire('pointerdown', outsidePreview)
		assert.equal(report.isInteractionSuppressed(), false)
		dom.fire('pointerup', outsidePreview)
	})

	await t.test('a modal blanks regardless, and outlives a drag reopen', async () => {
		dom.setModal(true)
		assert.equal(report.isInteractionSuppressed(), true)
		dom.fire('pointerdown', inPreview)
		await sleepReopenAndRestore()
		assert.equal(report.isInteractionSuppressed(), true, 'a modal must never be uncovered by the reopen timer')
		dom.fire('pointerup', inPreview)
		dom.setModal(false)
		await sleepRestore()
		assert.equal(report.isInteractionSuppressed(), false)
	})

	await t.test('an HTML5 drag suppresses for its whole duration (drop targets under holes)', async () => {
		dom.fire('dragstart', outsidePreview)
		assert.equal(report.isInteractionSuppressed(), true)
		dom.fire('dragend', outsidePreview)
		await sleepRestore()
		assert.equal(report.isInteractionSuppressed(), false)
	})

	suppress.stopOperatorGuiInteractionSuppress()
})

test('WO-343 the watch-mode contract is documented where it can be broken', () => {
	const fs = require('node:fs')
	const path = require('node:path')
	const root = path.join(__dirname, '..', '..')
	const src = fs.readFileSync(path.join(root, 'client/lib/operator-gui-interaction-suppress.js'), 'utf8')

	// The reopen must remain conditional on the button still being down — that is the whole
	// reason it is safe (X keeps delivering to Firefox only while the implicit grab is held).
	assert.ok(/if \(_pointerDown\) \{\s*\n\s*_dragReopened = true/.test(src))
	assert.ok(/const DRAG_REOPEN_MS = \d+/.test(src), 'the revert knob the WO names must stay findable')

	const editor = fs.readFileSync(path.join(root, 'client/components/scenes-editor-edit.js'), 'utf8')
	assert.ok(/WO-343/.test(editor), 'the PRV toggle must stay attributed to its WO')
})

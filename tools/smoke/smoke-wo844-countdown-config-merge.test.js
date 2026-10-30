'use strict'

/**
 * WO-844: countdown inspector — an edit must MERGE into the stored config, not replace it with the 17 rendered keys.
 * Before: Position px (posX/posY, WO-320A) never persisted and a font/border set elsewhere on the timer instance was
 * wiped by the next edit.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

// Browser stubs for modules that probe the DOM / storage at import time.
global.document = global.document || { dispatchEvent() {}, getElementById() { return null }, querySelector() { return null }, addEventListener() {} }
global.CustomEvent = global.CustomEvent || class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail } }

function fakeGrp(values) {
	return {
		querySelector(sel) {
			const v = values[sel]
			return v === undefined ? null : v
		},
	}
}

async function load() {
	const { pathToFileURL } = require('node:url')
	const path = require('node:path')
	const { sceneState } = await import(pathToFileURL(path.join(__dirname, '../../client/lib/scene-state.js')))
	const { createCountdownFieldController } = await import(
		pathToFileURL(path.join(__dirname, '../../client/components/inspector-countdown-controller.js'))
	)
	return { sceneState, createCountdownFieldController }
}

test('WO-844: Position px persists and survives later edits; timer font/border are not wiped', async () => {
	const { sceneState, createCountdownFieldController } = await load()
	sceneState._save = () => {}
	sceneState._softSave = () => {}
	sceneState._persist = () => {}
	const sceneId = sceneState.addScene('L')
	sceneState.addLayer(sceneId)
	const scene = sceneState.getScene(sceneId)
	const cfg = { mode: 'duration', durationSec: 300, position: 'center', timerFontSize: 15, auxFontSize: 5 }
	sceneState.patchLayer(sceneId, 0, { source: { type: 'countdown', countdownConfig: { ...cfg } } })
	const timer = sceneState.createTimer(scene.layers[0], 0)
	timer.config = { ...timer.config, timerFontFamily: 'Impact', timerBorderWidth: 3, timerBorderColor: '#ff0000' }

	const grp = fakeGrp({ '#cd-timer-size': { value: '20' }, '#cd-position': { value: 'center' } })
	const ctl = createCountdownFieldController({
		grp, cfg, modeSelect: { value: 'duration' }, sceneId, layerIndex: 0, layer: scene.layers[0],
		src: scene.layers[0].source, stateStore: null, timerId: timer.id,
	})

	ctl.onFieldChange({ posX: 120, posY: 80 })
	ctl.clearPendingCgUpdate()
	let stored = sceneState.getScene(sceneId).layers[0].source.countdownConfig
	assert.equal(stored.posX, 120, 'posX persisted on the layer')
	assert.equal(stored.posY, 80, 'posY persisted on the layer')
	assert.equal(stored.timerFontFamily, 'Impact', 'timer-instance font carried into the layer config')
	assert.equal(sceneState.getTimer(timer.id).config.posX, 120, 'posX reaches the timer instance')
	assert.equal(sceneState.getTimer(timer.id).config.timerFontFamily, 'Impact', 'timer font not wiped')
	assert.equal(sceneState.getScene(sceneId).layers[0].cgData.posX, 120, 'posX reaches cgData (the CG ADD/UPDATE payload)')

	// A later, unrelated edit must keep posX/posY and the font.
	ctl.onFieldChange({ timerFontSize: 20 })
	ctl.clearPendingCgUpdate()
	stored = sceneState.getScene(sceneId).layers[0].source.countdownConfig
	assert.equal(stored.timerFontSize, 20)
	assert.equal(stored.posX, 120, 'posX survives an unrelated edit')
	assert.equal(stored.timerBorderColor, '#ff0000', 'border survives')
	assert.equal(sceneState.getTimer(timer.id).config.timerFontFamily, 'Impact')

	// Clearing the px override (empty = preset) is a real edit and must win over the stored value.
	ctl.onFieldChange({ posX: '', posY: '' })
	ctl.clearPendingCgUpdate()
	stored = sceneState.getScene(sceneId).layers[0].source.countdownConfig
	assert.equal(stored.posX, '')
})

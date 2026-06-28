'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	applyLogsPaneVisibility,
	setLogsToggleStyles,
} = require('../../client/lib/logs-modal-shared.js')

function mockEl() {
	const classes = new Set()
	return {
		hidden: false,
		classList: {
			toggle(cls, on) {
				if (on) classes.add(cls)
				else classes.delete(cls)
			},
			has(cls) {
				return classes.has(cls)
			},
		},
	}
}

function mockToggleButton() {
	const attrs = {}
	return {
		classList: { toggle() {} },
		setAttribute(name, value) {
			attrs[name] = value
		},
		getAttribute(name) {
			return attrs[name]
		},
	}
}

test('applyLogsPaneVisibility sets hidden and empty state', () => {
	const paneHigh = mockEl()
	const paneCaspar = mockEl()
	const panesEmpty = mockEl()
	const panesEl = mockEl()
	const filtersEl = mockEl()

	applyLogsPaneVisibility({
		paneHigh,
		paneCaspar,
		panesEmpty,
		panesEl,
		filtersEl,
		highOn: true,
		casparOn: false,
	})
	assert.equal(paneHigh.hidden, false)
	assert.equal(paneCaspar.hidden, true)
	assert.equal(panesEmpty.hidden, true)
	assert.equal(filtersEl.hidden, false)
	assert.ok(panesEl.classList.has('logs-modal__panes--single'))

	applyLogsPaneVisibility({
		paneHigh,
		paneCaspar,
		panesEmpty,
		panesEl,
		filtersEl,
		highOn: false,
		casparOn: false,
	})
	assert.equal(paneHigh.hidden, true)
	assert.equal(paneCaspar.hidden, true)
	assert.equal(panesEmpty.hidden, false)
	assert.equal(filtersEl.hidden, true)
})

test('setLogsToggleStyles sets aria-pressed', () => {
	const high = mockToggleButton()
	const caspar = mockToggleButton()
	const modal = {
		querySelector(sel) {
			if (sel === '#logs-toggle-highascg') return high
			if (sel === '#logs-toggle-caspar') return caspar
			return null
		},
	}
	setLogsToggleStyles(modal, true, false)
	assert.equal(high.getAttribute('aria-pressed'), 'true')
	assert.equal(caspar.getAttribute('aria-pressed'), 'false')
})

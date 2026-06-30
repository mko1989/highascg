'use strict'

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const {
	isModifierKeysym,
	keysymToModifierName,
	normalizeModifierList,
	resetKeyboardModifierState,
} = require('../../src/system/cef-interactive-cdp')

describe('cef-interactive-keyboard modifiers', () => {
	beforeEach(() => {
		resetKeyboardModifierState()
	})

	it('detects modifier keysyms', () => {
		assert.equal(isModifierKeysym(65507), true)
		assert.equal(isModifierKeysym(65505), true)
		assert.equal(isModifierKeysym(97), false)
	})

	it('maps keysym to modifier name', () => {
		assert.equal(keysymToModifierName(65507), 'Control')
		assert.equal(keysymToModifierName(65513), 'Meta')
	})

	it('normalizeModifierList accepts Ctrl/Cmd aliases', () => {
		assert.deepEqual(normalizeModifierList(['Ctrl', 'Shift']), ['Control', 'Shift'])
		assert.deepEqual(normalizeModifierList(['Cmd', 'Alt']), ['Alt', 'Meta'])
	})

	it('normalizeModifierList preserves stable order', () => {
		assert.deepEqual(normalizeModifierList(['Shift', 'Control', 'Meta']), ['Control', 'Shift', 'Meta'])
	})
})

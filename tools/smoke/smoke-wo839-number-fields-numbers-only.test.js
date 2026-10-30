'use strict'
/**
 * WO-839 (RULES.md "Input fields" 3): number fields take only numbers. A commit gives the correct value (a number or a
 * complete maths expression, clamped / rounded) or the PREVIOUS value — gibberish is never salvaged ("100+", "12abc",
 * "42px", "1920/0", "" all revert). Web side: client/lib/math-input.js (parse + commit + the DOM wiring, against a tiny
 * fake DOM). The Godot twin is godot/client/tests/test_numeric_field.gd / test_wo839_number_fields.gd.
 */
const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const GIBBERISH = ['1.2.3', '100+', '1920/', '12abc', '42px', '1920/0', '', '  ', 'abc', '--', '(5', '5)', '1e3', '1,5', '$5']

/** The minimum of an <input> that attachMathInput / createMathInput touch. */
function fakeInput(value, attrs = {}) {
	const handlers = {}
	return {
		value: String(value),
		type: 'number',
		_attrs: attrs,
		getAttribute(n) { return n in attrs ? attrs[n] : null },
		setAttribute(n, v) { attrs[n] = v },
		addEventListener(t, f) { (handlers[t] ||= []).push(f) },
		removeEventListener() {},
		dispatchEvent(ev) { for (const f of handlers[ev.type] || []) f(ev); return true },
		fire(t, extra = {}) { const ev = { type: t, target: this, ...extra }; for (const f of handlers[t] || []) f(ev); return ev },
		blur() { this.fire('blur') },
	}
}

let M
before(async () => {
	const docHandlers = {}
	globalThis.document = {
		addEventListener(t, f) { (docHandlers[t] ||= []).push(f) },
		_fire(t, ev) { for (const f of docHandlers[t] || []) f(ev) },
	}
	globalThis.Event = class { constructor(type) { this.type = type } }
	M = await import(pathToFileURL(path.join(__dirname, '..', '..', 'client', 'lib', 'math-input.js')).href)
})

describe('WO-839 — parseNumberInput / computeMathCommit', () => {
	it('gibberish falls back, valid input evaluates', () => {
		for (const bad of GIBBERISH) assert.ok(Number.isNaN(M.parseNumberInput(bad)), `'${bad}'`)
		assert.equal(M.parseNumberInput('1920/2'), 960)
		assert.equal(M.parseNumberInput('3840-64'), 3776)
	})
	it('computeMathCommit: gibberish restores lastGood, never a salvaged prefix', () => {
		for (const bad of GIBBERISH) {
			const r = M.computeMathCommit(bad, { min: 0, max: 10000, decimals: 0, lastGood: 77 })
			assert.equal(r.value, 77, `'${bad}'`)
			assert.equal(r.text, '77')
			assert.equal(r.restored, true)
		}
		const ok = M.computeMathCommit('99999', { min: 0, max: 10000, decimals: 0, lastGood: 77 })
		assert.equal(ok.value, 10000, 'valid input is still clamped')
	})
})

describe('WO-839 — attachMathInput', () => {
	it('commit via change: expression evaluates, gibberish reverts to the on-screen value', () => {
		const el = fakeInput('1920')
		M.attachMathInput(el, { decimals: 0, min: 1, max: 8000 })
		el.fire('focus')
		el.value = '3840/2'
		globalThis.document._fire('change', { target: el })
		assert.equal(el.value, '1920')
		el.value = '100+'
		globalThis.document._fire('change', { target: el })
		assert.equal(el.value, '1920', '"100+" reverts, not 100')
		el.value = '42px'
		globalThis.document._fire('change', { target: el })
		assert.equal(el.value, '1920', '"42px" reverts, not 42')
		el.value = ''
		globalThis.document._fire('change', { target: el })
		assert.equal(el.value, '1920', 'blank reverts')
		el.value = '1920/0'
		globalThis.document._fire('change', { target: el })
		assert.equal(el.value, '1920', 'division by zero reverts')
		el.value = '999999'
		globalThis.document._fire('change', { target: el })
		assert.equal(el.value, '8000', 'clamped')
	})

	it('blur commits the same way', () => {
		const el = fakeInput('25')
		M.attachMathInput(el, { decimals: 0, min: 1, max: 60 })
		el.fire('focus')
		el.value = '12abc'
		el.blur()
		assert.equal(el.value, '25')
	})

	it('allowBlank keeps an empty field empty (blank = preset), still reverts gibberish', () => {
		const el = fakeInput('', {})
		M.attachMathInput(el, { decimals: 0, allowBlank: true })
		assert.equal(el.value, '', 'a blank field is not filled in on attach')
		el.fire('focus')
		el.value = '640'
		el.blur()
		assert.equal(el.value, '640')
		el.fire('focus')
		el.value = ''
		el.blur()
		assert.equal(el.value, '', 'blank stays blank')
		el.fire('focus')
		el.value = 'x9'
		el.blur()
		assert.equal(el.value, '', 'gibberish reverts to what was on screen (blank)')
	})
})

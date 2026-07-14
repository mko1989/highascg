'use strict'

/**
 * WO-171 — Basic math in all GUI number inputs.
 * Covers the DOM-free surface of client/lib/math-input.js:
 *  - evaluateMath / parseNumberInput edge cases
 *  - computeMathCommit (the pure commit-decision logic behind attachMathInput's
 *    blur/Enter evaluate-clamp-restore behaviour)
 *  - inferDecimalsFromStep (derives display precision from a native `step` attribute)
 *
 * attachMathInput() itself wires DOM events (focus/blur/keydown + a shared capture-phase
 * `change` listener) and is intentionally not exercised here — there is no jsdom
 * dependency in this repo. See WO-171 work log for the manual QA checklist that covers
 * the DOM wiring in a real browser.
 *
 * Run: node --test tools/smoke/smoke-math-input.test.js
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	evaluateMath,
	parseNumberInput,
	computeMathCommit,
	inferDecimalsFromStep,
} = require('../../client/lib/math-input.js')

describe('WO-171 — evaluateMath', () => {
	it('evaluates basic arithmetic', () => {
		assert.equal(evaluateMath('1920-256'), 1664)
		assert.equal(evaluateMath('1920/2'), 960)
		assert.equal(evaluateMath('(960-10)*2'), 1900)
		assert.equal(evaluateMath('100+50'), 150)
		assert.equal(evaluateMath('  1920 - 256  '), 1664)
	})

	it('rejects anything outside the safe character whitelist', () => {
		assert.ok(Number.isNaN(evaluateMath('alert(1)')))
		assert.ok(Number.isNaN(evaluateMath('1;window.x=1')))
		assert.ok(Number.isNaN(evaluateMath('__proto__')))
		assert.ok(Number.isNaN(evaluateMath('1e10'))) // 'e' not in whitelist
		assert.ok(Number.isNaN(evaluateMath('new Function()')))
	})

	it('rejects empty/garbage/non-string input', () => {
		assert.ok(Number.isNaN(evaluateMath('')))
		assert.ok(Number.isNaN(evaluateMath('   ')))
		assert.ok(Number.isNaN(evaluateMath('abc')))
		assert.ok(Number.isNaN(evaluateMath(null)))
		assert.ok(Number.isNaN(evaluateMath(undefined)))
		assert.ok(Number.isNaN(evaluateMath(42)))
	})

	it('rejects incomplete expressions (mid-typing states)', () => {
		assert.ok(Number.isNaN(evaluateMath('1920-')))
		assert.ok(Number.isNaN(evaluateMath('(1920')))
		assert.ok(Number.isNaN(evaluateMath('--')))
	})

	it('rejects non-finite results', () => {
		assert.ok(Number.isNaN(evaluateMath('1/0')))
		assert.ok(Number.isNaN(evaluateMath('-1/0')))
	})
})

describe('WO-171 — parseNumberInput', () => {
	it('tries math first, then falls back to plain parseFloat', () => {
		assert.equal(parseNumberInput('1920-256'), 1664)
		assert.equal(parseNumberInput('42'), 42)
		assert.equal(parseNumberInput('3.5'), 3.5)
		assert.equal(parseNumberInput('42px'), 42) // plain parseFloat tail-tolerant
	})

	it('uses the fallback for empty/unparseable input', () => {
		assert.equal(parseNumberInput('', 7), 7)
		assert.equal(parseNumberInput(null, 7), 7)
		assert.equal(parseNumberInput(undefined, 7), 7)
		assert.equal(parseNumberInput('abc', 7), 7)
		assert.ok(Number.isNaN(parseNumberInput('abc')))
	})
})

describe('WO-171 — inferDecimalsFromStep', () => {
	it('returns 0 for integer steps (including the default of 1)', () => {
		assert.equal(inferDecimalsFromStep('1'), 0)
		assert.equal(inferDecimalsFromStep(1), 0)
		assert.equal(inferDecimalsFromStep('5'), 0)
	})

	it('counts fractional digits for decimal steps', () => {
		assert.equal(inferDecimalsFromStep('0.1'), 1)
		assert.equal(inferDecimalsFromStep('0.01'), 2)
		assert.equal(inferDecimalsFromStep('0.5'), 1)
	})

	it('returns null when no fixed formatting should be forced', () => {
		assert.equal(inferDecimalsFromStep(null), null)
		assert.equal(inferDecimalsFromStep(undefined), null)
		assert.equal(inferDecimalsFromStep(''), null)
		assert.equal(inferDecimalsFromStep('any'), null)
		assert.equal(inferDecimalsFromStep('not-a-number'), null)
	})
})

describe('WO-171 — computeMathCommit (attachMathInput commit-decision logic)', () => {
	it('evaluates a math expression and formats to the requested decimals', () => {
		const r = computeMathCommit('1920-256', { min: 0, max: 1920, decimals: 0 })
		assert.equal(r.value, 1664)
		assert.equal(r.text, '1664')
		assert.equal(r.restored, false)
	})

	it('clamps the evaluated result to min/max', () => {
		const low = computeMathCommit('10-20', { min: 0, max: 100, decimals: 0 })
		assert.equal(low.value, 0)
		const high = computeMathCommit('1920*4', { min: 0, max: 1920, decimals: 0 })
		assert.equal(high.value, 1920)
	})

	it('restores lastGood on garbage input instead of committing NaN', () => {
		const r = computeMathCommit('nonsense', { min: 0, max: 100, decimals: 0, lastGood: 42 })
		assert.equal(r.value, 42)
		assert.equal(r.text, '42')
		assert.equal(r.restored, true)
	})

	it('restores lastGood on an incomplete/mid-typing expression that parseFloat also can\'t salvage', () => {
		// '1920-' still parseFloat()s to 1920 (trailing operator is just dropped), which is
		// reasonable graceful-degradation, not "garbage" — use an expression that is
		// unparseable by both evaluateMath and the parseFloat fallback.
		const r = computeMathCommit('(1920', { min: 0, max: 1920, decimals: 0, lastGood: 500 })
		assert.equal(r.value, 500)
		assert.equal(r.restored, true)
	})

	it('treats empty input as garbage too', () => {
		const r = computeMathCommit('', { min: 0, max: 100, decimals: 0, lastGood: 7 })
		assert.equal(r.value, 7)
		assert.equal(r.restored, true)
	})

	it('falls back to min (then max, then 0) when there is no lastGood yet', () => {
		assert.equal(computeMathCommit('garbage', { min: 10, max: 100 }).value, 10)
		assert.equal(computeMathCommit('garbage', { max: 100 }).value, 100)
		assert.equal(computeMathCommit('garbage', {}).value, 0)
	})

	it('formats with decimals when requested, else plain String()', () => {
		assert.equal(computeMathCommit('1/3', { decimals: 2 }).text, '0.33')
		assert.equal(computeMathCommit('2.5', { decimals: null }).text, '2.5')
	})

	it('matches the WO-171 example: crop right 1920-256 -> 1664', () => {
		const r = computeMathCommit('1920-256', { min: 0, max: 1920, decimals: 0 })
		assert.equal(r.value, 1664)
		assert.equal(r.text, '1664')
	})
})

describe('WO-200 — evaluateMath (recursive descent parser, CSP-safe)', () => {
	it('evaluates complex expressions with operator precedence', () => {
		// Multiplication and division bind tighter than addition/subtraction
		assert.equal(evaluateMath('2+3*4'), 14)
		assert.equal(evaluateMath('(2+3)*4'), 20)
		assert.equal(evaluateMath('10-2*3'), 4)
	})

	it('evaluates unary operators correctly', () => {
		assert.equal(evaluateMath('-5+3'), -2)
		assert.equal(evaluateMath('2*-3'), -6)
		assert.equal(evaluateMath('+5'), 5)
		assert.equal(evaluateMath('-(2+3)'), -5)
	})

	it('handles division by zero as non-finite result → NaN', () => {
		assert.ok(Number.isNaN(evaluateMath('1/0')))
		assert.ok(Number.isNaN(evaluateMath('-1/0')))
		assert.ok(Number.isNaN(evaluateMath('0/0')))
	})

	it('rejects exponentiation (** operator contains invalid char)', () => {
		// The whitelist [\d\s+\-*/.()]+$ does not include * twice in a row,
		// so 2**3 fails the regex check before parsing
		assert.ok(Number.isNaN(evaluateMath('2**3')))
	})

	it('rejects scientific notation (e is not in the whitelist)', () => {
		// The original whitelist only allows [\d\s+\-*/.()] — no 'e'.
		// This behavior is preserved for CSP compliance.
		assert.ok(Number.isNaN(evaluateMath('1e3')))
		assert.ok(Number.isNaN(evaluateMath('1.5e2')))
		assert.ok(Number.isNaN(evaluateMath('2E3')))
	})

	it('evaluates deeply nested parentheses', () => {
		assert.equal(evaluateMath('((((5))))'), 5)
		assert.equal(evaluateMath('((1+2)*(3+4))'), 21)
		assert.equal(evaluateMath('(((1920-256)/2))'), 832)
	})

	it('handles trailing operators as incomplete expressions', () => {
		// An operator at the end with no right operand is incomplete
		assert.ok(Number.isNaN(evaluateMath('1920*')))
		assert.ok(Number.isNaN(evaluateMath('100+')))
		assert.ok(Number.isNaN(evaluateMath('(1920-')))
	})

	it('handles mismatched parentheses', () => {
		assert.ok(Number.isNaN(evaluateMath('((1920')))
		assert.ok(Number.isNaN(evaluateMath('1920))')))
		assert.ok(Number.isNaN(evaluateMath('(1+2)))')))
	})

	it('preserves decimal precision through operations', () => {
		assert.equal(evaluateMath('0.1+0.2'), 0.30000000000000004) // IEEE 754 artifact
		assert.equal(evaluateMath('2.5*4'), 10)
		assert.equal(evaluateMath('10/3'), 10 / 3)
	})
})

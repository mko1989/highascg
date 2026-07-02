'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

// Node smoke — dom-escape is ESM; duplicate core logic contract via dynamic import.
test('escapeHtml neutralizes script injection', async () => {
	const { escapeHtml, escapeAttr, html } = await import('../../client/lib/dom-escape.js')
	const evil = '<img src=x onerror=alert(1)>'
	assert.equal(escapeHtml(evil), '&lt;img src=x onerror=alert(1)&gt;')
	assert.equal(escapeAttr('" onclick="alert(1)'), '&quot; onclick=&quot;alert(1)')
	assert.equal(html`<b>${evil}</b>`, '<b>&lt;img src=x onerror=alert(1)&gt;</b>')
})

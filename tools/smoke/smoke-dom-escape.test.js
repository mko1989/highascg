'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

test('escapeHtml neutralizes script injection', async () => {
	const { escapeHtml, escapeAttr, html } = await import('../../client/lib/dom-escape.js')
	const evil = '<img src=x onerror=alert(1)>'
	assert.equal(escapeHtml(evil), '&lt;img src=x onerror=alert(1)&gt;')
	assert.equal(escapeAttr('" onclick="alert(1)'), '&quot; onclick=&quot;alert(1)')
	assert.equal(html`<b>${evil}</b>`, '<b>&lt;img src=x onerror=alert(1)&gt;</b>')
})

test('escapeHtml neutralizes malicious media filename in playlist markup', async () => {
	const { escapeHtml, escapeAttr } = await import('../../client/lib/dom-escape.js')
	const filename = '<script>alert(1)</script>.mp4'
	const row = `<span title="${escapeAttr(filename)}">${escapeHtml(filename)}</span>`
	assert.ok(!row.includes('<script>'))
	assert.ok(row.includes('&lt;script&gt;'))
})

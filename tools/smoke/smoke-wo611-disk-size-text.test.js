'use strict'
/** WO-611 #7 — Settings → System listed every disk as "NaN GB": lsblk sizes are strings and went through the byte math. */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(
	path.join(__dirname, '..', '..', 'client', 'components', 'settings-modal-mount-hardware-summary.js'),
	'utf8'
)

test('formatBytes passes lsblk size text through', () => {
	const body = src.slice(src.indexOf('function formatBytes'), src.indexOf('export function renderHardwareSummary'))
	const formatBytes = new Function(`${body}; return formatBytes`)()
	assert.strictEqual(formatBytes('953.9G'), '953.9G')
	assert.strictEqual(formatBytes(''), '—')
	assert.strictEqual(formatBytes(2048), '2.0 KB')
	assert.strictEqual(formatBytes(null), '—')
})

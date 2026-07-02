'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

test('parseSpreadsheetFile parses CSV and blocks unsafe header keys', async () => {
	const {
		parseSpreadsheetFile,
		buildRosterFromParsed,
		mapRowToLowerThirdConfig,
		ROSTER_MAX_BYTES,
	} = await import('../../client/lib/lower-third-roster-import.js')

	const csv = 'First,Surname,__proto__\nAda,Lovelace,evil\n'
	const file = {
		name: 'roster.csv',
		arrayBuffer: async () => new TextEncoder().encode(csv).buffer,
	}
	const parsed = await parseSpreadsheetFile(file)
	assert.equal(parsed.headers.includes('__proto__'), false)
	assert.ok(parsed.headers.some((h) => h.startsWith('Column')))
	const roster = buildRosterFromParsed('roster.csv', parsed.headers, parsed.rows)
	const row = roster.rows[0]
	assert.equal(Object.prototype.hasOwnProperty.call(row, '__proto__'), false)
	assert.equal(row.Surname, 'Lovelace')
	const cfg = mapRowToLowerThirdConfig(row, roster.mapping)
	assert.equal(cfg.title, 'Ada Lovelace')
	assert.equal(cfg.subtitle, '')

	const big = {
		name: 'big.csv',
		arrayBuffer: async () => new Uint8Array(ROSTER_MAX_BYTES + 1).buffer,
	}
	await assert.rejects(() => parseSpreadsheetFile(big), /too large/)
})

test('parseSpreadsheetFile reads xlsx when exceljs optional dep is installed', async (t) => {
	let ExcelJS
	try {
		ExcelJS = (await import('exceljs')).default
	} catch {
		t.skip('exceljs optional dependency not installed')
		return
	}
	const { parseSpreadsheetFile } = await import('../../client/lib/lower-third-roster-import.js')
	const wb = new ExcelJS.Workbook()
	const sheet = wb.addWorksheet('Roster')
	sheet.addRow(['First', 'Surname', 'Title'])
	sheet.addRow(['Grace', 'Hopper', 'Rear Admiral'])
	const buf = await wb.xlsx.writeBuffer()
	const file = {
		name: 'roster.xlsx',
		arrayBuffer: async () => buf,
	}
	const parsed = await parseSpreadsheetFile(file)
	assert.equal(parsed.headers[0], 'First')
	assert.equal(parsed.rows[0].Surname, 'Hopper')
	assert.equal(parsed.rows[0].Title, 'Rear Admiral')
})

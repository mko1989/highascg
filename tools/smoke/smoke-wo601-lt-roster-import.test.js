'use strict'

/**
 * WO-601 port fact 4 — POST /api/lower-thirds/roster/import parses Excel / CSV on the server with the web's own
 * lower-third-roster-import.js (Godot has no xlsx reader); the result is the same roster the web stores.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { handlePost } = require('../../src/api/routes-lower-thirds')

const post = async (body) => {
	const r = await handlePost('/api/lower-thirds/roster/import', JSON.stringify(body), {})
	return { status: r.status, body: JSON.parse(r.body) }
}
const b64 = (s) => Buffer.from(s).toString('base64')

describe('WO-601 roster import', () => {
	it('CSV (semicolon, quoted cell) → headers, rows, guessed mapping', async () => {
		const { body } = await post({ fileName: 'people.csv', dataBase64: b64('First Name;Surname;Role\nJan;Kowalski;CEO\n"Anna";Nowak;"CTO; R&D"\n') })
		assert.equal(body.ok, true)
		assert.deepStrictEqual(body.roster.headers, ['First Name', 'Surname', 'Role'])
		assert.deepStrictEqual(body.roster.rows[1], { 'First Name': 'Anna', Surname: 'Nowak', Role: 'CTO; R&D' })
		assert.deepStrictEqual(body.roster.mapping, { firstName: 'First Name', surname: 'Surname', subtitle: 'Role' })
		assert.equal(body.roster.fileName, 'people.csv')
	})
	it('xlsx (exceljs) → first sheet, blank rows skipped, numbers as text', async () => {
		const ExcelJS = require('exceljs')
		const wb = new ExcelJS.Workbook()
		const ws = wb.addWorksheet('S')
		ws.addRow(['Name', 'Last name', 'Job title'])
		ws.addRow(['Ewa', 'Lis', 'Host'])
		ws.addRow([null, null, null])
		ws.addRow(['Piotr', 42, 'Guest'])
		const buf = Buffer.from(await wb.xlsx.writeBuffer())
		const { body } = await post({ fileName: '/some/dir/people.xlsx', dataBase64: buf.toString('base64') })
		assert.equal(body.ok, true)
		assert.equal(body.roster.fileName, 'people.xlsx', 'no client path leaks into the project')
		assert.deepStrictEqual(body.roster.rows.map((r) => r['Last name']), ['Lis', '42'])
	})
	it('refuses oversize, empty and missing input', async () => {
		assert.equal((await post({ fileName: 'big.csv', dataBase64: Buffer.alloc(2 * 1024 * 1024 + 1, 65).toString('base64') })).status, 413)
		assert.equal((await post({ fileName: 'x.csv', dataBase64: b64('\n\n') })).body.ok, false)
		assert.equal((await post({ fileName: 'old.xls', dataBase64: b64('x') })).body.error.includes('Legacy .xls'), true)
		assert.equal((await post({})).status, 400)
	})
})

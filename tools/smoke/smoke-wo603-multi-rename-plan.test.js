'use strict'

/**
 * WO-603 slice 3 — the multi-rename preview is planned in node (POST /api/media/rename/plan) against the server's
 * catalogue; the CommonJS port must stay identical to the web planner (client/lib/media-multi-rename.js) until the
 * web is deleted (WO-609).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const server = require('../../src/media/media-multi-rename')
const routes = require('../../src/api/routes-media-library')

const CASES = [
	[['f/01_Grzegorz Zytka.mov', 'f/02_Anna Nowak.mov'], { title: 'Speaker' }, []],
	[['Summer Rally 02.mp4', 'Summer Rally 07.mp4'], { title: '', renumber: { start: 1, step: 1, pad: 2 } }, []],
	[['a/03_LOOP_2x3.mov', 'a/07.mov'], { title: 'Intro', renumber: { start: 10, step: 5, pad: 3 } }, ['a/Intro.mov']],
	[['x/A.mov', 'x/B.mov'], { title: 'Same' }, []],
	[['x/A 1.mov'], { title: 'B' }, ['X/B 1.MOV']],
	[['x/A.mov'], { title: '   ' }, []],
	[['root.png', 'y/ŁÓDŹ 01.png'], { title: 'Łódź' }, []],
]

describe('WO-603 server multi-rename planner = the web planner', () => {
	it('same plan (names, errors) for every case', async () => {
		const web = await import(pathToFileURL(path.join(__dirname, '../../client/lib/media-multi-rename.js')).href)
		for (const [ids, opts, existing] of CASES) {
			assert.deepEqual(server.buildMultiRenamePlan(ids, opts, existing), web.buildMultiRenamePlan(ids, opts, existing), JSON.stringify(ids))
			for (const id of ids) assert.deepEqual(server.parseNumberedName(id), web.parseNumberedName(id))
		}
	})

	it('pins the rules (numbering kept, title swapped, conflicts named)', () => {
		const p = server.buildMultiRenamePlan(['f/01_Grzegorz Zytka.mov', 'f/02_Anna Nowak.mov'], { title: 'Speaker' })
		assert.deepEqual(p.map((r) => r.to), ['f/01_Speaker.mov', 'f/02_Speaker.mov'])
		const dup = server.buildMultiRenamePlan(['x/A.mov', 'x/B.mov'], { title: 'Same' })
		assert.deepEqual(dup.map((r) => r.error), ['duplicate name', 'duplicate name'])
		const taken = server.buildMultiRenamePlan(['x/A 1.mov'], { title: 'B' }, ['X/B 1.MOV'])
		assert.equal(taken[0].error, 'a file with this name exists')
	})
})

describe('WO-603 POST /api/media/rename/plan', () => {
	const ctx = (media) => ({ config: { local_media_path: path.join(__dirname, 'no-such-media-root') }, state: { getState: () => ({ media }) } })

	it('plans against the server catalogue, returns the changed renames + the dialog seed title', () => {
		const media = [{ id: 'show/01_Intro.mov' }, { id: 'show/02_Intro.mov' }, { id: 'show/03_Outro.mov' }]
		const r = routes.handleRenamePlan(JSON.stringify({ ids: ['show/01_Intro.mov', 'show/02_Intro.mov'], title: 'Opening' }), ctx(media))
		assert.equal(r.status, 200)
		const b = JSON.parse(r.body)
		assert.equal(b.commonTitle, 'Intro')
		assert.equal(b.ok, true)
		assert.deepEqual(b.renames, [
			{ from: 'show/01_Intro.mov', to: 'show/01_Opening.mov' },
			{ from: 'show/02_Intro.mov', to: 'show/02_Opening.mov' },
		])
	})

	it('a name taken by a file outside the selection blocks the rename (server list, not the client\'s)', () => {
		const media = [{ id: 'show/01_Intro.mov' }, { id: 'show/01_Outro.mov' }]
		const b = JSON.parse(routes.handleRenamePlan(JSON.stringify({ ids: ['show/01_Intro.mov'], title: 'Outro' }), ctx(media)).body)
		assert.equal(b.ok, false)
		assert.equal(b.plan[0].error, 'a file with this name exists')
	})

	it('renumber is normalized; no change → ok false; no ids → 400', () => {
		const media = [{ id: 'a/x 5.mov' }]
		const b = JSON.parse(routes.handleRenamePlan(JSON.stringify({ ids: ['a/x 5.mov'], renumber: { start: '5', step: 'bad', pad: '0' } }), ctx(media)).body)
		assert.deepEqual([b.ok, b.renames.length], [false, 0], 'x 5 → x 5')
		assert.equal(routes.handleRenamePlan('{}', ctx([])).status, 400)
	})
})

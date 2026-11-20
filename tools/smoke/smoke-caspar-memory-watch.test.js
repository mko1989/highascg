'use strict'

/** Caspar memory watch (OOM 20.11): burst + RAM-share warnings from RSS samples, and the JSONL history. */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createMemoryTrend, startCasparMemoryWatch } = require('../../src/health/caspar-memory-watch')

const G = 1024 ** 3
const RAM = 64 * G

test('steady memory is quiet; a 1 GB burst inside 10 min warns once per window', () => {
	const t = createMemoryTrend()
	const min = 60_000
	let warns = []
	for (let i = 0; i < 30; i++) warns.push(...t.step({ at: i * min, pid: 7, rss: 4 * G + (i % 3) * 50 * 2 ** 20, totalRam: RAM }))
	assert.deepStrictEqual(warns, [], 'a steady show (±100 MB) never warns')
	warns = t.step({ at: 30 * min, pid: 7, rss: 5.2 * G, totalRam: RAM })
	assert.strictEqual(warns.length, 1)
	assert.match(warns[0], /grew 1\.\d GB in \d+ min \(now 5\.2 GB, pid 7\)/)
	assert.deepStrictEqual(t.step({ at: 31 * min, pid: 7, rss: 6.4 * G, totalRam: RAM }), [], 'not again inside the same window')
	assert.strictEqual(t.step({ at: 41 * min, pid: 7, rss: 7.6 * G, totalRam: RAM }).length, 1, 'still growing 10 min later → warns again')
})

test('RAM share warns from 30 % at each new tenth; a restarted Caspar (new pid) starts over', () => {
	const t = createMemoryTrend({ growWarnBytes: Infinity })
	assert.deepStrictEqual(t.step({ at: 0, pid: 1, rss: 0.25 * RAM, totalRam: RAM }), [])
	assert.match(t.step({ at: 1, pid: 1, rss: 0.31 * RAM, totalRam: RAM })[0], /30%\+ of RAM/)
	assert.deepStrictEqual(t.step({ at: 2, pid: 1, rss: 0.35 * RAM, totalRam: RAM }), [])
	assert.match(t.step({ at: 3, pid: 1, rss: 0.78 * RAM, totalRam: RAM })[0], /70%\+ of RAM/)
	assert.match(t.step({ at: 4, pid: 2, rss: 0.31 * RAM, totalRam: RAM })[0], /30%\+/, 'new process, new count')
})

test('the service writes one JSONL line per sample and logs the warnings', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmw-'))
	const file = path.join(dir, 'caspar-memory.jsonl')
	const logs = []
	let rss = 2 * G
	const w = startCasparMemoryWatch({ log: (l, m) => logs.push([l, m]) }, { file, readRss: async () => ({ pid: 9, rss }), sampleMs: 3_600_000 })
	await w.tick()
	rss = 3.5 * G
	await w.tick()
	w.stop()
	const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
	assert.ok(lines.length >= 2)
	assert.deepStrictEqual(lines.at(-1).rssMB, 3584)
	assert.ok(logs.some(([l, m]) => l === 'warn' && /\[caspar-memory\] Caspar memory grew 1\.5 GB/.test(m)), JSON.stringify(logs))
	fs.rmSync(dir, { recursive: true, force: true })
})

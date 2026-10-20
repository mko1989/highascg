'use strict'

/**
 * WO-623 — the Godot performance overlay reads whole-machine CPU busy % and GPU temperature / VRAM
 * numbers from GET /api/host-stats. `cpu.load*` is a run-queue length, so the % comes from a
 * /proc/stat delta (src/system/host-cpu-usage.js).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const U = require('../../src/system/host-cpu-usage')

const STAT_A = 'cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 50 0 25 400 25 0 0 0 0 0\nintr 1\n'
const STAT_B = 'cpu  160 0 70 900 70 0 0 0 30 0\ncpu0 80 0 35 450 35 0 0 0 0 0\nintr 2\n'

test('the aggregate cpu line parses; idle counts iowait; guest columns stay out of the total', () => {
	assert.deepStrictEqual(U.parseProcStatCpu(STAT_A), { idle: 850, total: 1000 })
	assert.deepStrictEqual(U.parseProcStatCpu(STAT_B), { idle: 970, total: 1200 })
	assert.strictEqual(U.parseProcStatCpu('intr 1\n'), null)
	assert.strictEqual(U.parseProcStatCpu(''), null)
})

test('busy % is the non-idle share of the delta', () => {
	const a = U.parseProcStatCpu(STAT_A)
	const b = U.parseProcStatCpu(STAT_B)
	assert.strictEqual(U.machineCpuPct(a, b), 40) // 200 ticks, 120 idle
	assert.strictEqual(U.machineCpuPct(a, a), null, 'no ticks elapsed → unknown, not 0')
	assert.strictEqual(U.machineCpuPct(null, b), null)
})

test('a live sample on this Linux box lands in 0..100', async () => {
	if (process.platform !== 'linux') return
	U._resetForTest()
	const pct = await U.sampleMachineCpuPct()
	assert.ok(pct === null || (pct >= 0 && pct <= 100), String(pct))
})

test('host-stats exposes cpu.usagePct and the gpu temperature / VRAM numbers', () => {
	const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'api', 'routes-host-stats.js'), 'utf8')
	assert.match(src, /memory\.used,memory\.total,temperature\.gpu/)
	assert.match(src, /usagePct,\n/)
	for (const k of ['vramUsedMiB', 'vramTotalMiB', 'tempC']) assert.match(src, new RegExp(`${k}: gpu\\.${k} \\?\\? null`))
})

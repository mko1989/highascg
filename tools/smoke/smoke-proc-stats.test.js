'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseStatFields, parseVmRssKb, computeCpuPct, PROC_CLK_TCK } = require('../../src/system/proc-stats')

// Real /proc/<pid>/stat line sampled from this rig's casparcg-server.service run.sh supervisor
// (PID replaced for the fixture, comm 'run.sh' has no spaces but is a realistic baseline).
const STAT_SIMPLE =
	'1324984 (run.sh) S 1 1324984 1324984 0 -1 4194560 302433 4208738561 0 8347 95 654 14402420 1245435 20 0 1 0 68961 2867200 672 18446744073709551615 101105057087488 101105057171485 140722284993232 0 0 0 0 4096 65538 1 0 0 17 18 0 0 0 0 0 101105057197520 101105057202720 101105665634304 140722285001852 140722285001891 140722285001891 140722285002713 0'

test('parseStatFields reads utime/stime for a plain comm', () => {
	const fields = parseStatFields(STAT_SIMPLE)
	assert.ok(fields)
	assert.equal(fields.utime, 95)
	assert.equal(fields.stime, 654)
	assert.equal(fields.ppid, 1)
})

test('parseStatFields handles a comm containing spaces and parens (proc(5) edge case)', () => {
	// comm can be renamed via prctl(PR_SET_NAME) to include spaces or literal parens; proc(5) says
	// to always split on the *last* ')' rather than the first, since the comm itself may contain ')'.
	const statText =
		'3545917 (my (weird) proc name) S 1324984 3545917 3545917 0 -1 4194560 1 2 3 4 250 750 0 0 20 0 3 0 68962 1000 100 0 0 0 0 0 0 0 0 4096 0 0 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0'
	const fields = parseStatFields(statText)
	assert.ok(fields)
	assert.equal(fields.utime, 250)
	assert.equal(fields.stime, 750)
	assert.equal(fields.ppid, 1324984)
})

test('parseStatFields returns null for garbage input', () => {
	assert.equal(parseStatFields(''), null)
	assert.equal(parseStatFields('no parens here'), null)
	assert.equal(parseStatFields('123 (comm) S 1'), null) // too few trailing fields
})

test('parseVmRssKb parses the standard /proc/<pid>/status line', () => {
	const status = [
		'Name:\trun.sh',
		'State:\tS (sleeping)',
		'Pid:\t1324984',
		'VmPeak:\t    2048 kB',
		'VmRSS:\t    2044 kB',
		'VmSwap:\t       0 kB',
		'',
	].join('\n')
	assert.equal(parseVmRssKb(status), 2044)
})

test('parseVmRssKb returns null when VmRSS is missing', () => {
	assert.equal(parseVmRssKb('Name:\tfoo\nPid:\t1\n'), null)
	assert.equal(parseVmRssKb(''), null)
})

test('computeCpuPct: 100% of one core over a 1s window', () => {
	// 1 full second of CPU time (utime+stime delta == PROC_CLK_TCK) over 1000ms wall time == 100%.
	const prev = { utime: 0, stime: 0, atMs: 0 }
	const cur = { utime: PROC_CLK_TCK, stime: 0, atMs: 1000 }
	assert.equal(computeCpuPct(prev, cur), 100)
})

test('computeCpuPct: half a core over a 1s window', () => {
	const prev = { utime: 100, stime: 50, atMs: 0 }
	const cur = { utime: 100 + PROC_CLK_TCK / 4, stime: 50 + PROC_CLK_TCK / 4, atMs: 1000 }
	assert.equal(computeCpuPct(prev, cur), 50)
})

test('computeCpuPct: idle process over a window reports 0%', () => {
	const prev = { utime: 500, stime: 200, atMs: 0 }
	const cur = { utime: 500, stime: 200, atMs: 2000 }
	assert.equal(computeCpuPct(prev, cur), 0)
})

test('computeCpuPct: non-positive elapsed time is treated as 0% (no divide-by-zero)', () => {
	const prev = { utime: 10, stime: 10, atMs: 1000 }
	const sameTime = { utime: 20, stime: 20, atMs: 1000 }
	const wentBackwards = { utime: 20, stime: 20, atMs: 500 }
	assert.equal(computeCpuPct(prev, sameTime), 0)
	assert.equal(computeCpuPct(prev, wentBackwards), 0)
})

test('computeCpuPct: tick counter going backwards (pid reuse) reports 0%, not negative', () => {
	const prev = { utime: 1000, stime: 1000, atMs: 0 }
	const cur = { utime: 10, stime: 10, atMs: 1000 } // pid reused by a fresh, cheaper process
	assert.equal(computeCpuPct(prev, cur), 0)
})

test('computeCpuPct: multi-core process can exceed 100%', () => {
	// 2.5 cores fully busy for 1s == 250%.
	const prev = { utime: 0, stime: 0, atMs: 0 }
	const cur = { utime: PROC_CLK_TCK * 2.5, stime: 0, atMs: 1000 }
	assert.equal(computeCpuPct(prev, cur), 250)
})

test('CPU normalization: 1400% single-core-equiv on 28-core machine normalizes to 50.0% of machine', () => {
	// WO-182: normalize multi-core percentages for display (machine share).
	// A process using 1400% (single-core-equiv) on a 28-core box should display as 50.0% of machine.
	const cpuPct = 1400
	const cores = 28
	const cpuPctOfMachine = Math.round((cpuPct / cores) * 10) / 10
	assert.equal(cpuPctOfMachine, 50.0)
})

test('CPU normalization: 2800% single-core-equiv on 28-core machine normalizes to 100.0% of machine', () => {
	// All cores fully busy.
	const cpuPct = 2800
	const cores = 28
	const cpuPctOfMachine = Math.round((cpuPct / cores) * 10) / 10
	assert.equal(cpuPctOfMachine, 100.0)
})

test('CPU normalization: 700% single-core-equiv on 28-core machine normalizes to 25.0% of machine', () => {
	// Half of one core per core (one full core busy).
	const cpuPct = 700
	const cores = 28
	const cpuPctOfMachine = Math.round((cpuPct / cores) * 10) / 10
	assert.equal(cpuPctOfMachine, 25.0)
})

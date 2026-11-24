#!/usr/bin/env node
'use strict'
/**
 * WO-1133 — analyse a caspar-leak-soak run directory (samples.csv, events.jsonl, smaps.jsonl).
 *
 *   node tools/soak/soak-report.js ~/.highascg/soak/<stamp> [--json]
 *
 * Answers: does Caspar grow while nothing happens (hold), per take (rapid), or only while a given look plays
 * (per-look)? Where do bursts sit, and which mapping class (heap / anon / nvidia / memfd) holds the growth?
 * Works on a run that is still going.
 */

const fs = require('fs')
const path = require('path')

const dir = process.argv[2]
const asJson = process.argv.includes('--json')
if (!dir) {
	console.error('usage: soak-report.js <soak dir> [--json]')
	process.exit(2)
}
const MB = (kb) => (kb == null ? null : +(kb / 1024).toFixed(1))
const SETTLE_MS = 90_000 // skip the take transient at the start of each segment
const BURST_WINDOW_MS = 10 * 60_000
const BURST_MB = 500

function parseCsvLine(line) {
	const out = []
	let cur = ''
	let q = false
	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		if (q) {
			if (c === '\\' && i + 1 < line.length) cur += c + line[++i]
			else if (c === '"') {
				q = false
				cur += c
			} else cur += c
		} else if (c === '"') {
			q = true
			cur += c
		} else if (c === ',') {
			out.push(cur)
			cur = ''
		} else cur += c
	}
	out.push(cur)
	return out
}

function loadSamples() {
	const lines = fs.readFileSync(path.join(dir, 'samples.csv'), 'utf8').trim().split('\n')
	const head = lines.shift().split(',')
	return lines.map((l) => {
		const v = parseCsvLine(l)
		const o = {}
		head.forEach((h, i) => {
			const x = v[i]
			if (h === 't') o.t = Date.parse(x)
			else if (h === 'phase') o.phase = x
			else if (h === 'look') o.look = x ? JSON.parse(x) : ''
			else o[h] = x === '' || x == null ? null : Number(x)
		})
		return o
	})
}

function loadJsonl(name) {
	const p = path.join(dir, name)
	if (!fs.existsSync(p)) return []
	return fs
		.readFileSync(p, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l))
}

/** Least-squares slope in units per hour. */
function slopePerHour(pts, key) {
	const xs = []
	const ys = []
	for (const p of pts) {
		if (p[key] == null) continue
		xs.push(p.t / 3600_000)
		ys.push(p[key])
	}
	if (xs.length < 4) return null
	const mx = xs.reduce((a, b) => a + b, 0) / xs.length
	const my = ys.reduce((a, b) => a + b, 0) / ys.length
	let num = 0
	let den = 0
	for (let i = 0; i < xs.length; i++) {
		num += (xs[i] - mx) * (ys[i] - my)
		den += (xs[i] - mx) ** 2
	}
	return den ? num / den : null
}

const median = (a) => {
	const b = a.filter((x) => x != null).sort((x, y) => x - y)
	if (!b.length) return null
	const m = b.length >> 1
	return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2
}
const r1 = (x) => (x == null ? null : +x.toFixed(1))

const samples = loadSamples()
const events = loadJsonl('events.jsonl')
const smaps = loadJsonl('smaps.jsonl')
const startEv = events.find((e) => e.type === 'start')
const endEv = events.find((e) => e.type === 'end')

// ── runs (Caspar pid lifetimes)
const runs = []
for (const s of samples) {
	if (s.casparPid == null) continue
	let r = runs[runs.length - 1]
	if (!r || r.pid !== s.casparPid) runs.push((r = { pid: s.casparPid, pts: [] }))
	r.pts.push(s)
}
const runSummary = runs.map((r) => ({
	pid: r.pid,
	from: new Date(r.pts[0].t).toISOString(),
	to: new Date(r.pts[r.pts.length - 1].t).toISOString(),
	startMB: MB(r.pts[0].rssKB),
	endMB: MB(r.pts[r.pts.length - 1].rssKB),
	maxMB: MB(Math.max(...r.pts.map((p) => p.rssKB || 0))),
	rssMBperH: r1(MB(slopePerHour(r.pts, 'rssKB'))),
	anonMBperH: r1(MB(slopePerHour(r.pts, 'anonKB'))),
	shmemMBperH: r1(MB(slopePerHour(r.pts, 'shmemKB'))),
	gpuMiBperH: r1(slopePerHour(r.pts, 'casparGpuMiB')),
	cefMBperH: r1(MB(slopePerHour(r.pts, 'cefRssKB'))),
	threads: [r.pts[0].threads, r.pts[r.pts.length - 1].threads],
	fds: [r.pts[0].fds, r.pts[r.pts.length - 1].fds],
	maps: [r.pts[0].maps, r.pts[r.pts.length - 1].maps],
}))

// ── segments between phase events
const marks = events.filter((e) => e.type === 'phase' || e.type === 'end').map((e) => ({ ...e, ms: Date.parse(e.t) }))
const lastT = samples.length ? samples[samples.length - 1].t : Date.now()
const segs = []
for (let i = 0; i < marks.length; i++) {
	if (marks[i].type !== 'phase') continue
	const from = marks[i].ms
	const to = i + 1 < marks.length ? marks[i + 1].ms : lastT
	const pts = samples.filter((s) => s.t >= from + SETTLE_MS && s.t < to)
	const pidSet = new Set(pts.map((p) => p.casparPid))
	if (pidSet.size !== 1) continue // a Caspar restart inside the segment: no slope
	const takes = events.filter((e) => e.type === 'take' && e.target === 'program' && Date.parse(e.t) >= from && Date.parse(e.t) < to).length
	segs.push({
		phase: marks[i].phase,
		look: marks[i].look || null,
		cycle: marks[i].cycle,
		from: new Date(from).toISOString(),
		hours: (to - from) / 3600_000,
		rss: MB(slopePerHour(pts, 'rssKB')),
		anon: MB(slopePerHour(pts, 'anonKB')),
		gpu: slopePerHour(pts, 'casparGpuMiB'),
		takes,
	})
}

const byPhase = {}
for (const s of segs) (byPhase[s.phase] ||= []).push(s)
const phaseSummary = Object.fromEntries(
	Object.entries(byPhase).map(([k, a]) => {
		const takesPerH = median(a.map((s) => s.takes / s.hours))
		const rss = median(a.map((s) => s.rss))
		return [
			k,
			{
				segments: a.length,
				rssMBperH_median: r1(rss),
				anonMBperH_median: r1(median(a.map((s) => s.anon))),
				gpuMiBperH_median: r1(median(a.map((s) => s.gpu))),
				...(k === 'rapid' && takesPerH ? { takesPerH: r1(takesPerH), kbPerTake: r1(((rss ?? 0) * 1024) / takesPerH) } : {}),
			},
		]
	})
)

const perLook = {}
for (const s of byPhase['per-look'] || []) (perLook[s.look] ||= []).push(s)
const lookSummary = Object.entries(perLook)
	.map(([look, a]) => ({
		look,
		holds: a.length,
		rssMBperH_median: r1(median(a.map((s) => s.rss))),
		anonMBperH_median: r1(median(a.map((s) => s.anon))),
		gpuMiBperH_median: r1(median(a.map((s) => s.gpu))),
	}))
	.sort((x, y) => (y.rssMBperH_median ?? 0) - (x.rssMBperH_median ?? 0))

// ── take steps: RSS 60 s after a PGM take minus just before it, per look
const stepByLook = {}
for (const e of events) {
	if (e.type !== 'take' || e.target !== 'program' || e.rssKBBefore == null) continue
	const t = Date.parse(e.t)
	const after = samples.find((s) => s.t >= t + 60_000)
	if (!after || after.rssKB == null) continue
	;(stepByLook[e.look] ||= []).push((after.rssKB - e.rssKBBefore) / 1024)
}
const takeSteps = Object.entries(stepByLook)
	.map(([look, a]) => ({ look, takes: a.length, medianStepMB: r1(median(a)), meanStepMB: r1(a.reduce((x, y) => x + y, 0) / a.length) }))
	.sort((x, y) => (y.meanStepMB ?? 0) - (x.meanStepMB ?? 0))

// ── stress companion (soak-stress.js): RSS 60 s after each action minus the last sample before it
const STRESS = ['editor-cycle', 'clear-prv', 'rec-start', 'rec-stop']
const stressSteps = STRESS.map((type) => {
	const a = []
	for (const e of events) {
		if (e.type !== type) continue
		const t = Date.parse(e.t)
		const before = samples.filter((x) => x.t <= t && x.rssKB != null).pop()
		const after = samples.find((x) => x.t >= t + 60_000)
		if (before && after?.rssKB != null && before.casparPid === after.casparPid) a.push((after.rssKB - before.rssKB) / 1024)
	}
	return { action: type, count: a.length, medianStepMB: r1(median(a)), meanStepMB: a.length ? r1(a.reduce((x, y) => x + y, 0) / a.length) : null }
}).filter((r) => r.count)

// ── bursts: ≥ BURST_MB growth inside BURST_WINDOW_MS (same pid), with what was happening
const bursts = []
for (const r of runs) {
	let j = 0
	let lastBurstEnd = 0
	for (let i = 0; i < r.pts.length; i++) {
		while (r.pts[i].t - r.pts[j].t > BURST_WINDOW_MS) j++
		const lo = r.pts.slice(j, i + 1).reduce((m, p) => (p.rssKB < m.rssKB ? p : m))
		const grow = (r.pts[i].rssKB - lo.rssKB) / 1024
		if (grow >= BURST_MB && r.pts[i].t > lastBurstEnd) {
			lastBurstEnd = r.pts[i].t + BURST_WINDOW_MS
			const takes = events
				.filter((e) => e.type === 'take' && Date.parse(e.t) >= lo.t - 60_000 && Date.parse(e.t) <= r.pts[i].t)
				.map((e) => `${e.target === 'program' ? 'PGM' : 'PRV'} ${e.look}`)
			const stress = STRESS.map((type) => [type, events.filter((e) => e.type === type && Date.parse(e.t) >= lo.t - 60_000 && Date.parse(e.t) <= r.pts[i].t).length])
				.filter(([, c]) => c)
				.map(([type, c]) => `${type}×${c}`)
				.join(' ')
			bursts.push({ from: new Date(lo.t).toISOString(), to: new Date(r.pts[i].t).toISOString(), growMB: r1(grow), phase: r.pts[i].phase, look: r.pts[i].look, stress, takes })
		}
	}
}

// ── smaps: growth per mapping class, first vs last snapshot of each pid
const smapsGrowth = []
const byPid = {}
for (const s of smaps) (byPid[s.pid] ||= []).push(s)
for (const [pid, a] of Object.entries(byPid)) {
	if (a.length < 2) continue
	const f = a[0].agg
	const l = a[a.length - 1].agg
	const keys = new Set([...Object.keys(f), ...Object.keys(l)])
	const rows = [...keys]
		.map((k) => ({ mapping: k, deltaMB: MB((l[k]?.rssKB || 0) - (f[k]?.rssKB || 0)), countDelta: (l[k]?.count || 0) - (f[k]?.count || 0), nowMB: MB(l[k]?.rssKB || 0) }))
		.sort((x, y) => Math.abs(y.deltaMB) - Math.abs(x.deltaMB))
		.slice(0, 12)
	smapsGrowth.push({ pid: Number(pid), from: a[0].t, to: a[a.length - 1].t, rows })
}

const takesAll = events.filter((e) => e.type === 'take')
const report = {
	dir,
	started: startEv?.t,
	ended: endEv?.t || null,
	project: startEv?.project,
	takes: takesAll.length,
	takeFails: takesAll.filter((e) => !e.ok).length,
	slowTakesOver5s: takesAll.filter((e) => e.ms > 5000).length,
	casparRestarts: events.filter((e) => e.type === 'caspar-pid-change').length,
	runs: runSummary,
	phases: phaseSummary,
	perLook: lookSummary,
	takeSteps,
	stressSteps,
	bursts,
	smapsGrowth,
}

if (asJson) {
	console.log(JSON.stringify(report, null, 1))
	process.exit(0)
}

const tbl = (rows) => {
	if (!rows.length) return '  (none)'
	const cols = Object.keys(rows[0])
	const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)))
	const fmt = (r) => '  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join('  ')
	return [fmt(Object.fromEntries(cols.map((c) => [c, c]))), ...rows.map(fmt)].join('\n')
}
console.log(`Caspar leak soak — ${report.project || '?'}  ${report.started} → ${report.ended || '(running)'}`)
console.log(`takes ${report.takes} (failed ${report.takeFails}, >5 s ${report.slowTakesOver5s}), Caspar restarts ${report.casparRestarts}\n`)
console.log('Runs (per Caspar pid):')
console.log(tbl(runSummary.map((r) => ({ ...r, threads: r.threads.join('→'), fds: r.fds.join('→'), maps: r.maps.join('→') }))))
console.log('\nPhase slopes (median over segments, first 90 s of each skipped):')
console.log(tbl(Object.entries(phaseSummary).map(([phase, v]) => ({ phase, ...v }))))
console.log('\nPer-look hold slopes (MB/h while that look plays):')
console.log(tbl(lookSummary))
console.log('\nRSS step 60 s after a PGM take, by look (MB):')
console.log(tbl(takeSteps))
if (stressSteps.length) {
	console.log('\nRSS step 60 s after a stress action (MB):')
	console.log(tbl(stressSteps))
}
console.log(`\nBursts (≥ ${BURST_MB} MB in 10 min):`)
console.log(tbl(bursts.map((b) => ({ ...b, takes: b.takes.slice(-6).join(' | ') }))))
for (const g of smapsGrowth) {
	console.log(`\nsmaps growth pid ${g.pid} ${g.from} → ${g.to}:`)
	console.log(tbl(g.rows))
}

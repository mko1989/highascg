#!/usr/bin/env node
'use strict'

/**
 * Measure how fast a Caspar layer actually plays, as a percentage of realtime (WO-500).
 *
 * Polls `/api/state` and watches the OSC `file.elapsed` of one playing layer against the wall
 * clock. A healthy channel returns ~100 %. Anything materially below means the channel cannot hold
 * its frame deadline, and the operator-visible symptom is the progress bar snapping backwards (the
 * client extrapolates at 1.0x and re-anchors once it drifts past 0.5 s — see §3 of WO-500).
 *
 * Also snapshots the things that explain a bad number: per-channel consumers from AMCP `INFO`, and
 * GPU / CPU from `/api/host-stats`. Both are captured with the measurement so an A/B of two configs
 * compares like with like.
 *
 * Usage:
 *   node tools/dev/measure-playback-rate.js --host 192.168.0.37:4200 --seconds 30
 *   node tools/dev/measure-playback-rate.js --channel 1 --layer 10 --label "vsync off" --json out.json
 *
 * @see docs/reference/measuring-playback-rate.md
 */

const fs = require('fs')

const DEFAULTS = {
	host: '127.0.0.1:4200',
	channel: 0, // 0 = auto-detect
	layer: 0, // 0 = auto-detect
	seconds: 30,
	interval: 1,
	label: '',
	json: '',
	quiet: false,
}

function parseArgs(argv) {
	const o = { ...DEFAULTS }
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		const next = () => argv[++i]
		switch (a) {
			case '--host': o.host = String(next()).replace(/^https?:\/\//, '').replace(/\/$/, ''); break
			case '--channel': o.channel = parseInt(next(), 10); break
			case '--layer': o.layer = parseInt(next(), 10); break
			case '--seconds': o.seconds = parseFloat(next()); break
			case '--interval': o.interval = parseFloat(next()); break
			case '--label': o.label = String(next()); break
			case '--json': o.json = String(next()); break
			case '--quiet': o.quiet = true; break
			case '-h':
			case '--help': o.help = true; break
			default:
				if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`)
		}
	}
	return o
}

function usage() {
	console.log(`
Measure playback rate vs realtime.

  --host <ip:port>    default ${DEFAULTS.host}
  --channel <n>       default auto (first channel with a playing layer)
  --layer <n>         default auto (first layer on that channel with file.elapsed)
  --seconds <s>       measurement window, default ${DEFAULTS.seconds}
  --interval <s>      poll interval, default ${DEFAULTS.interval}
  --label <text>      tag the run (shown in output and JSON) — use for A/B
  --json <path>       append the result as one JSON line
  --quiet             summary only, no per-sample rows
`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(host, path, timeoutMs = 20000) {
	const ctl = new AbortController()
	const t = setTimeout(() => ctl.abort(), timeoutMs)
	try {
		const res = await fetch(`http://${host}${path}`, { signal: ctl.signal })
		if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
		return await res.json()
	} finally {
		clearTimeout(t)
	}
}

async function amcp(host, cmd, timeoutMs = 20000) {
	const ctl = new AbortController()
	const t = setTimeout(() => ctl.abort(), timeoutMs)
	try {
		const res = await fetch(`http://${host}/api/amcp/raw`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cmd }),
			signal: ctl.signal,
		})
		if (!res.ok) throw new Error(`AMCP ${cmd} → HTTP ${res.status}`)
		return await res.json()
	} finally {
		clearTimeout(t)
	}
}

/** @returns {{channel:number, layer:number, file:object}|null} */
function findPlayingLayer(state, wantCh, wantLayer) {
	const channels = state?.osc?.channels || {}
	const chKeys = Object.keys(channels).sort((a, b) => Number(a) - Number(b))
	for (const ch of chKeys) {
		if (wantCh && Number(ch) !== wantCh) continue
		const layers = channels[ch]?.layers || {}
		const lKeys = Object.keys(layers).sort((a, b) => Number(a) - Number(b))
		for (const l of lKeys) {
			if (wantLayer && Number(l) !== wantLayer) continue
			const f = layers[l]?.file
			if (f && Number.isFinite(f.elapsed)) return { channel: Number(ch), layer: Number(l), file: f }
		}
	}
	return null
}

/** Consumers per channel, from AMCP INFO — the thing that usually explains a bad rate. */
async function snapshotConsumers(host) {
	const out = []
	for (let ch = 1; ch <= 16; ch++) {
		let data
		try {
			const r = await amcp(host, `INFO ${ch}`)
			data = r?.data
		} catch {
			break
		}
		if (typeof data !== 'string') break
		const format = /<format>([^<]+)<\/format>/.exec(data)?.[1] || '?'
		const consumers = []
		for (const m of data.matchAll(/<port_(\d+)>\s*<consumer>([^<]+)<\/consumer>/g)) {
			consumers.push(`${m[2]}(${m[1]})`)
		}
		out.push({ channel: ch, format, consumers })
	}
	return out
}

async function snapshotHost(host) {
	try {
		const h = await getJson(host, '/api/host-stats')
		return {
			gpuPct: h?.gpu?.utilizationPct ?? null,
			gpuText: h?.gpu?.text ?? null,
			load1: h?.cpu?.load1 ?? null,
			cores: h?.cpu?.cores ?? null,
			casparCpuPct: h?.processes?.caspar?.cpuPct ?? null,
			nodeCpuPct: h?.processes?.highascg?.cpuPct ?? null,
		}
	} catch {
		return null
	}
}

/**
 * Least-squares slope of elapsed vs wall clock.
 *
 * The headline number. Pairwise ratios divide by a ~1 s interval that carries this tool's own HTTP
 * latency, so a single slow `/api/state` throws that sample far off while barely moving the fit.
 * Regression uses every sample's absolute position, so poll-latency noise cancels instead of
 * accumulating.
 * @param {{at:number, elapsed:number}[]} pts wrap-corrected, monotonic
 */
function regressionRate(pts) {
	const n = pts.length
	if (n < 3) return null
	const mx = pts.reduce((s, p) => s + p.at, 0) / n
	const my = pts.reduce((s, p) => s + p.elapsed, 0) / n
	let num = 0
	let den = 0
	for (const p of pts) {
		num += (p.at - mx) * (p.elapsed - my)
		den += (p.at - mx) ** 2
	}
	return den > 0 ? num / den : null
}

/** Per-channel tick rate from each meter consumer's monotonic frame counter (WO-502). */
async function readConsumerFrames(host) {
	const out = {}
	for (let ch = 1; ch <= 16; ch++) {
		let data
		try {
			data = (await amcp(host, `INFO ${ch}`))?.data
		} catch {
			break
		}
		if (typeof data !== 'string') break
		const block = /<port_720>[\s\S]*?<\/port_720>/.exec(data)
		const f = block && /<frame>(\d+)<\/frame>/.exec(block[0])
		if (f) out[ch] = parseInt(f[1], 10)
	}
	return { at: Date.now() / 1000, frames: out }
}

function summarise(samples, duration) {
	let advanced = 0
	let wall = 0
	let backward = 0
	let wraps = 0
	const ratios = []
	for (let i = 1; i < samples.length; i++) {
		const a = samples[i - 1]
		const b = samples[i]
		const dw = b.at - a.at
		let de = b.elapsed - a.elapsed
		if (duration && de < -1) {
			de += duration // loop wrap
			wraps++
		} else if (de < 0) {
			backward++
			continue // a genuine source-side regression is not negative playback
		}
		advanced += de
		wall += dw
		if (dw > 0) ratios.push(de / dw)
	}
	const rate = wall > 0 ? advanced / wall : 0
	ratios.sort((x, y) => x - y)

	// Wrap-corrected monotonic series for the regression fit.
	const pts = []
	let offset = 0
	for (let i = 0; i < samples.length; i++) {
		if (i > 0 && duration && samples[i].elapsed - samples[i - 1].elapsed < -1) offset += duration
		pts.push({ at: samples[i].at, elapsed: samples[i].elapsed + offset })
	}
	const fit = regressionRate(pts)

	// How much of the per-sample spread is OUR polling, not playback. dt should be ~constant.
	const dts = []
	for (let i = 1; i < samples.length; i++) dts.push(samples[i].at - samples[i - 1].at)
	const mdt = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0
	const sdt = dts.length ? Math.sqrt(dts.reduce((s, d) => s + (d - mdt) ** 2, 0) / dts.length) : 0

	const fitPct = fit != null ? +(fit * 100).toFixed(1) : null
	const headline = fitPct != null ? fit : rate
	return {
		samples: samples.length,
		mediaAdvancedSec: +advanced.toFixed(3),
		wallSec: +wall.toFixed(3),
		ratePct: fitPct != null ? fitPct : +(rate * 100).toFixed(1),
		ratePctPairwise: +(rate * 100).toFixed(1),
		minRatio: ratios.length ? +ratios[0].toFixed(3) : null,
		medianRatio: ratios.length ? +ratios[Math.floor(ratios.length / 2)].toFixed(3) : null,
		maxRatio: ratios.length ? +ratios[ratios.length - 1].toFixed(3) : null,
		pollIntervalSd: +sdt.toFixed(3),
		/** Per-sample ratios are untrustworthy once our own poll interval wobbles this much. */
		pollNoiseDominates: sdt > 0.05,
		backwardSteps: backward,
		loopWraps: wraps,
		/** Client re-anchors once its 1.0x extrapolation drifts past SNAP_TOL_SEC (0.5 s). */
		predictedBarSnapSec: headline > 0 && headline < 1 ? +(0.5 / (1 - headline)).toFixed(2) : null,
	}
}

async function main() {
	const opt = parseArgs(process.argv.slice(2))
	if (opt.help) return usage()

	const state0 = await getJson(opt.host, '/api/state')
	const found = findPlayingLayer(state0, opt.channel, opt.layer)
	if (!found) {
		console.error(
			`No playing layer with file.elapsed found on ${opt.host}` +
				(opt.channel ? ` (channel ${opt.channel}${opt.layer ? `, layer ${opt.layer}` : ''})` : '') +
				'.\nStart a clip first — a still or template has no elapsed to measure.',
		)
		process.exit(2)
	}
	const { channel, layer } = found
	const duration = Number.isFinite(found.file.duration) ? found.file.duration : null

	console.log(`host       ${opt.host}`)
	if (opt.label) console.log(`label      ${opt.label}`)
	console.log(`layer      ${channel}-${layer}  ${found.file.name || found.file.path || '?'}`)
	console.log(`clip       ${found.file.fps || '?'} fps, duration ${duration ?? '?'} s`)
	console.log(`window     ${opt.seconds} s @ ${opt.interval} s\n`)

	const before = await snapshotHost(opt.host)
	const ticksBefore = await readConsumerFrames(opt.host)
	const samples = []
	const t0 = Date.now()
	while ((Date.now() - t0) / 1000 < opt.seconds) {
		const ta = Date.now()
		let s
		try {
			s = await getJson(opt.host, '/api/state')
		} catch (e) {
			console.error(`  sample failed: ${e.message}`)
			await sleep(opt.interval * 1000)
			continue
		}
		const tb = Date.now()
		const f = s?.osc?.channels?.[String(channel)]?.layers?.[String(layer)]?.file
		if (f && Number.isFinite(f.elapsed)) {
			const at = (ta + tb) / 2000
			const prev = samples[samples.length - 1]
			samples.push({ at, elapsed: f.elapsed })
			if (!opt.quiet && prev) {
				const dw = at - prev.at
				let de = f.elapsed - prev.elapsed
				let note = ''
				if (duration && de < -1) {
					de += duration
					note = '  [loop wrap]'
				} else if (de < 0) {
					note = '  <-- BACKWARD at source'
				}
				console.log(
					`  dt=${dw.toFixed(2)}s  media=${de >= 0 ? '+' : ''}${de.toFixed(3)}s  ` +
						`ratio=${(de / dw).toFixed(2)}  elapsed=${f.elapsed.toFixed(2)}${note}`,
				)
			}
		}
		await sleep(Math.max(0, opt.interval * 1000 - (Date.now() - tb)))
	}

	const ticksAfter = await readConsumerFrames(opt.host)
	const after = await snapshotHost(opt.host)
	const consumers = await snapshotConsumers(opt.host)
	const sum = summarise(samples, duration)

	// Channel tick rate: an exact monotonic counter over a long window. Immune to poll latency, and
	// the only honest way to tell a slow CHANNEL from a slow clip (WO-502).
	const tickWindow = ticksAfter.at - ticksBefore.at
	const ticks = []
	for (const ch of Object.keys(ticksAfter.frames)) {
		const a = ticksBefore.frames[ch]
		const b = ticksAfter.frames[ch]
		if (a == null || b == null || b <= a || tickWindow <= 0) continue
		ticks.push({ channel: Number(ch), fps: +((b - a) / tickWindow).toFixed(2) })
	}

	console.log(`\n${'='.repeat(58)}`)
	console.log(`RATE       ${sum.ratePct} % of realtime` + (opt.label ? `   [${opt.label}]` : ''))
	console.log(`           least-squares fit over ${sum.samples} samples (pairwise: ${sum.ratePctPairwise} %)`)
	console.log(`spread     min ${sum.minRatio}  median ${sum.medianRatio}  max ${sum.maxRatio}`)
	if (sum.pollNoiseDominates) {
		console.log(
			`           ^ MOSTLY THIS TOOL: poll interval varied +/-${sum.pollIntervalSd}s, which moves\n` +
				`             each per-sample ratio far more than playback does. Trust RATE, not the spread.\n` +
				`             This is NOT on-glass jitter — at ~100 % rate, visible stutter is a frame-pacing\n` +
				`             problem (vsync / GL sync, WO-407), not a speed problem.`,
		)
	}
	console.log(`backward   ${sum.backwardSteps} source-side regressions, ${sum.loopWraps} loop wraps`)
	if (ticks.length) {
		console.log(
			`tick rate  ${ticks.map((t) => `ch${t.channel} ${t.fps}`).join('  ')}   ` +
				`(exact frame counters over ${tickWindow.toFixed(0)} s — a slow CHANNEL shows here)`,
		)
	}
	if (sum.predictedBarSnapSec) {
		console.log(`bar snap   expect the GUI progress bar to jump back every ~${sum.predictedBarSnapSec} s`)
	}
	if (after) {
		console.log(
			`load       GPU ${after.gpuPct}%  caspar ${after.casparCpuPct}% CPU  ` +
				`node ${after.nodeCpuPct}%  load1 ${after.load1}/${after.cores}`,
		)
	}
	console.log(`\nconsumers per channel (AMCP INFO):`)
	for (const c of consumers) {
		console.log(`  ch${c.channel} ${c.format.padEnd(11)} ${c.consumers.join(', ') || '(none)'}`)
	}
	console.log('='.repeat(58))

	if (opt.json) {
		const row = {
			at: new Date().toISOString(),
			label: opt.label || null,
			host: opt.host,
			channel,
			layer,
			clip: { name: found.file.name ?? null, fps: found.file.fps ?? null, duration },
			...sum,
			ticks,
			hostBefore: before,
			hostAfter: after,
			consumers,
		}
		fs.appendFileSync(opt.json, JSON.stringify(row) + '\n')
		console.log(`\nappended to ${opt.json}`)
	}

	// Non-zero exit when clearly not realtime, so it can gate a scripted A/B.
	process.exit(sum.ratePct < 97 ? 1 : 0)
}

main().catch((e) => {
	console.error(e?.message || e)
	process.exit(2)
})

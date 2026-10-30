#!/usr/bin/env node
'use strict'

/**
 * WO-866 — score the live drum detector (src/audio/audio-parts.js) against annotated music.
 *
 *   node tools/audio/eval-drum-detector.js <MDB Drums dir> [--tol=50] [--only=Rock,Punk] [--opts='{"kick":{"k":2}}']
 *
 * <dir> is a checkout of github.com/CarlSouthall/MDBDrums ("MDB Drums": audio/full_mix/*_MIX.wav,
 * annotations/class/*_class.txt with KD / SD / HH). The dataset is CC BY-NC-SA — evaluation only, never committed.
 * Each mix is decoded to 48 kHz mono by ffmpeg and replayed 512 samples at a time (routes-audio-parts-capture.js
 * replayHits), so a hit's time is when the live box would decide it. Per drum: precision / recall / F at ±tol ms
 * (greedy one-to-one matching, mir_eval style) and the median decision offset of the matched hits.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { replayHits } = require('../../src/api/routes-audio-parts-capture')

const RATE = 48000
const CLASS = { KD: 'kick', SD: 'snare', HH: 'hats' }
const DRUMS = ['kick', 'snare', 'hats']

function decode(file, cache) {
	const hit = cache && path.join(cache, path.basename(file) + '.f32')
	if (hit && fs.existsSync(hit)) {
		const b = fs.readFileSync(hit)
		return new Float32Array(b.buffer, b.byteOffset, b.length / 4)
	}
	const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], {
		maxBuffer: 1 << 30,
	})
	if (hit) fs.writeFileSync(hit, buf)
	return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
}

function annotations(file) {
	const ref = { kick: [], snare: [], hats: [] }
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		const [t, c] = line.trim().split(/\s+/)
		if (CLASS[c]) ref[CLASS[c]].push(Number(t) * 1000)
	}
	return ref
}

/** Greedy nearest one-to-one matching within tol: { tp, fp, fn, offsets }. */
function match(ref, est, tol) {
	const used = new Uint8Array(ref.length)
	const offsets = []
	let j = 0
	for (const e of est) {
		while (j < ref.length && ref[j] < e - tol) j++
		let best = -1
		for (let k = j; k < ref.length && ref[k] <= e + tol; k++) {
			if (!used[k] && (best < 0 || Math.abs(ref[k] - e) < Math.abs(ref[best] - e))) best = k
		}
		if (best >= 0) {
			used[best] = 1
			offsets.push(e - ref[best])
		}
	}
	return { tp: offsets.length, fp: est.length - offsets.length, fn: ref.length - offsets.length, offsets }
}

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN)
const prf = ({ tp, fp, fn }) => {
	const p = tp / Math.max(1, tp + fp)
	const r = tp / Math.max(1, tp + fn)
	return { p, r, f: p + r ? (2 * p * r) / (p + r) : 0 }
}

function evaluate(dir, { tol = 50, only = null, opts = {}, shift = 0, cache = null } = {}) {
	const mixDir = path.join(dir, 'audio', 'full_mix')
	const total = Object.fromEntries(DRUMS.map((d) => [d, { tp: 0, fp: 0, fn: 0, offsets: [] }]))
	const rows = []
	for (const f of fs
		.readdirSync(mixDir)
		.filter((n) => n.endsWith('_MIX.wav'))
		.sort()) {
		const name = f.replace(/^MusicDelta_|_MIX\.wav$/g, '')
		if (only && !only.includes(name)) continue
		const ref = annotations(path.join(dir, 'annotations', 'class', f.replace('_MIX.wav', '_class.txt')))
		const est = replayHits(decode(path.join(mixDir, f), cache), RATE, { tune: opts })
		const row = { name }
		for (const d of DRUMS) {
			const m = match(
				ref[d],
				est[d].map((t) => t - shift),
				tol
			)
			row[d] = { ...prf(m), n: est[d].length, ref: ref[d].length }
			total[d].tp += m.tp
			total[d].fp += m.fp
			total[d].fn += m.fn
			total[d].offsets.push(...m.offsets)
		}
		rows.push(row)
	}
	const sum = Object.fromEntries(
		DRUMS.map((d) => [d, { ...prf(total[d]), ...total[d], offset: median(total[d].offsets) }])
	)
	return { rows, sum }
}

if (require.main === module) {
	const args = process.argv.slice(2)
	const flag = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
	const dir = args.find((a) => !a.startsWith('--'))
	if (!dir) {
		console.error(
			'usage: eval-drum-detector.js <MDB Drums dir> [--tol=50] [--only=Rock,Punk] [--opts=json] [--shift=ms] [--cache=dir]'
		)
		process.exit(2)
	}
	const { rows, sum } = evaluate(dir, {
		tol: Number(flag('tol') || 50),
		only: flag('only')?.split(','),
		opts: flag('opts') ? JSON.parse(flag('opts')) : {},
		shift: Number(flag('shift') || 0),
		cache: flag('cache') || null,
	})
	const pc = (x) => (x * 100).toFixed(0).padStart(3)
	for (const r of rows) {
		console.log(r.name.padEnd(12), DRUMS.map((d) => `${d} F${pc(r[d].f)} (${r[d].n}/${r[d].ref})`).join('  '))
	}
	for (const d of DRUMS) {
		const s = sum[d]
		console.log(
			`TOTAL ${d.padEnd(5)} P${pc(s.p)} R${pc(s.r)} F${pc(s.f)}  tp ${s.tp} fp ${s.fp} fn ${s.fn}  median offset ${s.offset.toFixed(0)} ms`
		)
	}
}

module.exports = { evaluate, match, annotations }

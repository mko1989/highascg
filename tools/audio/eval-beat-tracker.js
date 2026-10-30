#!/usr/bin/env node
'use strict'

/**
 * WO-872 — score the live beat tracker (src/audio/beat-detect.js) on GTZAN, the way fosfora / MIREX score theirs.
 *
 *   node tools/audio/eval-beat-tracker.js <dir> [--split=tune|holdout|all] [--jobs=4] [--genre=rock,pop]
 *                                          [--opts='{"k":2}'] [--out=results.json] [--baseline=results.json]
 *
 * <dir> holds genres/<genre>/<genre>.000NN.wav (GTZAN, huggingface.co/datasets/marsyas/gtzan) and gtzan_tempo_beat/
 * (github.com/TempoBeatDownbeat/gtzan_tempo_beat: beats/*.beats, tempo/*.bpm). Evaluation only, never committed.
 * Each clip is decoded to 48 kHz mono by ffmpeg and pushed 512 samples at a time, as audio-capture-fft.js does live;
 * a beat's time is when the tracker announces it (snapshot().n changes, minus its age) — causal, no look-ahead.
 * Scores (tools/audio/beat-metrics.js, mir_eval 0.8.2): beat F ±70 ms, CMLt, AMLt after a 5 s trim, and tempo
 * Acc1 / Acc2 of the tempo the tracker reports at the end of the clip. Split: even clip numbers tune, odd ones are
 * the holdout — tune on one, confirm on the other, so a gain is not a fit to the clips we looked at.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync, fork } = require('child_process')
const { createBeatDetector } = require('../../src/audio/beat-detect')
const { trimBeats, fMeasure, continuity, tempoAccuracy } = require('./beat-metrics')

const RATE = 48000
const HOP = 512

function decode(file) {
	const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], {
		maxBuffer: 1 << 30,
	})
	return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
}

/** Run the tracker over a clip: { beats: s[], bpm: last reported tempo, lockS: first beat of the final locked run }. */
function track(samples, opts) {
	const d = createBeatDetector({ sampleRate: RATE, ...opts })
	const beats = []
	let n = 0
	for (let i = 0; i + HOP <= samples.length; i += HOP) {
		d.push(samples.subarray(i, i + HOP))
		const s = d.snapshot()
		if (s.n !== n) {
			n = s.n
			beats.push((d.nowMs() - s.age) / 1000)
		}
	}
	return { beats, bpm: d.snapshot().bpm }
}

function readBeats(file) {
	return fs
		.readFileSync(file, 'utf8')
		.split('\n')
		.map((l) => parseFloat(l))
		.filter((t) => Number.isFinite(t))
}

function score(clip, opts) {
	const { beats, bpm } = track(decode(clip.wav), opts)
	const ref = trimBeats(readBeats(clip.beats))
	const est = trimBeats(beats)
	const refBpm = parseFloat(fs.readFileSync(clip.tempo, 'utf8'))
	const c = continuity(ref, est)
	const { acc1, acc2 } = tempoAccuracy(refBpm, bpm)
	return { id: clip.id, genre: clip.genre, f: fMeasure(ref, est), cmlt: c.cmlt, amlt: c.amlt, acc1, acc2, bpm, refBpm }
}

/** GTZAN ships one unreadable file (jazz.00054.wav): report it and leave it out of the means. */
function tryScore(clip, opts) {
	try {
		return score(clip, opts)
	} catch (e) {
		return { id: clip.id, genre: clip.genre, error: String(e.message).split('\n')[0] }
	}
}

function clips(dir, split, genres) {
	const out = []
	for (const g of fs.readdirSync(path.join(dir, 'genres')).sort()) {
		if (!fs.statSync(path.join(dir, 'genres', g)).isDirectory()) continue // .DS_Store in the archive
		if (genres && !genres.includes(g)) continue
		for (const f of fs.readdirSync(path.join(dir, 'genres', g)).sort()) {
			const m = /^(\w+)\.(\d{5})\.wav$/.exec(f)
			if (!m) continue
			const num = Number(m[2])
			if ((split === 'tune' && num % 2) || (split === 'holdout' && !(num % 2))) continue
			const id = `gtzan_${g}_${m[2]}`
			const beats = path.join(dir, 'gtzan_tempo_beat', 'beats', id + '.beats')
			const tempo = path.join(dir, 'gtzan_tempo_beat', 'tempo', id + '.bpm')
			if (fs.existsSync(beats) && fs.existsSync(tempo))
				out.push({ id, genre: g, wav: path.join(dir, 'genres', g, f), beats, tempo })
		}
	}
	return out
}

const KEYS = ['f', 'cmlt', 'amlt', 'acc1', 'acc2']
const mean = (rows, k) => rows.reduce((s, r) => s + r[k], 0) / Math.max(1, rows.length)

function summary(rows) {
	const line = (label, rs) =>
		`${label.padEnd(10)} ${String(rs.length).padStart(4)}  ` +
		KEYS.map((k) => mean(rs, k).toFixed(3).padStart(6)).join(' ')
	const lines = [`${'genre'.padEnd(10)} ${'n'.padStart(4)}  ${KEYS.map((k) => k.padStart(6)).join(' ')}`]
	for (const g of [...new Set(rows.map((r) => r.genre))])
		lines.push(
			line(
				g,
				rows.filter((r) => r.genre === g)
			)
		)
	lines.push(line('ALL', rows))
	return lines.join('\n')
}

async function runPool(list, opts, jobs) {
	if (jobs <= 1) return list.map((c) => tryScore(c, opts))
	const rows = []
	let next = 0
	await Promise.all(
		Array.from({ length: jobs }, () => {
			const child = fork(__filename, ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
			return new Promise((resolve, reject) => {
				const send = () => (next < list.length ? child.send({ clip: list[next++], opts }) : child.disconnect())
				child.on('message', (r) => {
					rows.push(r)
					send()
				})
				child.on('exit', (code) => (code ? reject(new Error(`worker exit ${code}`)) : resolve()))
				send()
			})
		})
	)
	const order = new Map(list.map((c, i) => [c.id, i]))
	return rows.sort((a, b) => order.get(a.id) - order.get(b.id))
}

async function main(argv) {
	const args = Object.fromEntries(
		argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2))
	)
	const dir = argv.find((a) => !a.startsWith('--'))
	if (!dir) {
		console.error(
			'usage: eval-beat-tracker.js <dir> [--split=tune|holdout|all] [--jobs=N] [--genre=a,b] [--opts=json] [--out=file] [--baseline=file]'
		)
		process.exit(2)
	}
	const list = clips(dir, args.split || 'tune', args.genre ? args.genre.split(',') : null)
	const t0 = Date.now()
	const all = await runPool(list, args.opts ? JSON.parse(args.opts) : {}, Number(args.jobs || 4))
	const rows = all.filter((r) => !r.error)
	for (const r of all) if (r.error) console.log(`skipped ${r.id}: ${r.error}`)
	console.log(summary(rows))
	console.log(`(${list.length} clips, split ${args.split || 'tune'}, ${((Date.now() - t0) / 1000).toFixed(0)} s)`)
	if (args.baseline) {
		const base = JSON.parse(fs.readFileSync(args.baseline, 'utf8')).rows
		const ids = new Set(rows.map((r) => r.id))
		const b = base.filter((r) => ids.has(r.id))
		console.log(
			'vs baseline: ' +
				KEYS.map(
					(k) => `${k} ${mean(rows, k) - mean(b, k) >= 0 ? '+' : ''}${(mean(rows, k) - mean(b, k)).toFixed(3)}`
				).join('  ')
		)
	}
	if (args.out)
		fs.writeFileSync(args.out, JSON.stringify({ split: args.split || 'tune', opts: args.opts || null, rows }, null, 1))
}

if (process.argv[2] === '--worker') {
	process.on('message', ({ clip, opts }) => process.send(tryScore(clip, opts)))
} else if (require.main === module) {
	main(process.argv.slice(2)).catch((e) => {
		console.error(e)
		process.exit(1)
	})
}

module.exports = { track, clips, summary }

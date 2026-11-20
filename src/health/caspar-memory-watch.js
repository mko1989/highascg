'use strict'

/**
 * Caspar memory watch. Caspar was OOM-killed on 20.11 at ~50 GB after two days (earlier runs: 30.7 GB in 3.6 h on
 * 13.11, 15 GB in 1.8 h on 17.11, while a 13 h run stayed at 2 GB). It balloons in bursts, and nothing recorded WHEN,
 * so the cause could not be tied to what Caspar was doing (every AMCP command is in its journal).
 *
 * Once a minute: Caspar's RSS → one line in ~/.highascg/log/caspar-memory.jsonl (about two days kept), and a warning
 * in the node log when it grows fast or crosses another tenth of RAM. Read-only: never restarts or throttles anything.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const SAMPLE_MS = 60_000
const GROWTH_WINDOW_MS = 10 * 60_000
const GROWTH_WARN_BYTES = 1024 ** 3 // ≥ 1 GiB in 10 min is a burst (a steady show sits flat, ±100 MB)
const KEEP_LINES = 3000 // two days of minutes
const GiB = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`

/**
 * PURE. Feed samples, get the warnings they warrant.
 * @param {{ windowMs?: number, growWarnBytes?: number }} [o]
 */
function createMemoryTrend({ windowMs = GROWTH_WINDOW_MS, growWarnBytes = GROWTH_WARN_BYTES } = {}) {
	let hist = []
	let pid = null
	let lastGrowthWarnAt = -Infinity
	let ramStep = 0
	return {
		/** @returns {string[]} warning lines */
		step({ at, pid: p, rss, totalRam }) {
			const out = []
			if (p !== pid) {
				hist = []
				pid = p
				ramStep = 0
			}
			hist.push({ at, rss })
			while (hist.length > 1 && hist[0].at < at - windowMs) hist.shift()
			const low = hist.reduce((m, s) => (s.rss < m.rss ? s : m), hist[0])
			if (rss - low.rss >= growWarnBytes && at - lastGrowthWarnAt >= windowMs) {
				lastGrowthWarnAt = at
				out.push(`Caspar memory grew ${GiB(rss - low.rss)} in ${Math.round((at - low.at) / 60_000)} min (now ${GiB(rss)}, pid ${p}) — see its journal for what it was doing since ${new Date(low.at).toTimeString().slice(0, 8)}`)
			}
			const step = totalRam > 0 ? Math.floor((rss / totalRam) * 10) : 0
			if (step >= 3 && step > ramStep) out.push(`Caspar uses ${GiB(rss)} = ${step * 10}%+ of RAM (pid ${p}) — the kernel kills it near 100%`)
			ramStep = Math.max(ramStep, step)
			return out
		},
	}
}

function startCasparMemoryWatch(ctx, opts = {}) {
	if (process.env.NODE_TEST_CONTEXT && !opts.readRss) return { stop() {} }
	const file = opts.file || path.join(os.homedir(), '.highascg', 'log', 'caspar-memory.jsonl')
	const ps = require('../system/proc-stats')
	const readRss = opts.readRss || (async () => {
		const p = await ps.getCasparPidCached()
		const s = p ? ps.readProcSampleSync(p) : null
		return s?.rssBytes ? { pid: p, rss: s.rssBytes } : null
	})
	const trend = createMemoryTrend()
	let lines = 0
	const tick = async () => {
		const s = await readRss().catch(() => null)
		if (!s) return
		const at = Date.now()
		for (const w of trend.step({ at, pid: s.pid, rss: s.rss, totalRam: os.totalmem() })) ctx?.log?.('warn', `[caspar-memory] ${w}`)
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true })
			fs.appendFileSync(file, `${JSON.stringify({ t: new Date(at).toISOString(), pid: s.pid, rssMB: Math.round(s.rss / 1024 ** 2) })}\n`)
			if (++lines % 500 === 0) {
				const all = fs.readFileSync(file, 'utf8').trimEnd().split('\n')
				if (all.length > KEEP_LINES) fs.writeFileSync(file, `${all.slice(-KEEP_LINES).join('\n')}\n`)
			}
		} catch {
			/* the log dir is optional */
		}
	}
	const timer = setInterval(() => void tick(), opts.sampleMs || SAMPLE_MS)
	timer.unref?.()
	void tick()
	return { stop: () => clearInterval(timer), tick }
}

module.exports = { createMemoryTrend, startCasparMemoryWatch }

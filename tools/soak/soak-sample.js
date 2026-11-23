'use strict'
/**
 * Process / GPU memory sampler for the Caspar leak soak (tools/soak/caspar-leak-soak.js).
 * Reads /proc directly (no ps) and nvidia-smi for per-process GPU memory.
 */

const fs = require('fs')
const { execFileSync } = require('child_process')

const KB = (s, key) => {
	const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(s)
	return m ? Number(m[1]) : null
}

function readCmdline(pid) {
	try {
		const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
		// Chromium (CEF children) rewrites its process title: one space-joined string instead of NUL-separated argv.
		return argv.length === 1 && argv[0].includes(' --') ? argv[0].split(' ') : argv
	} catch {
		return null
	}
}

/** Caspar main process + its CEF children (same binary, `--type=` argv). */
function findCaspar() {
	let main = null
	const cef = []
	for (const d of fs.readdirSync('/proc')) {
		if (!/^\d+$/.test(d)) continue
		const argv = readCmdline(d)
		if (!argv || !argv[0] || !/\/bin\/casparcg$/.test(argv[0])) continue
		const type = argv.find((a) => a.startsWith('--type='))
		if (type) cef.push({ pid: Number(d), type: type.slice(7) })
		else if (!main || Number(d) < main) main = Number(d)
	}
	return { main, cef }
}

function nodeMainPid() {
	try {
		const out = execFileSync('systemctl', ['show', 'highascg', '-p', 'MainPID', '--value'], { encoding: 'utf8' })
		const p = Number(out.trim())
		return p > 1 ? p : null
	} catch {
		return null
	}
}

function procStatus(pid) {
	try {
		const s = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
		return {
			rss: KB(s, 'VmRSS'),
			anon: KB(s, 'RssAnon'),
			file: KB(s, 'RssFile'),
			shmem: KB(s, 'RssShmem'),
			swap: KB(s, 'VmSwap'),
			threads: KB(s, 'Threads'),
		}
	} catch {
		return null
	}
}

function countDir(path) {
	try {
		return fs.readdirSync(path).length
	} catch {
		return null
	}
}

function mapCount(pid) {
	try {
		return fs.readFileSync(`/proc/${pid}/maps`, 'utf8').split('\n').length - 1
	} catch {
		return null
	}
}

/** { gpuUsedMiB, perPid: {pid: MiB} } — `-q -d PIDS` lists graphics (G) processes too, unlike --query-compute-apps. */
function gpu() {
	const out = { gpuUsedMiB: null, perPid: {} }
	try {
		const q = execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], {
			encoding: 'utf8',
			timeout: 10000,
		})
		out.gpuUsedMiB = Number(q.split('\n')[0].trim())
		const p = execFileSync('nvidia-smi', ['-q', '-d', 'PIDS'], { encoding: 'utf8', timeout: 10000 })
		let cur = null
		for (const line of p.split('\n')) {
			const a = /Process ID\s*:\s*(\d+)/.exec(line)
			if (a) cur = Number(a[1])
			const b = /Used GPU Memory\s*:\s*(\d+)\s*MiB/.exec(line)
			if (b && cur != null) out.perPid[cur] = Number(b[1])
		}
	} catch {
		/* nvidia-smi hiccup: leave nulls */
	}
	return out
}

function memAvailableKB() {
	try {
		return KB(fs.readFileSync('/proc/meminfo', 'utf8'), 'MemAvailable')
	} catch {
		return null
	}
}

/** One CSV row worth of numbers. Column order = SAMPLE_COLUMNS. */
function sample() {
	const { main, cef } = findCaspar()
	const st = main ? procStatus(main) : null
	const g = gpu()
	let cefRss = 0
	let cefGpuProcRss = null
	for (const c of cef) {
		const s = procStatus(c.pid)
		if (!s) continue
		cefRss += s.rss || 0
		if (c.type === 'gpu-process') cefGpuProcRss = s.rss
	}
	const nodePid = nodeMainPid()
	const ns = nodePid ? procStatus(nodePid) : null
	const godot = execPgrep('godot')
	return {
		casparPid: main,
		rssKB: st?.rss ?? null,
		anonKB: st?.anon ?? null,
		fileKB: st?.file ?? null,
		shmemKB: st?.shmem ?? null,
		swapKB: st?.swap ?? null,
		threads: st?.threads ?? null,
		fds: main ? countDir(`/proc/${main}/fd`) : null,
		maps: main ? mapCount(main) : null,
		casparGpuMiB: main != null ? (g.perPid[main] ?? null) : null,
		gpuUsedMiB: g.gpuUsedMiB,
		cefProcs: cef.length,
		cefRssKB: cefRss,
		cefGpuProcRssKB: cefGpuProcRss,
		nodePid,
		nodeRssKB: ns?.rss ?? null,
		godotGpuMiB: godot != null ? (g.perPid[godot] ?? null) : null,
		memAvailKB: memAvailableKB(),
	}
}

function execPgrep(name) {
	try {
		const p = Number(execFileSync('pgrep', ['-xo', name], { encoding: 'utf8' }).trim())
		return p > 1 ? p : null
	} catch {
		return null
	}
}

const SAMPLE_COLUMNS = Object.keys({
	casparPid: 0,
	rssKB: 0,
	anonKB: 0,
	fileKB: 0,
	shmemKB: 0,
	swapKB: 0,
	threads: 0,
	fds: 0,
	maps: 0,
	casparGpuMiB: 0,
	gpuUsedMiB: 0,
	cefProcs: 0,
	cefRssKB: 0,
	cefGpuProcRssKB: 0,
	nodePid: 0,
	nodeRssKB: 0,
	godotGpuMiB: 0,
	memAvailKB: 0,
})

/**
 * Rss per mapping class from /proc/<pid>/smaps: [heap], [anon], /dev/nvidia*, memfd:…, file paths.
 * Diffing two snapshots shows WHERE growth lands (malloc heap vs driver mappings vs shm).
 */
function smapsByMapping(pid) {
	let text
	try {
		text = fs.readFileSync(`/proc/${pid}/smaps`, 'utf8')
	} catch {
		return null
	}
	const agg = {}
	let key = null
	for (const line of text.split('\n')) {
		const hdr = /^[0-9a-f]+-[0-9a-f]+\s+\S+\s+\S+\s+\S+\s+\d+\s*(.*)$/.exec(line)
		if (hdr) {
			const path = hdr[1].trim()
			key = !path ? '[anon]' : path.replace(/ \(deleted\)$/, '')
			if (/^\/dev\/nvidia/.test(key)) key = key.replace(/\d+$/, 'N')
			if (/^memfd:/.test(key)) key = key.replace(/[0-9a-f-]{8,}/gi, '*')
			if (/^\[stack:/.test(key)) key = '[stack:tid]'
			if (!agg[key]) agg[key] = { rssKB: 0, count: 0 }
			agg[key].count++
			continue
		}
		const r = /^Rss:\s+(\d+)/.exec(line)
		if (r && key) agg[key].rssKB += Number(r[1])
	}
	return agg
}

module.exports = { sample, SAMPLE_COLUMNS, smapsByMapping, findCaspar }

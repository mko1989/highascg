/**
 * Per-process CPU% / RSS via `/proc/<pid>/stat` + `/proc/<pid>/status` (Linux only — this is a
 * Linux appliance, no Windows/macOS fallback needed). Used by `src/api/routes-host-stats.js`
 * (WO-165) to show CasparCG + HighAsCG usage in the status-eye hover tooltip.
 *
 * CPU% method (pick-one, documented per WO-165 T165.1):
 *   - If we already have a sample for this pid that is >=100ms old, CPU% is computed from the
 *     delta between that sample and a fresh one (ticks-of-CPU-time / wall-time-elapsed). This is
 *     the common case: the client throttles polling to one fetch per ~2.5s (see
 *     `FETCH_MIN_MS` in client/components/connection-eye.js), so by the time a second poll comes
 *     in there is always a healthy delta window to average over.
 *   - On the very first observation of a pid (no prior sample, e.g. right after server start or
 *     right after CasparCG's pid changes), there is nothing to diff against yet, so we take two
 *     samples ~200ms apart synchronously and diff those instead. This costs one extra ~200ms of
 *     latency on the first hover only; every subsequent poll for that pid uses the fast
 *     delta-since-last-call path.
 *
 * PID discovery for CasparCG:
 *   - `systemctl show --property=MainPID --value <unit>` for the caspar systemd unit. On this
 *     rig the unit is `casparcg-server.service` (confirmed via `systemctl list-units`).
 *   - IMPORTANT: `MainPID` for `casparcg-server.service` is the shell supervisor
 *     (`run.sh`, see scripts/systemd/casparcg-server.service + run.sh), NOT the casparcg
 *     binary itself — the binary is a child process. So after resolving MainPID we check
 *     whether *that* pid is actually the casparcg binary (comm === 'casparcg', no `--type=`
 *     flag — CEF spawns zygote/gpu-process/utility helper children that also report
 *     comm === 'casparcg'); if not, we scan for the real casparcg child (preferring a direct
 *     child of MainPID, matching real-world process tree), then fall back to a full /proc scan.
 *   - The resolved pid is cached with a short TTL and is immediately re-discovered if the
 *     cached pid's /proc entry vanishes (caspar restarted/crashed).
 */

'use strict'

const fs = require('fs')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)

/** Linux USER_HZ (clock ticks/sec used by /proc/<pid>/stat utime+stime). 100 on effectively all
 * modern Linux (x86/arm) kernels; there is no portable way to read sysconf(_SC_CLK_TCK) from
 * pure Node without a native addon, so this is a documented constant rather than probed. */
const PROC_CLK_TCK = 100

const CASPAR_UNIT = 'casparcg-server.service'
const CASPAR_PID_TTL_MS = 5000
const CPU_BOOTSTRAP_DELAY_MS = 200
/** Below this, a delta-based reading would be too noisy (huge tick/ms swings) — bootstrap instead. */
const MIN_DELTA_WINDOW_MS = 100

/**
 * Parse the numeric fields of `/proc/<pid>/stat` that follow the `(comm)` field. The comm field
 * is parenthesized and may itself contain spaces or parens (e.g. a process renamed to
 * "my (weird) name"), so we split on the *last* ')' in the line rather than naive whitespace
 * splitting, per `proc(5)`.
 * @param {string} statText raw contents of /proc/<pid>/stat
 * @returns {{ utime: number, stime: number, ppid: number|null } | null}
 */
function parseStatFields(statText) {
	const text = String(statText || '')
	const lastParen = text.lastIndexOf(')')
	if (lastParen === -1) return null
	const rest = text.slice(lastParen + 1).trim()
	if (!rest) return null
	const fields = rest.split(/\s+/)
	// After "pid (comm)", the remaining fields (0-indexed here) are:
	// 0 state, 1 ppid, 2 pgrp, 3 session, 4 tty_nr, 5 tpgid, 6 flags, 7 minflt, 8 cminflt,
	// 9 majflt, 10 cmajflt, 11 utime, 12 stime, ...
	if (fields.length < 13) return null
	const utime = parseInt(fields[11], 10)
	const stime = parseInt(fields[12], 10)
	if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null
	const ppidNum = parseInt(fields[1], 10)
	return { utime, stime, ppid: Number.isFinite(ppidNum) ? ppidNum : null }
}

/**
 * Parse `VmRSS` (in kB, per proc(5)) out of `/proc/<pid>/status` contents.
 * @param {string} statusText raw contents of /proc/<pid>/status
 * @returns {number|null} VmRSS in kB, or null if not found/parseable
 */
function parseVmRssKb(statusText) {
	const m = String(statusText || '').match(/^VmRSS:\s+(\d+)\s*kB/m)
	if (!m) return null
	const n = parseInt(m[1], 10)
	return Number.isFinite(n) ? n : null
}

/**
 * CPU% from two ticks-of-cpu-time samples take `dtMs` apart.
 * @param {{ utime: number, stime: number, atMs: number }} prev
 * @param {{ utime: number, stime: number, atMs: number }} cur
 * @param {number} [hz]
 * @returns {number} percent, one decimal place, clamped to >= 0
 */
function computeCpuPct(prev, cur, hz = PROC_CLK_TCK) {
	const dtMs = cur.atMs - prev.atMs
	if (!(dtMs > 0)) return 0
	const ticks = cur.utime + cur.stime - (prev.utime + prev.stime)
	if (!(ticks >= 0)) return 0 // clock/pid reuse anomaly — don't report garbage
	const pct = (ticks / hz / (dtMs / 1000)) * 100
	return Math.round(pct * 10) / 10
}

/**
 * Synchronous read of one pid's current CPU-ticks + RSS. Sync is fine here: this only runs on a
 * hover-triggered poll (throttled client-side), never in a hot loop, and keeps the two file reads
 * consistent with each other (no interleaving with other async work mid-read).
 * @param {number} pid
 * @returns {{ utime: number, stime: number, rssBytes: number|null }|null}
 */
function readProcSampleSync(pid) {
	const statText = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
	const fields = parseStatFields(statText)
	if (!fields) return null
	return { utime: fields.utime, stime: fields.stime, rssBytes: readVmRssBytesSync(pid) }
}

/** @returns {number|null} */
function readVmRssBytesSync(pid) {
	try {
		const kb = parseVmRssKb(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))
		return kb != null ? kb * 1024 : null
	} catch {
		return null
	}
}

function readCommSync(pid) {
	try {
		return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
	} catch {
		return null
	}
}

function readCmdlineSync(pid) {
	try {
		return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
	} catch {
		return null
	}
}

function readPpidSync(pid) {
	try {
		const fields = parseStatFields(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'))
		return fields ? fields.ppid : null
	} catch {
		return null
	}
}

/** True if `pid` is the actual casparcg server binary (not a CEF zygote/gpu/utility helper, which
 * also reports comm === 'casparcg' but carries a `--type=` flag). */
function isCasparBinaryProcess(pid) {
	if (readCommSync(pid) !== 'casparcg') return false
	const cmdline = readCmdlineSync(pid) || ''
	return !cmdline.includes('--type=')
}

/**
 * Scan `/proc` for the real casparcg binary process, preferring a direct child of
 * `preferredPpid` (the systemd MainPID, if it turned out to be a supervisor/wrapper rather than
 * the binary itself); falls back to the lowest matching pid anywhere.
 * @param {number|null} preferredPpid
 * @returns {number|null}
 */
function findCasparcgProcess(preferredPpid) {
	let entries
	try {
		entries = fs.readdirSync('/proc')
	} catch {
		return null
	}
	const candidates = []
	for (const entry of entries) {
		if (!/^\d+$/.test(entry)) continue
		const pid = parseInt(entry, 10)
		if (isCasparBinaryProcess(pid)) candidates.push(pid)
	}
	if (!candidates.length) return null
	if (preferredPpid != null) {
		const directChild = candidates.find((pid) => readPpidSync(pid) === preferredPpid)
		if (directChild != null) return directChild
	}
	candidates.sort((a, b) => a - b)
	return candidates[0]
}

/**
 * Resolve the CasparCG server pid: systemd MainPID first, with a /proc cmdline-scan fallback
 * (see module doc comment for why MainPID alone is not enough on this rig).
 * @param {string} [unitName]
 * @returns {Promise<number|null>}
 */
async function discoverCasparPid(unitName = CASPAR_UNIT) {
	let mainPid = null
	try {
		const { stdout } = await execFileAsync(
			'systemctl',
			['show', '--property=MainPID', '--value', unitName],
			{ timeout: 3000 },
		)
		const n = parseInt(String(stdout).trim(), 10)
		if (Number.isFinite(n) && n > 0) mainPid = n
	} catch {
		// systemd unavailable, unit missing, or the query timed out — fall through to /proc scan.
	}

	if (mainPid && isCasparBinaryProcess(mainPid)) return mainPid
	return findCasparcgProcess(mainPid)
}

/** @type {{ pid: number|null, at: number }} */
let _casparPidCache = { pid: null, at: 0 }

/**
 * Cached CasparCG pid lookup — mirrors the TTL-cache pattern used for GPU stats in
 * routes-host-stats.js (`_gpuCache`/`GPU_TTL_MS`), plus immediate re-discovery if the cached pid's
 * /proc entry has vanished (caspar restarted or crashed) regardless of TTL.
 * @returns {Promise<number|null>}
 */
async function getCasparPidCached() {
	const now = Date.now()
	if (_casparPidCache.pid != null && fs.existsSync(`/proc/${_casparPidCache.pid}`)) {
		if (now - _casparPidCache.at < CASPAR_PID_TTL_MS) return _casparPidCache.pid
	}
	const pid = await discoverCasparPid(CASPAR_UNIT)
	_casparPidCache = { pid, at: now }
	return pid
}

/** Test-only: reset cached PID/sample state between unit tests. */
function _resetCachesForTest() {
	_casparPidCache = { pid: null, at: 0 }
	_lastSample.clear()
}

/** @type {Map<number, { utime: number, stime: number, atMs: number }>} */
const _lastSample = new Map()

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/** @returns {{ utime: number, stime: number, rssBytes: number|null }|null} */
function safeReadProcSampleSync(pid) {
	try {
		return readProcSampleSync(pid)
	} catch {
		return null
	}
}

/**
 * CPU% + RSS for one pid, using the module-level last-sample cache described in the file header.
 * Null-safe: returns null if the pid can't be read (process gone, permission denied, etc).
 * @param {number} pid
 * @returns {Promise<{ pid: number, cpuPct: number|null, rssBytes: number|null }|null>}
 */
async function getProcessUsage(pid) {
	if (pid == null) return null
	const cur = safeReadProcSampleSync(pid)
	if (!cur) return null

	const now = Date.now()
	const prev = _lastSample.get(pid)

	if (prev && now - prev.atMs >= MIN_DELTA_WINDOW_MS) {
		const cpuPct = computeCpuPct(prev, { utime: cur.utime, stime: cur.stime, atMs: now })
		_lastSample.set(pid, { utime: cur.utime, stime: cur.stime, atMs: now })
		return { pid, cpuPct, rssBytes: cur.rssBytes }
	}

	// First observation of this pid (or polled again too soon to have a useful delta) — bootstrap
	// with a short second sample so the caller still gets a real number, not null/0.
	await sleep(CPU_BOOTSTRAP_DELAY_MS)
	const cur2 = safeReadProcSampleSync(pid)
	if (!cur2) {
		_lastSample.set(pid, { utime: cur.utime, stime: cur.stime, atMs: now })
		return { pid, cpuPct: null, rssBytes: cur.rssBytes }
	}
	const now2 = Date.now()
	const cpuPct = computeCpuPct(
		{ utime: cur.utime, stime: cur.stime, atMs: now },
		{ utime: cur2.utime, stime: cur2.stime, atMs: now2 },
	)
	_lastSample.set(pid, { utime: cur2.utime, stime: cur2.stime, atMs: now2 })
	return { pid, cpuPct, rssBytes: cur2.rssBytes }
}

module.exports = {
	PROC_CLK_TCK,
	CASPAR_UNIT,
	parseStatFields,
	parseVmRssKb,
	computeCpuPct,
	readProcSampleSync,
	discoverCasparPid,
	getCasparPidCached,
	getProcessUsage,
	_resetCachesForTest,
}

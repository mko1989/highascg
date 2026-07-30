'use strict'

/**
 * hardware-info-xrandr.js — every `xrandr` probe, its parser, and its cache.
 *
 * Split out of hardware-info.js in WO-391c: that file hit the 500-line CI limit once the cache grew
 * a failure-backoff policy. The cut is along the natural seam — this module owns "talk to X and
 * remember the answer", hardware-info.js owns "turn that into display/GPU inventory". The cache
 * state is module-level, so it MUST stay in one module: two copies would double the exec traffic
 * this WO exists to remove.
 *
 * hardware-info.js re-exports the public names, so no caller changed.
 */

const { execSync, execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)

/**
 * Both xrandr probes are execSync on the `GET /api/device-view` path, so they block the entire
 * single-threaded server -- AMCP, every WS client, every other route -- for their full duration,
 * not just the Devices view. They were the only sync probes in the codebase with no timeout at all
 * (nvidia-smi below uses 2000, decklink-enum 1500-2000, audio-devices 5000-8000), which meant a
 * wedged or unreachable X server would hang the whole process indefinitely with no recovery.
 * Measured healthy cost on the operator box: xrandr --query ~75-90ms, --verbose ~72ms. 3s is a
 * generous ceiling for a far slower machine while still bounding the pathological case.
 */
const XRANDR_TIMEOUT_MS = 3000

/**
 * Parse `xrandr --query` into connected outputs with geometry, current refresh, and listed modes.
 * @returns {Array<{
 *   name: string,
 *   connected: boolean,
 *   resolution: string,
 *   x: number,
 *   y: number,
 *   refreshHz: number | null,
 *   modes: Array<{ width: number, height: number, hz: number, current: boolean }>
 * }> | null}
 */
function getXAuthority() {
	if (process.env.XAUTHORITY) return process.env.XAUTHORITY
	const user = process.env.USER || 'casparcg'
	return `/home/${user}/.Xauthority`
}

/**
 * WO-391c: now CACHED (it was not — every caller paid a full blocking `execSync`, and
 * `xrandr --verbose` reads EDID from every output, so a loop over it hammers the same X server
 * Caspar renders on). Shares the TTL/backoff policy of the `--query` cache and is cleared by
 * {@link invalidateXrandrCache}.
 */
function getDisplaysXrandrVerboseRaw() {
	if (xrandrCacheFresh(_xrandrVerboseCache)) {
		return _xrandrVerboseCache.value
	}
	try {
		const out = execSync('xrandr --verbose', {
			stdio: ['ignore', 'pipe', 'ignore'],
			env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() },
			timeout: XRANDR_TIMEOUT_MS,
		}).toString()
		_xrandrVerboseCache = { at: Date.now(), value: out, failed: !String(out || '').trim() }
		return out
	} catch (e) {
		console.error(`[Hardware-Info] getDisplaysXrandrVerboseRaw failed:`, e.message)
		/* Cache the FAILURE so a wedged X server costs one blocking timeout per backoff window,
		 * not one every TTL. Returning '' is the pre-existing contract. */
		_xrandrVerboseCache = { at: Date.now(), value: '', failed: true }
		return ''
	}
}

/**
 * WO-309: non-blocking sibling of {@link getDisplaysXrandrVerboseRaw}. Same command, same env,
 * same timeout — only the exec call itself is async (execFile, not execSync) so a devices-view
 * request awaiting this does not freeze AMCP/WS/every other route for the ~70ms this normally
 * takes (or up to XRANDR_TIMEOUT_MS on a wedged X server).
 * @returns {Promise<string>}
 */
async function getDisplaysXrandrVerboseRawAsync() {
	/* WO-391c: shares `_xrandrVerboseCache` with the sync path, exactly as the two `--query` paths
	 * share `_xrandrCache` — whichever populates it first, the other gets a fast hit. */
	if (xrandrCacheFresh(_xrandrVerboseCache)) {
		return _xrandrVerboseCache.value
	}
	try {
		const { stdout } = await execFileAsync('xrandr', ['--verbose'], {
			env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() },
			timeout: XRANDR_TIMEOUT_MS,
		})
		const out = stdout.toString()
		_xrandrVerboseCache = { at: Date.now(), value: out, failed: !String(out || '').trim() }
		return out
	} catch (e) {
		console.error(`[Hardware-Info] getDisplaysXrandrVerboseRawAsync failed:`, e.message)
		_xrandrVerboseCache = { at: Date.now(), value: '', failed: true }
		return ''
	}
}

/**
 * Parse `xrandr --query` text into display rows (connected heads only).
 * @param {string} stdout
 * @returns {{ displays: object[], raw: string }}
 */
function parseXrandrQueryRaw(stdout) {
	const lines = String(stdout || '').split('\n')
	const displays = []
	let cur = null

	function pushCur() {
		if (cur && cur.connected) displays.push(cur)
		cur = null
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const head = line.match(/^(\S+)\s+(connected|disconnected)\b/)
		if (head) {
			pushCur()
			const name = head[1]
			const connected = head[2] === 'connected'
			if (!connected) continue
			cur = {
				name,
				connected: true,
				resolution: 'unknown',
				x: 0,
				y: 0,
				refreshHz: null,
				modes: [],
			}
			const geom = line.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/)
			if (geom) {
				cur.resolution = `${geom[1]}x${geom[2]}`
				cur.x = parseInt(geom[3], 10)
				cur.y = parseInt(geom[4], 10)
			}
			continue
		}
		if (cur && cur.connected && /^\s/.test(line) && /\d+x\d+/.test(line)) {
			const full = line.match(/^\s+(\S+)\s+(.+)$/)
			if (full) {
				const modeToken = full[1]
				if (/^\d+x\d+/i.test(modeToken)) {
					const dim = modeToken.match(/^(\d+)x(\d+)/i)
					if (dim) {
						const w = parseInt(dim[1], 10)
						const h = parseInt(dim[2], 10)
						const rest = full[2]
						const tokens = rest.trim().split(/\s+/)
						for (const tok of tokens) {
							const hz = parseFloat(tok.replace(/[^0-9.]/g, ''))
							if (!Number.isFinite(hz) || hz <= 0) continue
							const isCurrent = tok.includes('*')
							const key = `${modeToken}@${hz}`
							if (!cur.modes.some((x) => `${x.randrMode}@${x.hz}` === key)) {
								cur.modes.push({
									width: w,
									height: h,
									hz,
									current: isCurrent,
									randrMode: modeToken,
								})
							}
							if (isCurrent) cur.refreshHz = hz
						}
					}
				}
			}
		}
	}
	pushCur()
	return { displays, raw: String(stdout || '') }
}

/**
 * `xrandr --query` hits the live X server (the one Caspar's screen consumers render on);
 * uncached calls several times per second visibly stutter playout — and EVERY spawn freezes
 * the X input pipeline ~180 ms (WO-397, probe-measured). Call {@link invalidateXrandrCache}
 * after applying a new layout.
 *
 * WO-397: the TTL must exceed the SLOWEST periodic caller, or that caller misses on every
 * tick. The old 3 s TTL vs the 8 s confine watchdog + ~30 s OS-Config layout watchdog meant
 * two guaranteed X freezes every 8 s — the owner's "small lags of mouse". 60 s makes the
 * periodic checkers ride the cache; layout applies invalidate explicitly, so a real change
 * is never served stale.
 */
const XRANDR_CACHE_TTL_MS = Math.max(
	0,
	parseInt(process.env.HIGHASCG_XRANDR_CACHE_TTL_MS || '60000', 10) || 60000,
)

/**
 * WO-391c: how long to sit out after an xrandr call FAILED, rather than retrying at the normal TTL.
 *
 * The bug this fixes, measured live 30.07 (10 lines, 12:53:37→12:54:04, ~3 s apart):
 *   [Hardware-Info] getDisplaysXrandrVerboseRaw failed: spawnSync /bin/sh ETIMEDOUT
 *   [Hardware-Info] getDisplaysXrandrDetailed failed: spawnSync /bin/sh ETIMEDOUT
 * `XRANDR_TIMEOUT_MS` and `XRANDR_CACHE_TTL_MS` are BOTH 3000, so a wedged X server produced: block
 * 3 s in execSync → time out → cache the fallback for 3 s → block 3 s again. The node event loop
 * was unavailable roughly half the time, and each retry re-hammered an X server that was already
 * struggling — with `--verbose`, which reads EDID from every output.
 *
 * A wedged or absent X server does not recover inside one TTL, so a failure is worth a longer
 * pause than a success. Successes keep the normal TTL;
 * `invalidateXrandrCache()` clears the backoff, so an explicit layout apply is never delayed by it.
 */
const XRANDR_FAILURE_BACKOFF_MS = Math.max(
	XRANDR_CACHE_TTL_MS,
	parseInt(process.env.HIGHASCG_XRANDR_FAILURE_BACKOFF_MS || '30000', 10) || 30000,
)

/** @type {{ at: number, value: object | null, failed?: boolean } | null} */
let _xrandrCache = null
/** WO-391c: `xrandr --verbose` had NO cache at all — every caller paid a full blocking exec. */
/** @type {{ at: number, value: string, failed?: boolean } | null} */
let _xrandrVerboseCache = null

/** Fresh while a success is inside the short TTL, or a FAILURE is inside the long backoff. */
function xrandrCacheFresh(entry) {
	if (!entry) return false
	const ttl = entry.failed ? XRANDR_FAILURE_BACKOFF_MS : XRANDR_CACHE_TTL_MS
	return Date.now() - entry.at < ttl
}

function invalidateXrandrCache() {
	_xrandrCache = null
	_xrandrVerboseCache = null
	try {
		const { invalidateGpuEdidCache } = require('./gpu-edid-probe')
		invalidateGpuEdidCache()
	} catch {
		/* optional */
	}
}

function getDisplaysXrandrDetailed() {
	if (xrandrCacheFresh(_xrandrCache)) {
		return _xrandrCache.value
	}
	const { value, failed } = getDisplaysXrandrDetailedUncached()
	_xrandrCache = { at: Date.now(), value, failed }
	return value
}

/** Shared by the sync and async xrandr-query paths — file read only, never blocks on a process. */
function readBootXrandrSnapshotParsed() {
	try {
		const { readBootXrandrSnapshot } = require('./boot-xrandr-snapshot')
		const boot = readBootXrandrSnapshot()
		if (boot?.raw) {
			const parsed = parseXrandrQueryRaw(boot.raw)
			return { ...parsed, source: 'boot-snapshot', bootPath: boot.path }
		}
	} catch {
		/* optional */
	}
	return null
}

/**
 * WO-391c: returns `{ value, failed }` — module-private, single caller. `failed` drives
 * {@link XRANDR_FAILURE_BACKOFF_MS} so a wedged X server is not re-probed (blockingly) every TTL.
 * Falling back to the boot snapshot still counts as FAILED: the live probe did not answer, which is
 * exactly the condition worth backing off from.
 * @returns {{ value: object | null, failed: boolean }}
 */
function getDisplaysXrandrDetailedUncached() {
	try {
		const stdout = execSync('xrandr --query', {
			stdio: ['ignore', 'pipe', 'ignore'],
			env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() },
			timeout: XRANDR_TIMEOUT_MS,
		}).toString()
		if (String(stdout || '').trim()) {
			return { value: parseXrandrQueryRaw(stdout), failed: false }
		}
	} catch (e) {
		console.error(`[Hardware-Info] getDisplaysXrandrDetailed failed:`, e.message)
	}

	const boot = readBootXrandrSnapshotParsed()
	if (boot) return { value: boot, failed: true }

	return { value: null, failed: true }
}

/** In-flight de-dup so a burst of concurrent requests during a cold cache fires ONE exec, not N. */
let _xrandrDetailedInFlight = null

/**
 * WO-309: non-blocking sibling of {@link getDisplaysXrandrDetailed}. Shares the SAME
 * `_xrandrCache` — whichever path (sync or async) populates it first, the other gets a fast hit —
 * and the same {@link invalidateXrandrCache}. Use this from any request-path caller that can
 * await; the sync version stays for callers that genuinely cannot (bootstrap scripts, layout math
 * called from deep inside synchronous config-generation code) and were never the measured problem
 * (only GET /api/device-view was — see the module header).
 * @returns {Promise<object | null>}
 */
async function getDisplaysXrandrDetailedAsync() {
	if (xrandrCacheFresh(_xrandrCache)) {
		return _xrandrCache.value
	}
	if (_xrandrDetailedInFlight) return _xrandrDetailedInFlight
	_xrandrDetailedInFlight = (async () => {
		let value = null
		try {
			const { stdout } = await execFileAsync('xrandr', ['--query'], {
				env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() },
				timeout: XRANDR_TIMEOUT_MS,
			})
			if (String(stdout || '').trim()) value = parseXrandrQueryRaw(stdout.toString())
		} catch (e) {
			console.error(`[Hardware-Info] getDisplaysXrandrDetailedAsync failed:`, e.message)
		}
		/* WO-391c: no live answer → mark FAILED so the long backoff applies, same as the sync path. */
		const failed = !value
		if (!value) value = readBootXrandrSnapshotParsed()
		_xrandrCache = { at: Date.now(), value, failed }
		return value
	})()
	try {
		return await _xrandrDetailedInFlight
	} finally {
		_xrandrDetailedInFlight = null
	}
}

module.exports = {
	XRANDR_TIMEOUT_MS,
	XRANDR_CACHE_TTL_MS,
	XRANDR_FAILURE_BACKOFF_MS,
	getXAuthority,
	getDisplaysXrandrVerboseRaw,
	getDisplaysXrandrVerboseRawAsync,
	/* parseXrandrQueryRaw is deliberately NOT exported — it is only ever used by the probes in this
	 * file, and the WO-367 gate correctly flagged exporting it as an unreferenced surface. */
	invalidateXrandrCache,
	getDisplaysXrandrDetailed,
	getDisplaysXrandrDetailedAsync,
}

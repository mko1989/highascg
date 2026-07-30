'use strict'

/**
 * WO-391c — xrandr must not block the node event loop over and over.
 *
 * Measured live 30.07, ten lines between 12:53:37 and 12:54:04, ~3 s apart:
 *   [Hardware-Info] getDisplaysXrandrVerboseRaw failed: spawnSync /bin/sh ETIMEDOUT
 *   [Hardware-Info] getDisplaysXrandrDetailed failed: spawnSync /bin/sh ETIMEDOUT
 *
 * Two defects behind that:
 *   1. `XRANDR_TIMEOUT_MS` and `XRANDR_CACHE_TTL_MS` are BOTH 3000, so a wedged X server gave
 *      "block 3 s in execSync → time out → cache the fallback for 3 s → block 3 s again". The event
 *      loop was gone roughly half the time and X got re-hammered while already struggling.
 *   2. `getDisplaysXrandrVerboseRaw` had NO cache at all. On this box that call costs ~195 ms and
 *      `--verbose` reads EDID from every output — the same X server Caspar renders on.
 *
 * Fix: a failure-aware TTL (successes keep the short TTL, failures sit out
 * XRANDR_FAILURE_BACKOFF_MS) and a cache for the `--verbose` path, shared by its sync and async
 * siblings and cleared by invalidateXrandrCache().
 *
 * `child_process.execSync` is stubbed via require.cache so this needs no X server and can count
 * execs exactly. `node --test` gives each file its own process, so the stub cannot leak.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const CP_PATH = require.resolve('child_process')
const HW_PATH = require.resolve('../../src/utils/hardware-info.js')
/* WO-391c: the probes + cache were split into their own module for the 500-line gate. BOTH must be
 * dropped from require.cache or the stub never reaches the exec (hardware-info would be rebuilt
 * against an already-cached xrandr module holding the real child_process). */
const XR_PATH = require.resolve('../../src/utils/hardware-info-xrandr.js')
const realCp = require('child_process')

/** Let a 1 ms success-TTL genuinely lapse, so only the long failure backoff can suppress a re-probe. */
const lapse = () => new Promise((r) => setTimeout(r, 12))

/**
 * Load a FRESH hardware-info with `execSync` stubbed.
 *
 * `ttl: '1'` (not '0') on purpose: `XRANDR_CACHE_TTL_MS` is built with `parseInt(env) || 3000`, so a
 * literal 0 falls back to 3000 and caching cannot be switched off. 1 ms + {@link lapse} gives the
 * same isolation honestly — a success is stale by the second call, a failure is not.
 */
function loadWithStub(execSyncImpl, { ttl = '1', backoff = '30000' } = {}) {
	process.env.HIGHASCG_XRANDR_CACHE_TTL_MS = ttl
	process.env.HIGHASCG_XRANDR_FAILURE_BACKOFF_MS = backoff
	require.cache[CP_PATH] = {
		id: CP_PATH,
		filename: CP_PATH,
		loaded: true,
		exports: { ...realCp, execSync: execSyncImpl },
	}
	delete require.cache[HW_PATH]
	delete require.cache[XR_PATH]
	return require(HW_PATH)
}

function restore() {
	require.cache[CP_PATH] = { id: CP_PATH, filename: CP_PATH, loaded: true, exports: realCp }
	delete require.cache[HW_PATH]
	delete require.cache[XR_PATH]
	delete process.env.HIGHASCG_XRANDR_CACHE_TTL_MS
	delete process.env.HIGHASCG_XRANDR_FAILURE_BACKOFF_MS
}

const QUERY_OK = 'Screen 0: minimum 320 x 200, current 3840 x 1080, maximum 16384 x 16384\nDP-1 connected primary 1920x1080+1920+0 (normal left inverted right x axis y axis) 520mm x 320mm\n   1920x1080     60.00*+\n'
const VERBOSE_OK = 'DP-1 connected primary 1920x1080+1920+0\n\tEDID:\n\t\t00ffffffffffff00\n'

test('WO-391c: a FAILING xrandr --query backs off instead of re-blocking every TTL', async () => {
	let calls = 0
	const hw = loadWithStub(() => {
		calls++
		const e = new Error('spawnSync /bin/sh ETIMEDOUT')
		e.code = 'ETIMEDOUT'
		throw e
	})
	try {
		hw.getDisplaysXrandrDetailed()
		await lapse()
		hw.getDisplaysXrandrDetailed()
		await lapse()
		hw.getDisplaysXrandrDetailed()
		assert.equal(
			calls,
			1,
			'a failed probe must be cached for the BACKOFF window. The 1ms success-TTL has lapsed between ' +
				'each call, so only the backoff can be suppressing these — 3 calls costing 3 blocking ' +
				'timeouts is the live 12:53 bug this guards',
		)
	} finally {
		restore()
	}
})

test('WO-391c: a SUCCESSFUL query still honours the short TTL (layout changes stay visible)', async () => {
	let calls = 0
	const hw = loadWithStub(() => {
		calls++
		return QUERY_OK
	})
	try {
		hw.getDisplaysXrandrDetailed()
		await lapse()
		hw.getDisplaysXrandrDetailed()
		assert.equal(
			calls,
			2,
			'once the success TTL lapses a success MUST re-probe — the long backoff must never apply to ' +
				'successes, or an applied layout would stay invisible for 30s',
		)
	} finally {
		restore()
	}
})

test('WO-391c: xrandr --verbose is cached at all (it was not)', () => {
	let calls = 0
	const hw = loadWithStub(
		() => {
			calls++
			return VERBOSE_OK
		},
		{ ttl: '5000' },
	)
	try {
		const a = hw.getDisplaysXrandrVerboseRaw()
		const b = hw.getDisplaysXrandrVerboseRaw()
		const c = hw.getDisplaysXrandrVerboseRaw()
		assert.equal(calls, 1, '3 calls must cost ONE exec — this path had no cache and each call blocked ~195ms')
		assert.equal(a, VERBOSE_OK)
		assert.equal(b, VERBOSE_OK, 'cached value must be the same text, not empty')
		assert.equal(c, VERBOSE_OK)
	} finally {
		restore()
	}
})

test('WO-391c: a FAILING --verbose backs off and keeps returning the "" contract', async () => {
	let calls = 0
	const hw = loadWithStub(() => {
		calls++
		throw new Error('spawnSync /bin/sh ETIMEDOUT')
	})
	try {
		assert.equal(hw.getDisplaysXrandrVerboseRaw(), '', 'failure still returns the empty string contract')
		await lapse()
		assert.equal(hw.getDisplaysXrandrVerboseRaw(), '')
		assert.equal(calls, 1, 'the failure is cached for the backoff window, not retried once the 1ms TTL lapses')
	} finally {
		restore()
	}
})

test('WO-391c: invalidateXrandrCache clears BOTH caches, so an explicit layout apply is never delayed', () => {
	let calls = 0
	const hw = loadWithStub(
		() => {
			calls++
			// Fail so the long backoff is what would otherwise suppress the re-probe.
			throw new Error('spawnSync /bin/sh ETIMEDOUT')
		},
		{ ttl: '5000' },
	)
	try {
		hw.getDisplaysXrandrDetailed()
		hw.getDisplaysXrandrVerboseRaw()
		assert.equal(calls, 2, 'one exec each to prime both caches')

		hw.getDisplaysXrandrDetailed()
		hw.getDisplaysXrandrVerboseRaw()
		assert.equal(calls, 2, 'both are inside the backoff window')

		hw.invalidateXrandrCache()
		hw.getDisplaysXrandrDetailed()
		hw.getDisplaysXrandrVerboseRaw()
		assert.equal(
			calls,
			4,
			'invalidate must clear the --verbose cache too, or applying a layout would read stale EDID ' +
				'for up to the whole backoff window',
		)
	} finally {
		restore()
	}
})

test('WO-391c: the backoff can never be shorter than the success TTL', () => {
	const hw = loadWithStub(() => QUERY_OK, { ttl: '9000', backoff: '1000' })
	try {
		const src = require('node:fs').readFileSync(XR_PATH, 'utf8')
		assert.match(
			src,
			/XRANDR_FAILURE_BACKOFF_MS = Math\.max\(\s*XRANDR_CACHE_TTL_MS,/,
			'a misconfigured env must not make failures retry MORE often than successes',
		)
		assert.ok(hw, 'module still loads with a nonsensical backoff/TTL pair')
	} finally {
		restore()
	}
})

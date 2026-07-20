'use strict'

/**
 * Smoke — WO-279: the operator-GUI kiosk window must land on the SELECTED monitor.
 *
 * Root cause this locks down: placement was attempted exactly once, ~8s late (the first
 * `xdotool search --sync --class Navigator` can never match this Firefox's WM_CLASS res_class and
 * was killed by its own execFile timeout), and its result was never read back — so a move the WM
 * dropped or Firefox's kiosk fullscreen transition undid left the kiosk on the wrong monitor with
 * a cheerful "kiosk window positioned" in the journal.
 *
 * Everything here runs with an injected fake `exec`/`sleep`: NO live X server, no xdotool, no
 * Firefox. Covers the pure parts (monitor -> geometry resolution, the retry/backoff schedule, the
 * geometry read-back parser/comparator) and the log shape of the placement loop.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
	XDOTOOL_WINDOW_MATCHERS,
	PLACEMENT_ATTEMPTS,
	placementAttemptDelays,
	parseXdotoolGeometry,
	geometryMatches,
	formatRect,
	resolveKioskMonitorRect,
	placeKioskWindow,
	waitForFirefoxWindowIds,
} = require('../../src/system/operator-gui-launcher')

/** The live box (xrandr): DP-0 3072x1728+0+0 = program, DP-5 1920x1080+3072+0 = operator monitor. */
const OPERATOR_RECT = { x: 3072, y: 0, w: 1920, h: 1080 }
const PROGRAM_RECT = { x: 0, y: 0, w: 3072, h: 1728 }

const shellGeom = (r) => `X=${r.x}\nY=${r.y}\nWIDTH=${r.w}\nHEIGHT=${r.h}\nSCREEN=0\n`

/**
 * Fake xdotool. `geometryScript` supplies what the read-back reports per attempt (index-clamped to
 * the last entry), so a test can say "the first two moves are silently dropped, the third sticks".
 */
function fakeExec(geometryScript) {
	const calls = []
	let reads = 0
	return {
		calls,
		exec: async (file, args) => {
			calls.push([file, ...args].join(' '))
			if (args[0] === 'getwindowgeometry') {
				const r = geometryScript[Math.min(reads++, geometryScript.length - 1)]
				if (r == null) throw new Error('window vanished')
				return { stdout: shellGeom(r) }
			}
			return { stdout: '' }
		},
	}
}

const noSleep = async () => {}

describe('WO-279 — monitor -> geometry resolution', () => {
	const config = {}

	it('uses the SAME source of truth as the pointer confinement (resolveOperatorMonitorRect)', () => {
		const rect = resolveKioskMonitorRect(config, null, {
			resolveOperatorMonitorRect: () => ({ x: 3072, y: 0, width: 1920, height: 1080, sysId: 'DP-5' }),
			// A disagreeing second opinion MUST NOT win — WO-279 requirement 1.
			resolveOperatorGuiMonitorRect: () => ({ x: 0, y: 0, w: 3072, h: 1728 }),
		})
		assert.deepEqual(rect, { x: 3072, y: 0, w: 1920, h: 1080, sysId: 'DP-5', source: 'operator-monitor' })
	})

	it('falls back to the operator_gui destination rect only when no operator monitor resolves', () => {
		const rect = resolveKioskMonitorRect(config, null, {
			resolveOperatorMonitorRect: () => null,
			resolveOperatorGuiMonitorRect: () => ({ x: 3072, y: 0, w: 1920, h: 1080 }),
		})
		assert.equal(rect.source, 'operator_gui_destination')
		assert.deepEqual({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, OPERATOR_RECT)
	})

	it('returns null (never a guess) when neither resolver answers, and swallows their throws', () => {
		assert.equal(
			resolveKioskMonitorRect(config, null, {
				resolveOperatorMonitorRect: () => {
					throw new Error('hardware detection unavailable')
				},
				resolveOperatorGuiMonitorRect: () => null,
			}),
			null,
		)
	})

	it('rejects degenerate zero-sized rects from either resolver', () => {
		assert.equal(
			resolveKioskMonitorRect(config, null, {
				resolveOperatorMonitorRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
				resolveOperatorGuiMonitorRect: () => ({ x: 0, y: 0, w: 1920, h: 0 }),
			}),
			null,
		)
	})
})

describe('WO-279 — retry/backoff schedule', () => {
	it('is bounded, doubles from 250ms, and caps at 4000ms', () => {
		assert.deepEqual(placementAttemptDelays(6), [250, 500, 1000, 2000, 4000])
		assert.deepEqual(placementAttemptDelays(8), [250, 500, 1000, 2000, 4000, 4000, 4000])
	})

	it('yields attempts-1 gaps, and nothing at all for a single (or absurd) attempt count', () => {
		assert.deepEqual(placementAttemptDelays(1), [])
		assert.deepEqual(placementAttemptDelays(0), [])
		assert.deepEqual(placementAttemptDelays(-3), [])
		assert.equal(placementAttemptDelays(PLACEMENT_ATTEMPTS).length, PLACEMENT_ATTEMPTS - 1)
	})

	it('honours injected base/max so the schedule stays testable without real waits', () => {
		assert.deepEqual(placementAttemptDelays(4, { baseMs: 10, maxMs: 25 }), [10, 20, 25])
	})
})

describe('WO-279 — geometry read-back (pure)', () => {
	it('parses xdotool getwindowgeometry --shell, including negative coordinates', () => {
		assert.deepEqual(parseXdotoolGeometry(shellGeom(OPERATOR_RECT)), OPERATOR_RECT)
		assert.deepEqual(parseXdotoolGeometry('WINDOW=1\nX=-1920\nY=-10\nWIDTH=800\nHEIGHT=600\n'), {
			x: -1920,
			y: -10,
			w: 800,
			h: 600,
		})
	})

	it('returns null on partial/garbage output rather than a half-filled rect', () => {
		assert.equal(parseXdotoolGeometry('X=3072\nY=0\n'), null)
		assert.equal(parseXdotoolGeometry(''), null)
		assert.equal(parseXdotoolGeometry(null), null)
	})

	it('matches within WM-frame tolerance but never across monitors', () => {
		assert.equal(geometryMatches(OPERATOR_RECT, OPERATOR_RECT), true)
		assert.equal(geometryMatches({ x: 3073, y: 1, w: 1920, h: 1080 }, OPERATOR_RECT), true)
		// The actual WO-279 bug state: kiosk sized right but sitting on the program screen.
		assert.equal(geometryMatches({ x: 0, y: 0, w: 1920, h: 1080 }, OPERATOR_RECT), false)
		assert.equal(geometryMatches(PROGRAM_RECT, OPERATOR_RECT), false)
		assert.equal(geometryMatches(null, OPERATOR_RECT), false)
	})

	it('formats rects one way everywhere', () => {
		assert.equal(formatRect(OPERATOR_RECT), '3072,0 1920x1080')
		assert.equal(formatRect(null), 'unknown')
	})
})

describe('WO-279 — placement loop verifies and retries', () => {
	const target = { ...OPERATOR_RECT, sysId: 'DP-5', source: 'operator-monitor' }

	it('accepts a first-attempt landing without touching fullscreen state', async () => {
		const { exec, calls } = fakeExec([OPERATOR_RECT])
		const lines = []
		const res = await placeKioskWindow({}, '31457325', target, (lvl, msg) => lines.push(`${lvl} ${msg}`), {
			exec,
			sleep: noSleep,
		})
		assert.equal(res.ok, true)
		assert.equal(res.attempts, 1)
		assert.deepEqual(res.geometry, OPERATOR_RECT)
		assert.equal(calls.filter((c) => c.includes('windowstate')).length, 0, 'no fullscreen flicker when already correct')
		assert.equal(lines.filter((l) => l.includes('retrying in')).length, 0)
	})

	it('retries a dropped move and escalates to a FULLSCREEN off/move/on toggle', async () => {
		// The WM silently ignores the first move (window stays on the program screen), then the
		// fullscreen toggle lets it through — the live failure mode WO-279 describes.
		const { exec, calls } = fakeExec([PROGRAM_RECT, OPERATOR_RECT])
		const lines = []
		const res = await placeKioskWindow({}, '31457325', target, (lvl, msg) => lines.push(`${lvl} ${msg}`), {
			exec,
			sleep: noSleep,
		})
		assert.equal(res.ok, true)
		assert.equal(res.attempts, 2)
		const stateCalls = calls.filter((c) => c.includes('windowstate'))
		assert.deepEqual(stateCalls, [
			'xdotool windowstate --remove FULLSCREEN 31457325',
			'xdotool windowstate --add FULLSCREEN 31457325',
		])
		// Attempt 2's move happens BETWEEN the remove and the add (attempt 1 moved without either).
		const move2 = calls.lastIndexOf('xdotool windowmove 31457325 3072 0')
		assert.ok(calls.indexOf('xdotool windowstate --remove FULLSCREEN 31457325') < move2)
		assert.ok(move2 < calls.indexOf('xdotool windowstate --add FULLSCREEN 31457325'))
		assert.equal(lines.filter((l) => l.includes('dropping _NET_WM_STATE_FULLSCREEN')).length, 1, 'escalates once')
	})

	it('gives up loudly after the bounded attempt budget, naming the wrong monitor', async () => {
		const { exec, calls } = fakeExec([PROGRAM_RECT])
		const lines = []
		const res = await placeKioskWindow({}, '31457325', target, (lvl, msg) => lines.push(`${lvl} ${msg}`), {
			exec,
			sleep: noSleep,
			attempts: 4,
		})
		assert.equal(res.ok, false)
		assert.equal(res.attempts, 4)
		assert.equal(calls.filter((c) => c.startsWith('xdotool windowmove')).length, 4, 'bounded — no infinite retry')
		const fail = lines.filter((l) => l.startsWith('warn'))
		assert.equal(fail.length, 1)
		assert.equal(
			fail[0],
			'warn [Operator GUI] placement: FAILED after 4 attempts — kiosk at 0,0 3072x1728, want 3072,0 1920x1080 (operator GUI is on the WRONG MONITOR)',
		)
	})

	it('survives a read-back that fails outright (window gone) without throwing', async () => {
		const { exec } = fakeExec([null])
		const lines = []
		const res = await placeKioskWindow({}, '31457325', target, (lvl, msg) => lines.push(`${lvl} ${msg}`), {
			exec,
			sleep: noSleep,
			attempts: 2,
		})
		assert.equal(res.ok, false)
		assert.equal(res.geometry, null)
		assert.ok(lines.some((l) => l.startsWith('warn') && l.includes('geometry read-back failed')))
	})
})

describe('WO-279 — placement log shape', () => {
	const target = { ...OPERATOR_RECT, sysId: 'DP-5', source: 'operator-monitor' }

	it('logs intended monitor, resolved geometry and final verified geometry — one line per state change', async () => {
		const { exec } = fakeExec([PROGRAM_RECT, PROGRAM_RECT, OPERATOR_RECT])
		const lines = []
		await placeKioskWindow({}, '31457325', target, (lvl, msg) => lines.push(`${lvl} ${msg}`), { exec, sleep: noSleep })

		assert.equal(
			lines[0],
			'info [Operator GUI] placement: target 3072,0 1920x1080 sysId=DP-5 source=operator-monitor wid=31457325',
		)
		const retries = lines.filter((l) => l.includes('retrying in'))
		assert.deepEqual(retries, [
			'info [Operator GUI] placement: attempt 1/6 got 0,0 3072x1728 want 3072,0 1920x1080 — retrying in 250ms',
			'info [Operator GUI] placement: attempt 2/6 got 0,0 3072x1728 want 3072,0 1920x1080 — retrying in 500ms',
		])
		assert.equal(lines[lines.length - 1], 'info [Operator GUI] placement: verified 3072,0 1920x1080 after 3 attempt(s)')
		// One line per attempt/state change — never one per poll.
		assert.equal(lines.length, 5)
		assert.equal(lines.filter((l) => l.startsWith('warn')).length, 0)
	})

	it('warns loudly instead of claiming success when no monitor resolves', async () => {
		const { positionFirefoxWindow } = require('../../src/system/operator-gui-launcher')
		const { exec } = fakeExec([PROGRAM_RECT])
		const lines = []
		await positionFirefoxWindow({}, null, (lvl, msg) => lines.push(`${lvl} ${msg}`), {
			exec: async (file, args) => {
				if (args[0] === 'search') return { stdout: '31457325\n' }
				return exec(file, args)
			},
			sleep: noSleep,
		})
		assert.ok(
			lines.some((l) => l === 'warn [Operator GUI] placement: no operator monitor resolved — kiosk left wherever the WM mapped it'),
		)
	})
})

describe('WO-279 — window discovery', () => {
	it('matches WM_CLASS res_class before res_name, and never blocks on --sync', () => {
		assert.deepEqual(XDOTOOL_WINDOW_MATCHERS[0], ['--class', 'firefox'])
		assert.ok(
			XDOTOOL_WINDOW_MATCHERS.some(([flag, pat]) => flag === '--classname' && pat === 'Navigator'),
			'res_name "Navigator" is searched with --classname, not --class',
		)
		const src = require('node:fs').readFileSync(
			require('node:path').join(__dirname, '../../src/system/operator-gui-launcher.js'),
			'utf8',
		)
		assert.ok(!/'search',\s*'--sync'/.test(src), 'no --sync: a non-matching pattern must not eat the whole budget')
	})

	it('polls until Firefox maps a window, then returns its ids', async () => {
		let n = 0
		const ids = await waitForFirefoxWindowIds(
			{},
			{
				exec: async () => {
					n++
					if (n < 5) throw new Error('no windows')
					return { stdout: '31457325\n' }
				},
				sleep: noSleep,
			},
		)
		assert.deepEqual(ids, ['31457325'])
	})

	it('gives up after the bounded wait budget rather than hanging the launch', async () => {
		let searches = 0
		const ids = await waitForFirefoxWindowIds(
			{},
			{
				exec: async () => {
					searches++
					throw new Error('no windows')
				},
				sleep: noSleep,
				windowAttempts: 3,
			},
		)
		assert.deepEqual(ids, [])
		// 3 attempts x 3 matchers, then stop.
		assert.equal(searches, 3 * XDOTOOL_WINDOW_MATCHERS.length)
	})
})

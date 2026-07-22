'use strict'

/**
 * WO-317 — the applier's executable core.
 *
 * The one behaviour that must never regress: `optional` semantics. A best-effort step (raise,
 * windowmove) failing must NOT abort the plan; a required step (the python promoter/parker, the
 * kiosk refocus) failing MUST abort and be reported — otherwise a half-applied restack looks like
 * success and the kiosk silently never reclaims the top. These run offline with a fake execFile.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	executePlan,
	resolveWindowBelowParker,
	resolveKioskWid,
	resolveConsumerWid,
} = require('../../src/system/operator-helper-applier')

/** Fake execFile that fails for any bin+args whose joined string matches one of `failOn`. */
function fakeExec(failOn = [], record = []) {
	return async (bin, args) => {
		const line = `${bin} ${(args || []).join(' ')}`
		record.push(line)
		if (failOn.some((f) => line.includes(f))) throw new Error(`fake fail: ${line}`)
		return { stdout: '', stderr: '' }
	}
}

const P = (bin, args, extra = {}) => ({ bin, args, ...extra })

test('all steps succeed → ok, everything ran, nothing skipped', async () => {
	const ran = []
	const r = await executePlan(
		[P('python3', ['/x/above.py', '0xH']), P('xdotool', ['windowactivate', '0xH'], { optional: true })],
		{ execFileImpl: fakeExec([], ran) },
	)
	assert.equal(r.ok, true)
	assert.equal(r.failed, null)
	assert.equal(r.ran.length, 2)
	assert.deepEqual(r.skipped, [])
})

test('an OPTIONAL step failing does not abort — the plan continues', async () => {
	const ran = []
	const r = await executePlan(
		[
			P('python3', ['/x/above.py', '0xH']),
			P('xdotool', ['windowmove', '0xH', '0', '0'], { optional: true }), // fails
			P('xdotool', ['windowactivate', '0xH'], { optional: true }),
		],
		{ execFileImpl: fakeExec(['windowmove'], ran), log: () => {} },
	)
	assert.equal(r.ok, true, 'optional failure is not a plan failure')
	assert.ok(r.skipped.some((s) => s.includes('windowmove')))
	assert.ok(r.ran.some((s) => s.includes('windowactivate')), 'steps after the optional failure still ran')
})

test('a REQUIRED step failing aborts the plan and reports which step, running nothing after', async () => {
	const ran = []
	const r = await executePlan(
		[
			P('python3', ['/x/below.py', '0xH', '--below', '0xC']), // required, fails
			P('xdotool', ['windowactivate', '0xKIOSK']), // required — must NOT run
		],
		{ execFileImpl: fakeExec(['below.py'], ran), log: () => {} },
	)
	assert.equal(r.ok, false)
	assert.match(r.failed, /below\.py/)
	assert.ok(!r.ran.some((s) => s.includes('windowactivate')), 'the kiosk refocus never ran after the parker failed')
	assert.ok(!ran.some((s) => s.includes('windowactivate')), 'and was never even invoked')
})

test('the required kiosk-refocus failing is reported (park would silently not reclaim the top)', async () => {
	const r = await executePlan(
		[P('python3', ['/x/below.py', '0xH']), P('xdotool', ['windowactivate', '0xKIOSK'])],
		{ execFileImpl: fakeExec(['windowactivate 0xKIOSK']), log: () => {} },
	)
	assert.equal(r.ok, false)
	assert.match(r.failed, /windowactivate 0xKIOSK/)
})

test('an empty/absent plan is a no-op success', async () => {
	assert.deepEqual(await executePlan([], { execFileImpl: fakeExec() }), { ok: true, ran: [], skipped: [], failed: null })
	assert.deepEqual(await executePlan(undefined, { execFileImpl: fakeExec() }), {
		ok: true,
		ran: [],
		skipped: [],
		failed: null,
	})
})

test('resolveKioskWid returns the first matching id, or null when none / on error', async () => {
	const ok = await resolveKioskWid({ marker: 'HIGHASCG-OPERATOR-GUI', execFileImpl: async () => ({ stdout: '0x1400003 0x1400009\n' }) })
	assert.equal(ok, '0x1400003')
	const none = await resolveKioskWid({ marker: 'X', execFileImpl: async () => ({ stdout: '  \n' }) })
	assert.equal(none, null)
	const errored = await resolveKioskWid({ marker: 'X', execFileImpl: async () => { throw new Error('no display') } })
	assert.equal(errored, null)
})

test('resolveConsumerWid tries the CasparCG class candidates and returns the first hit', async () => {
	const tried = []
	const wid = await resolveConsumerWid({
		execFileImpl: async (bin, args) => {
			tried.push(args.join(' '))
			// Only the second class/flag combination returns something.
			return { stdout: args.includes('casparcg') ? '0xCASPAR\n' : '\n' }
		},
	})
	assert.equal(wid, '0xCASPAR')
	assert.ok(tried.length >= 2)
})

test('resolveConsumerWid returns null (not throw) when the consumer window cannot be found', async () => {
	const wid = await resolveConsumerWid({ execFileImpl: async () => ({ stdout: '\n' }) })
	assert.equal(wid, null, 'park still works without it — lower to bottom + kiosk refocus')
})

test('the below (park) runtime script resolves to a real file that exists', () => {
	const p = resolveWindowBelowParker()
	assert.ok(p, 'highascg-window-below.py must be resolvable')
	const fs = require('fs')
	assert.ok(fs.existsSync(p))
})

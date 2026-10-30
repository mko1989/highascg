'use strict'

/**
 * WO-825 — one long GDTF Share run (build the XML library / download the full model library): its progress, a cancel
 * flag, and a polite fetch step (one request at a time, a pause between requests, backoff on errors, give up after a
 * streak of failures — a blocked or offline box must not hammer the service). Resumable by design: the runners skip
 * what is already on disk, so "cancel" and "start again" lose nothing.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Job {
	constructor(kind, total = 0) {
		this.kind = kind // 'library' | 'full'
		this.state = 'running' // running | done | cancelled | error
		this.total = total
		this.done = 0 // fetched in this run
		this.skipped = 0 // already on disk
		this.failed = 0
		this.bytes = 0 // downloaded in this run
		this.current = ''
		this.error = ''
		this.startedAt = Date.now()
		this.cancelled = false
	}

	cancel() {
		this.cancelled = true
	}

	snapshot() {
		const { kind, state, total, done, skipped, failed, bytes, current, error, startedAt } = this
		return { kind, state, total, done, skipped, failed, bytes, current, error, startedAt }
	}
}

/**
 * fn() with up to `retries` retries (2 s, 4 s, 8 s … × `unit`); a 401/403 or "no account" is not retried. Throws the
 * last error. @param {number} [unit] test hook: 1 = real seconds scale
 */
async function withRetry(fn, retries = 3, unit = 1000) {
	let last
	for (let i = 0; i <= retries; i++) {
		try {
			return await fn()
		} catch (e) {
			last = e
			if (/HTTP 40[13]|no GDTF Share account|login failed/.test(e.message)) break
			if (i < retries) await sleep(unit * 2 ** (i + 1))
		}
	}
	throw last
}

/**
 * Run `step(item)` over `items`, one at a time, `delayMs` apart, until done / cancelled / `maxFailStreak` failures in
 * a row (state 'error': the service is unreachable or refusing us). `step` returns 'skip' | number (bytes fetched).
 * @param {Job} job @param {any[]} items @param {(item: any) => Promise<'skip' | number>} step
 */
async function run(job, items, step, { delayMs = 300, maxFailStreak = 12, retryUnit = 1000, label = (i) => String(i), onTick } = {}) {
	let streak = 0
	for (const item of items) {
		if (job.cancelled) break
		job.current = label(item)
		try {
			const r = await withRetry(() => step(item), 3, retryUnit)
			streak = 0
			if (r === 'skip') job.skipped++
			else {
				job.done++
				job.bytes += Number(r) || 0
				if (delayMs) await sleep(delayMs)
			}
		} catch (e) {
			job.failed++
			job.error = e.message
			if (++streak >= maxFailStreak) {
				job.state = 'error'
				break
			}
		}
		onTick?.(job)
	}
	if (job.state === 'running') job.state = job.cancelled ? 'cancelled' : 'done'
	job.current = ''
	return job
}

module.exports = { Job, run, withRetry, sleep }

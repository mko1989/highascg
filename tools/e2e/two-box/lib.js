'use strict'

/**
 * WO-1026 — the two-box workflow run (run.js): what both servers are reached through, and the report.
 * A box is { name, host, base, local, get, post, amcp, sh }. The main box is this machine (shell = bash), the peer is
 * reached over HTTP and ssh (BatchMode; the dev boxes share a key).
 */

const { execFile } = require('child_process')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function http(method, url, body, timeoutMs = 15000) {
	const res = await fetch(url, {
		method,
		headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs),
	})
	const text = await res.text()
	let data = null
	try {
		data = text ? JSON.parse(text) : null
	} catch {
		data = { raw: text.slice(0, 2000) }
	}
	return { status: res.status, data }
}

function run(cmd, args, timeoutMs) {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
			resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || ''), err: String(stderr || '') })
		})
	})
}

/** `addr` = host[:port]; `local` = this machine (its shell runs here, the other box's over ssh). */
function makeBox(name, addr, local) {
	const [host, port = '4200'] = String(addr).split(':')
	const base = `http://${host}:${port}`
	const must = async (method, p, body, timeoutMs) => {
		const r = await http(method, base + p, body, timeoutMs)
		if (r.status < 200 || r.status > 299) throw new Error(`${name} ${method} ${p} → ${r.status} ${JSON.stringify(r.data)?.slice(0, 300)}`)
		return r.data
	}
	return {
		name,
		host,
		base,
		local,
		get: (p, timeoutMs) => must('GET', p, undefined, timeoutMs),
		post: (p, body, timeoutMs) => must('POST', p, body ?? {}, timeoutMs),
		/** POST without throwing: { status, data } (a refusal is a result here). */
		try: (p, body, timeoutMs) => http('POST', base + p, body ?? {}, timeoutMs),
		/** One AMCP line through the server's own connection (never a socket of ours on :5250) → the reply as text. */
		async amcp(cmd) {
			const d = await must('POST', '/api/amcp/raw', { cmd })
			return Array.isArray(d?.data) ? d.data.join('\n') : String(d?.data ?? '')
		},
		/** A shell line on that box → { code, out, err }. */
		sh: (line, timeoutMs = 30000) =>
			local ? run('bash', ['-c', line], timeoutMs) : run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', host, line], timeoutMs),
	}
}

/** Poll `fn` until it returns a truthy value or `ms` ran out → that value (or the last falsy one). */
async function waitFor(fn, ms = 8000, every = 400) {
	const end = Date.now() + ms
	let v = null
	for (;;) {
		try {
			v = await fn()
		} catch {
			v = null
		}
		if (v || Date.now() > end) return v
		await sleep(every)
	}
}

const PASS = 'pass'
const FAIL = 'fail'
const WARN = 'warn' // true, but not what the scenario wants and not this software's doing (no SDI signal on a cable)
const SKIP = 'skip'

/**
 * The report: check(id, title, fn) runs `fn` → { status?, detail?, evidence? } (a throw is a FAIL with its message).
 * `only` = id prefixes to run (others are not listed at all).
 */
function createReport({ only = [], log = console.log } = {}) {
	const rows = []
	const wanted = (id) => !only.length || only.some((p) => id === p || id.startsWith(p + '.') || id.startsWith(p))
	async function check(id, title, fn) {
		if (!wanted(id)) return null
		const row = { id, title, status: PASS, detail: '', evidence: null, ms: 0 }
		const t0 = Date.now()
		try {
			const r = (await fn()) || {}
			row.status = r.status || PASS
			row.detail = String(r.detail || '')
			row.evidence = r.evidence ?? null
		} catch (e) {
			row.status = FAIL
			row.detail = String(e?.message || e)
		}
		row.ms = Date.now() - t0
		rows.push(row)
		log(`${row.status.toUpperCase().padEnd(4)} ${id.padEnd(6)} ${title}${row.detail ? ' — ' + row.detail : ''}`)
		return row
	}
	const count = (s) => rows.filter((r) => r.status === s).length
	return {
		check,
		rows,
		summary: () => ({ pass: count(PASS), fail: count(FAIL), warn: count(WARN), skip: count(SKIP), total: rows.length }),
	}
}

/** fail(detail, evidence) / warn / skip / ok: the four results a check returns. */
const res = (status) => (detail = '', evidence = null) => ({ status, detail, evidence })

module.exports = { makeBox, waitFor, sleep, createReport, ok: res(PASS), fail: res(FAIL), warn: res(WARN), skip: res(SKIP) }

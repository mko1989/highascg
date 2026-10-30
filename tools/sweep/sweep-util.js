'use strict'

/**
 * WO-730 — helpers shared by the sweep checks. Everything here only reads: commands are run without a shell, HTTP is
 * GET unless a check says otherwise, and nothing is written outside the sweep's own scratch folder.
 */

const fs = require('fs')
const http = require('http')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '../..')

/** Run a command (no shell). → { code, out, err, missing } — missing = the binary is not installed. */
function sh(cmd, args = [], opts = {}) {
	const r = spawnSync(cmd, args, {
		encoding: 'utf8',
		timeout: opts.timeoutMs || 60000,
		cwd: opts.cwd || REPO,
		env: opts.env || process.env,
		maxBuffer: 32 * 1024 * 1024,
	})
	return {
		code: r.status,
		out: r.stdout || '',
		err: r.stderr || '',
		missing: r.error?.code === 'ENOENT',
		timedOut: r.error?.code === 'ETIMEDOUT',
	}
}

const has = (cmd) => !sh('sh', ['-c', `command -v ${cmd}`]).code

/** JSON over HTTP; never throws. → { status, data, ms, error } (status 0 = no answer). */
function request(method, url, body, timeoutMs = 15000) {
	return new Promise((resolve) => {
		const t0 = Date.now()
		const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
		// WO-842 (sweep 7e): settle exactly once, whatever the peer does. A response that dropped mid-body fires
		// 'aborted'/'error' on `res` (never 'end', and not on `req`), and the socket-idle `timeout` option never fires on a
		// drip-fed body — the promise hung forever, and the after-update sweep with it. A hard deadline backs both up.
		let done = false
		let deadline = null
		const finish = (out) => {
			if (done) return
			done = true
			clearTimeout(deadline)
			resolve({ ms: Date.now() - t0, ...out })
		}
		const fail = (msg) => finish({ status: 0, data: null, text: '', error: msg })
		const req = http.request(
			url,
			{
				method,
				timeout: timeoutMs,
				headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
			},
			(res) => {
				const c = []
				res.on('data', (d) => c.push(d))
				res.on('end', () => {
					const text = Buffer.concat(c).toString('utf8')
					let json = null
					try {
						json = JSON.parse(text || 'null')
					} catch {
						/* not JSON */
					}
					finish({ status: res.statusCode, data: json, text })
				})
				res.on('error', (e) => fail(`response error: ${e.message}`))
				res.on('aborted', () => fail('response aborted by the peer'))
				res.on('close', () => {
					if (!res.complete) fail('connection closed before the response finished')
				})
			}
		)
		deadline = setTimeout(() => {
			fail(`timeout after ${timeoutMs} ms`)
			req.destroy()
		}, timeoutMs)
		if (deadline.unref) deadline.unref()
		req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs} ms`)))
		req.on('error', (e) => fail(e.message))
		if (data) req.write(data)
		req.end()
	})
}
const get = (url, t) => request('GET', url, undefined, t)

/** systemd unit → { active, enabled, startedMs, pid } or null when systemd / the unit is not there. */
function unit(name) {
	const r = sh('systemctl', [
		'show',
		name,
		'-p',
		'ActiveState',
		'-p',
		'UnitFileState',
		'-p',
		'LoadState',
		'-p',
		'ExecMainStartTimestamp',
		'-p',
		'MainPID',
	])
	if (r.missing || r.code !== 0) return null
	const p = Object.fromEntries(
		r.out
			.trim()
			.split('\n')
			.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
	)
	if (p.LoadState === 'not-found') return null
	return {
		active: p.ActiveState,
		enabled: p.UnitFileState,
		startedMs: (Number(p.MainPID) && processStartMs(Number(p.MainPID))) || Date.parse(p.ExecMainStartTimestamp) || 0,
		pid: Number(p.MainPID) || 0,
	}
}

/** When a process started (ms since epoch), from /proc — or 0. */
function processStartMs(pid) {
	try {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
		const startTicks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19])
		const btime = Number(/^btime (\d+)/m.exec(fs.readFileSync('/proc/stat', 'utf8'))[1])
		return Math.round((btime + startTicks / 100) * 1000)
	} catch {
		return 0
	}
}

/**
 * The newest mtime under some paths (files only). Times in the future are left out and counted: a clock that was set
 * back (WO-727: two hours) leaves files "newer" than every process for a while.
 */
function newestMtime(paths, { skip = /(^|\/)(node_modules|\.git|\.godot)(\/|$)/, ext = null } = {}) {
	const now = Date.now()
	let newest = { ms: 0, file: '' }
	let future = 0
	const walk = (p) => {
		let st
		try {
			st = fs.statSync(p)
		} catch {
			return
		}
		if (st.isDirectory()) {
			for (const e of fs.readdirSync(p)) if (!skip.test(path.join(p, e))) walk(path.join(p, e))
		} else if (st.isFile() && (!ext || ext.test(p))) {
			if (st.mtimeMs > now + 60000) future++
			else if (st.mtimeMs > newest.ms) newest = { ms: st.mtimeMs, file: path.relative(REPO, p) }
		}
	}
	paths.forEach((p) => walk(path.resolve(REPO, p)))
	return { ...newest, future }
}

const fmtTime = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '?')

module.exports = { REPO, sh, has, request, get, unit, processStartMs, newestMtime, fmtTime }

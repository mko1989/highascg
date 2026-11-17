'use strict'

/**
 * WO-1094 — the ONE background job that installs / repairs / removes / exports / imports the person-detection runtime.
 * Same shape as the GDTF library job (src/fixtures/gdtf-share-job.js, WO-825): a Job with a snapshot, a cancel, one at
 * a time (409 while one runs). The work itself is tools/tracking-detect/install.sh (the single source of truth — the
 * same command works by hand); this file only spawns it, reads its "@@ <json>" progress lines and keeps a log tail.
 *   - its own process group (detached), so Cancel (SIGTERM, SIGKILL after 5 s) reaches pip / curl too;
 *   - stdin ignored, stdout / stderr read as text (node's child stdio are sockets: nothing here needs a tty);
 *   - the service's env (no XDG_RUNTIME_DIR / DBus — none needed) + HIGHASCG_TRACKING_PREFIX;
 *   - state in <prefix>/install-job.json, the whole output in <prefix>/install.log: a node restart (KillMode=mixed
 *     SIGKILLs the job) leaves state "running" with a dead pid → reported as 'interrupted', and Resume re-runs the same
 *     command (the scripts are idempotent: finished steps are skipped, downloads continue).
 */

const fs = require('fs')
const childProcess = require('child_process')
const { INSTALL_SH, runtimePaths } = require('./runtime-paths')

const LOG_TAIL = 60
const KILL_AFTER_MS = 5000

class RuntimeJob {
	/** @param {string} kind install | repair | remove | export | import @param {string[]} args install.sh arguments */
	constructor(kind, args, prefix) {
		this.kind = kind
		this.args = args
		this.prefix = prefix
		this.state = 'running' // running | done | cancelled | error | interrupted
		this.plan = []
		this.doneSteps = []
		this.step = ''
		this.label = ''
		this.stepPct = 0
		this.error = ''
		this.code = null
		this.apt = ''
		this.log = []
		this.startedAt = Date.now()
		this.endedAt = null
		this.pid = null
		this.cancelled = false
	}

	/** one output line: a progress event or log */
	line(raw) {
		// eslint-disable-next-line no-control-regex -- Ultralytics colours its lines (ESC [ … m)
		const s = String(raw).replace(/\r/g, '').replace(/\x1b\[[0-9;]*m/g, '').trimEnd()
		if (!s) return
		if (s.startsWith('@@ ')) {
			let e
			try {
				e = JSON.parse(s.slice(3))
			} catch {
				return this._log(s)
			}
			if (Array.isArray(e.plan)) this.plan = e.plan.map(String)
			if (e.step) {
				this.step = String(e.step)
				this.label = String(e.label || e.step)
				this.stepPct = 0
				this._log('▶ ' + this.label)
			}
			if (Number.isFinite(e.pct)) this.stepPct = Math.max(this.stepPct, Math.min(100, e.pct)) // never back within a step
			if (e.done && !this.doneSteps.includes(String(e.done))) this.doneSteps.push(String(e.done))
			if (e.error !== undefined) {
				this.code = Number(e.error)
				this.error = String(e.msg || 'failed')
				if (e.apt) this.apt = String(e.apt)
			}
			if (e.cancelled) this.cancelled = true
			if (e.ok) this.ok = true
			return
		}
		this._log(s)
	}

	_log(s) {
		this.log.push(s.length > 300 ? s.slice(0, 300) + '…' : s)
		if (this.log.length > LOG_TAIL) this.log.splice(0, this.log.length - LOG_TAIL)
	}

	/** 0–100 over the plan (a step counts done once the script says so); null before the plan arrives */
	get percent() {
		if (this.state === 'done') return 100
		if (!this.plan.length) return null
		const done = this.plan.filter((s) => this.doneSteps.includes(s)).length
		const cur = this.plan.includes(this.step) && !this.doneSteps.includes(this.step) ? this.stepPct / 100 : 0
		return Math.round(((done + cur) / this.plan.length) * 100)
	}

	/** the script ended: exit code → final state */
	finish(code, signal) {
		if (this.state !== 'running') return
		this.endedAt = Date.now()
		if (code === 0 && (this.ok || !this.plan.length)) this.state = 'done'
		else if (this.cancelled || signal === 'SIGTERM' || signal === 'SIGKILL' || code === 143) {
			this.state = 'cancelled'
			this.error = ''
		} else {
			this.state = 'error'
			// a script that died without its own error line (a bug, an OOM kill): say which step, keep the last output
			if (!this.error) this.error = `${this.label || this.step || this.kind} stopped unexpectedly (exit ${signal || code})${this.log.length ? `: ${this.log[this.log.length - 1]}` : ''}`
			if (this.code === null) this.code = code
		}
		this.step = this.state === 'done' ? '' : this.step
	}

	snapshot() {
		const { kind, args, state, plan, step, label, stepPct, error, code, apt, startedAt, endedAt, pid } = this
		return { kind, args, state, plan, done: this.doneSteps, step, label, step_pct: stepPct, percent: this.percent, error, code, apt,
			log: this.log.slice(-20), started_at: startedAt, ended_at: endedAt, pid, resumable: state === 'interrupted' || state === 'cancelled' || state === 'error' }
	}
}

const alive = (pid) => {
	try {
		process.kill(pid, 0)
		return true
	} catch (e) {
		return e.code === 'EPERM'
	}
}

/**
 * WO-1106 B23 — who a pid is: boot id + start time (/proc/<pid>/stat field 22). A bare pid is reused after a reboot, so
 * a stale "running" job would look alive. null where /proc is unreadable (then only the pid is compared, as before).
 */
function procStamp(pid) {
	try {
		const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
		const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
		const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
		return start ? `${boot}:${start}` : null
	} catch {
		return null
	}
}

function createJobs(deps = {}) {
	const spawn = deps.spawn || childProcess.spawn
	const script = deps.script || INSTALL_SH
	const onEnd = deps.onEnd || (() => {})
	const stampOf = deps.procStamp || procStamp
	let job = null
	let proc = null
	let killTimer = null

	const running = () => !!job && job.state === 'running'

	function persist(j) {
		try {
			fs.mkdirSync(j.prefix, { recursive: true })
			fs.writeFileSync(runtimePaths(j.prefix).state, JSON.stringify({ ...j.snapshot(), log: j.log.slice(-20), pid_start: j.pidStart ?? null }, null, 1))
		} catch {
			/* a prefix we cannot write: the job reports the failure itself */
		}
	}

	/** the last job of a prefix after a node restart: a "running" one whose pid is gone was interrupted */
	function restore(prefix) {
		try {
			const s = JSON.parse(fs.readFileSync(runtimePaths(prefix).state, 'utf8'))
			const j = new RuntimeJob(s.kind, s.args || [], prefix)
			Object.assign(j, { plan: s.plan || [], doneSteps: s.done || [], step: s.step || '', label: s.label || '', error: s.error || '',
				code: s.code ?? null, apt: s.apt || '', log: s.log || [], startedAt: s.started_at, endedAt: s.ended_at, pid: s.pid })
			const same = s.pid && alive(s.pid) && (s.pid_start ?? null) === stampOf(s.pid) // WO-1106 B23: not a reused pid
			j.state = s.state === 'running' && !same ? 'interrupted' : s.state
			if (j.state === 'interrupted' && !j.error) j.error = 'interrupted (the server restarted while it ran) — Resume continues where it stopped'
			return j
		} catch {
			return null
		}
	}

	/**
	 * @param {string} kind @param {string[]} args install.sh arguments @param {string} prefix
	 * @param {Record<string, string>} [env] extra env (the scratch-prefix test hooks)
	 * → { status, body }
	 */
	function start(kind, args, prefix, env = {}) {
		if (running()) return { status: 409, body: { error: `a ${job.kind} job is already running`, job: job.snapshot() } }
		const j = new RuntimeJob(kind, args, prefix)
		let logFd = null
		try {
			fs.mkdirSync(prefix, { recursive: true })
			logFd = fs.openSync(runtimePaths(prefix).log, 'a')
			fs.writeSync(logFd, `\n=== ${new Date().toISOString()} install.sh ${args.join(' ')}\n`)
		} catch (e) {
			return { status: 500, body: { error: `cannot write to ${prefix}: ${e.message}` } }
		}
		let p
		try {
			p = spawn('bash', [script, ...args], {
				detached: true,
				stdio: ['ignore', 'pipe', 'pipe'],
				env: { ...process.env, HIGHASCG_TRACKING_PREFIX: prefix, ...env },
			})
		} catch (e) {
			fs.closeSync(logFd)
			return { status: 500, body: { error: 'spawn: ' + (e?.message || e) } }
		}
		job = j
		proc = p
		j.pid = p.pid
		j.pidStart = p.pid ? stampOf(p.pid) : null
		const feed = (stream) => {
			let buf = ''
			stream.setEncoding('utf8')
			stream.on('data', (d) => {
				try {
					fs.writeSync(logFd, d)
				} catch {
					/* log file gone: keep the tail */
				}
				buf += d
				let nl
				while ((nl = buf.indexOf('\n')) >= 0) {
					j.line(buf.slice(0, nl))
					buf = buf.slice(nl + 1)
				}
				if (buf.length > 65536) buf = ''
			})
			// WO-1106 B23: the last line without a newline (often the script's final error) — 'end' comes before 'close'
			stream.on('end', () => {
				if (buf) j.line(buf)
				buf = ''
			})
		}
		feed(p.stdout)
		feed(p.stderr)
		const tick = setInterval(() => persist(j), 2000)
		tick.unref?.()
		p.on('error', (e) => {
			j.error = 'spawn: ' + (e?.message || e)
		})
		p.on('close', (code, signal) => {
			clearInterval(tick)
			if (killTimer) clearTimeout(killTimer)
			killTimer = null
			j.finish(code, signal)
			try {
				fs.writeSync(logFd, `=== ${j.state}${j.error ? ': ' + j.error : ''}\n`)
				fs.closeSync(logFd)
			} catch {
				/* closed */
			}
			persist(j)
			if (proc === p) proc = null
			onEnd(j)
		})
		persist(j)
		return { status: 202, body: { job: j.snapshot() } }
	}

	function cancel() {
		if (!running() || !proc) return { status: 409, body: { error: 'nothing is running' } }
		job.cancelled = true
		const pid = proc.pid
		const kill = (sig) => {
			try {
				process.kill(-pid, sig)
			} catch {
				/* group gone */
			}
		}
		kill('SIGTERM')
		killTimer = setTimeout(() => kill('SIGKILL'), KILL_AFTER_MS)
		killTimer.unref?.()
		return { status: 200, body: { job: job.snapshot() } }
	}

	/** the job to show for a prefix: the live / last one of this process, else the persisted one */
	function current(prefix) {
		if (job && job.prefix === prefix) return job
		return restore(prefix)
	}

	return { start, cancel, current, running, restore, get job() {
		return job
	} }
}

module.exports = { RuntimeJob, createJobs, alive, procStamp }

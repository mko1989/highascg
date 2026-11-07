'use strict'

const { spawn } = require('child_process')

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ timeoutMs?: number, log?: Function }} [opts]
 */
function runRsync(cwd, args, opts = {}) {
	const timeoutMs =
		typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0
			? opts.timeoutMs
			: Math.max(60_000, parseInt(process.env.HIGHASCG_REPL_RSYNC_TIMEOUT_MS || '1800000', 10) || 1_800_000)

	return new Promise((resolve) => {
		/** @type {import('child_process').ChildProcess|null} */
		let proc = null
		let stdout = ''
		let stderr = ''
		let settled = false
		let exited = false
		let killTimer = null
		const cap = (text) => {
			let tail = Buffer.from(text).subarray(-256 * 1024).toString('utf8')
			while (Buffer.byteLength(tail) > 256 * 1024) tail = tail.slice(1)
			return tail
		}

		const finish = (out) => {
			if (settled) return
			settled = true
			if (timer) clearTimeout(timer)
			resolve(out)
		}

		const timer = setTimeout(() => {
			killTimer = setTimeout(() => {
				if (!exited) {
					try { proc?.kill('SIGKILL') } catch { /* already gone */ }
				}
			}, 3000)
			if (killTimer.unref) killTimer.unref()
			try {
				proc?.kill('SIGTERM')
			} catch {
				/* ignore */
			}
			finish({
				ok: false,
				code: null,
				stdout,
				stderr: cap(`${stderr}\nrsync timed out after ${timeoutMs}ms`.trim()),
				timedOut: true,
			})
		}, timeoutMs)
		if (timer.unref) timer.unref()

		try {
			proc = spawn('rsync', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
		} catch (e) {
			finish({ ok: false, code: null, stdout: '', stderr: e?.message || String(e), timedOut: false })
			return
		}

		proc.stdout?.on('data', (chunk) => {
			if (!settled) stdout = cap(stdout + chunk.toString('utf8'))
		})
		proc.stderr?.on('data', (chunk) => {
			if (!settled) stderr = cap(stderr + chunk.toString('utf8'))
		})
		proc.on('error', (e) => {
			finish({ ok: false, code: null, stdout, stderr: e?.message || String(e), timedOut: false })
		})
		proc.on('exit', () => {
			// Keep the deadline `timer`: a grandchild (ssh) can hold the pipes open after rsync exits, and then
			// 'close' never comes — the deadline is what still settles the promise.
			exited = true
			if (killTimer) clearTimeout(killTimer)
		})
		proc.on('close', (code) => {
			exited = true
			if (killTimer) clearTimeout(killTimer)
			finish({ ok: code === 0, code: code ?? 1, stdout, stderr, timedOut: false })
		})
	})
}

module.exports = { runRsync }

'use strict'

/**
 * WO-1012 — one window grabber child (tools/window-grab/window_grab): a Zoom window → the shm ring `zoom-<source>`,
 * which Caspar plays as `PLAY <ch>-<layer> SHM NAME zoom-<source>` and /api/shm/sources lists as a Live source.
 *
 * The ring lives as long as the child; the window is switched on its stdin (`window <id>` / `none`), so the ring and
 * whatever plays it survive Zoom recreating a window. `below` / `normal` / `move` ask Openbox (EWMH) to hide the window
 * under the operator GUI or bring it back. The child's JSON status lines are kept as `status`.
 *
 * The binary is built on first use from tools/window-grab/build.sh (g++ + X dev headers; ~2 s) so a fresh clone or an
 * ISO install needs no separate step; `ensureBinary` reports why when it cannot be built.
 */

const fs = require('fs')
const path = require('path')
const { spawn, execFileSync } = require('child_process')
const { REPO_ROOT } = require('../repo-paths')
const { displaySessionEnv } = require('../utils/x-display-session-runtime-env')

const GRAB_DIR = path.join(REPO_ROOT, 'tools', 'window-grab')
const GRAB_BIN = path.join(GRAB_DIR, 'build', 'window_grab')

let buildError = ''

/** @returns {{ ok: boolean, bin: string, error?: string }} */
function ensureBinary(deps = {}) {
	const exists = deps.exists || fs.existsSync
	const build = deps.build || (() => execFileSync(path.join(GRAB_DIR, 'build.sh'), { timeout: 120000, stdio: 'pipe' }))
	if (exists(GRAB_BIN)) return { ok: true, bin: GRAB_BIN }
	if (buildError) return { ok: false, bin: GRAB_BIN, error: buildError }
	try {
		build()
	} catch (e) {
		buildError = `window grabber build failed: ${String(e.stderr || e.message || e).trim().split('\n').slice(-3).join(' ')}`
		return { ok: false, bin: GRAB_BIN, error: buildError }
	}
	return exists(GRAB_BIN) ? { ok: true, bin: GRAB_BIN } : { ok: false, bin: GRAB_BIN, error: 'window grabber not built' }
}

/**
 * @param {{ ring: string, size: string, fps: number, window?: string|null, bin?: string, spawn?: Function,
 *   onStatus?: (s: object) => void, onExit?: (code: number|null) => void }} o
 */
function createGrab(o) {
	const spawnFn = o.spawn || spawn
	const args = ['--ring', o.ring, '--size', o.size, '--fps', String(o.fps)]
	if (o.window) args.push('--window', String(o.window))
	const child = spawnFn(o.bin || GRAB_BIN, args, { env: displaySessionEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
	const grab = {
		ring: o.ring,
		size: o.size,
		fps: o.fps,
		status: { window: o.window || null, mapped: false, published: 0, errors: 0 },
		stderr: '',
		alive: true,
		send(line) {
			if (grab.alive && child.stdin && !child.stdin.destroyed) child.stdin.write(line + '\n')
		},
		setWindow(id) {
			grab.status.window = id || null
			grab.send(id ? `window ${id}` : 'none')
		},
		below() {
			grab.send('below')
		},
		normal() {
			grab.send('normal')
		},
		move(x, y, w = 0, h = 0) {
			grab.send(`move ${Math.round(x)} ${Math.round(y)} ${Math.round(w)} ${Math.round(h)}`)
		},
		stop() {
			if (!grab.alive) return
			grab.alive = false
			try {
				child.stdin.end() // EOF → the grabber exits and unlinks its ring
			} catch {
				/* already closed */
			}
			setTimeout(() => {
				try {
					child.kill('SIGTERM')
				} catch {
					/* gone */
				}
			}, 1000).unref?.()
		},
	}
	let buf = ''
	child.stdout?.on('data', (d) => {
		buf += d
		let nl
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl)
			buf = buf.slice(nl + 1)
			try {
				const s = JSON.parse(line)
				if (s.t !== 'status') continue
				grab.status = { window: s.window === '0x0' ? null : s.window, mapped: !!s.mapped, w: s.w, h: s.h, published: s.published, errors: s.errors }
				o.onStatus?.({ ...grab.status, note: s.note || '' })
			} catch {
				/* not a status line */
			}
		}
	})
	child.stderr?.on('data', (d) => {
		grab.stderr = (grab.stderr + d).slice(-400)
	})
	child.on('exit', (code) => {
		grab.alive = false
		o.onExit?.(code)
	})
	child.on('error', (e) => {
		grab.alive = false
		grab.stderr = String(e.message || e)
		o.onExit?.(null)
	})
	return grab
}

module.exports = { createGrab, ensureBinary }

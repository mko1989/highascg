/**
 * WO-575 — serial ffmpeg queue behind the media browser's "Encode to HAP".
 *
 * This is a live, on-air box: one encode at a time, under `nice`, written to `<name>_HAP.mov.part`
 * and renamed only after the result is probed and matches the source. A failed / cancelled /
 * interrupted encode never leaves a file the media scanner can see. The original is never touched.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const A = require('./hap-encode-args')
const { probeForHap } = require('./hap-encode-probe')
const { resolveMediaFileOnDisk, getMediaIngestBasePath } = require('./local-media-paths')

const WS_EVENT = 'media:hap-encode'
const PROGRESS_THROTTLE_MS = 1000
const KEEP_FINISHED_JOBS = 5
const KILL_GRACE_MS = 5000
const STALE_SWEEP_MAX_ENTRIES = 20000
const STALE_SWEEP_MAX_DEPTH = 10
const STILL_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.tga', '.gif', '.bmp', '.svg', '.webp', '.tif', '.tiff'])
const TERMINAL = new Set(['done', 'skipped', 'failed', 'cancelled'])

function fmtBytes(n) {
	if (!(n > 0)) return '0 B'
	const u = ['B', 'KB', 'MB', 'GB', 'TB']
	const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
	return `${(n / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${u[i]}`
}

/**
 * Delete stale `*_HAP.mov.part` files left by an encode a restart interrupted. Bounded walk.
 * @param {string[]} bases media root directories
 * @returns {string[]} removed paths
 */
function sweepStaleParts(bases) {
	const removed = []
	let seen = 0
	const walk = (dir, depth) => {
		if (depth > STALE_SWEEP_MAX_DEPTH || seen > STALE_SWEEP_MAX_ENTRIES) return
		let ents
		try {
			ents = fs.readdirSync(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const e of ents) {
			if (++seen > STALE_SWEEP_MAX_ENTRIES) return
			const full = path.join(dir, e.name)
			if (e.isDirectory()) walk(full, depth + 1)
			else if (e.isFile() && e.name.endsWith(`${A.HAP_SUFFIX}.mov.part`)) {
				try {
					fs.unlinkSync(full)
					removed.push(full)
				} catch {
					/* leave it */
				}
			}
		}
	}
	for (const b of new Set(bases.filter(Boolean).map((b) => path.resolve(b)))) walk(b, 0)
	return removed
}

class HapEncodeQueue {
	/**
	 * @param {object} ctx app context (config, log, _wsBroadcast, runMediaLibraryQueryCycle)
	 * @param {object} [deps] test seams
	 */
	constructor(ctx, deps = {}) {
		this.ctx = ctx
		this.deps = {
			spawn,
			probe: probeForHap,
			resolve: resolveMediaFileOnDisk,
			statfs: (p) => fs.promises.statfs(p),
			progressThrottleMs: PROGRESS_THROTTLE_MS,
			...deps,
		}
		/** @type {object[]} */
		this.jobs = []
		this.running = null
		this._pumping = false
		this._seq = 0
		this._onExit = () => {
			try {
				this.running?.child?.kill('SIGKILL')
			} catch {
				/* exiting anyway */
			}
		}
		process.on('exit', this._onExit)
		// A stale .part is only invisible clutter, but it holds disk; clear it before the first job.
		this._sweepDone = Promise.resolve().then(() => {
			const removed = sweepStaleParts(this._mediaBases())
			if (removed.length) this._log('info', `swept ${removed.length} stale .part file(s)`)
		})
	}

	dispose() {
		process.removeListener('exit', this._onExit)
	}

	_log(level, msg) {
		if (typeof this.ctx.log === 'function') this.ctx.log(level, `[hap-encode] ${msg}`)
	}

	_mediaBases() {
		const cfg = this.ctx.config || {}
		return [cfg.local_media_path, getMediaIngestBasePath(cfg)]
	}

	_ffmpegBin() {
		return this.ctx.config?.streaming?.ffmpeg_path || process.env.FFMPEG_PATH || 'ffmpeg'
	}

	_ffprobeBin() {
		return A.ffprobeBinFor(this._ffmpegBin())
	}

	/**
	 * Why this source can't/shouldn't be encoded, or null when it can.
	 * @returns {string | null}
	 */
	_skipReason(src, srcPath, outPath) {
		if (!src) return null
		if (!src.hasVideo) return 'no video stream'
		if (src.codec === 'hap') return 'already HAP'
		if (STILL_IMAGE_EXT.has(path.extname(srcPath).toLowerCase()) || (!(src.durationSec > 0) && !(src.frames > 1))) {
			return 'still image'
		}
		if (fs.existsSync(outPath)) return `${path.basename(outPath)} already exists`
		return null
	}

	/**
	 * Modal pre-check (no side effects): per id, what the encode would do.
	 * @param {string[]} ids
	 */
	async probeFiles(ids) {
		const bin = this._ffprobeBin()
		return Promise.all(
			ids.map(async (id) => {
				const srcPath = this.deps.resolve(this.ctx.config || {}, id)
				if (!srcPath) return { id, ok: false, reason: 'file not found' }
				const src = await this.deps.probe(bin, srcPath)
				if (!src) return { id, ok: false, reason: 'ffprobe could not read the file' }
				const reason = this._skipReason(src, srcPath, A.deriveOutputPath(srcPath))
				return {
					id,
					ok: !reason,
					reason,
					codec: src.codec,
					hasAlpha: !!src.hasAlpha,
					fps: src.fps || null,
					resolution: src.width ? `${src.width}×${src.height}` : null,
				}
			})
		)
	}

	/**
	 * Queue a batch. Resolves paths synchronously; probing/skip decisions happen when each item runs.
	 * @param {{ ids: string[], alpha?: boolean, hq?: boolean }} req
	 */
	enqueue({ ids, alpha, hq }) {
		const { format, downgraded } = A.pickHapFormat({ alpha, hq })
		const seen = new Set()
		const items = []
		for (const id of ids) {
			const srcPath = this.deps.resolve(this.ctx.config || {}, id)
			if (srcPath && seen.has(srcPath)) continue
			if (srcPath) seen.add(srcPath)
			const item = {
				id,
				srcPath,
				outPath: srcPath ? A.deriveOutputPath(srcPath) : null,
				outId: A.deriveOutputId(id),
				state: srcPath ? 'queued' : 'skipped',
				pct: 0,
				speed: null,
				reason: srcPath ? null : 'file not found',
			}
			items.push(item)
		}
		const job = {
			jobId: `hap-${Date.now().toString(36)}-${++this._seq}`,
			alpha: !!alpha,
			hq: !!hq,
			format,
			downgraded,
			items,
		}
		this.jobs.push(job)
		this._trimFinished()
		this._emit(job, true)
		void this._pump()
		return this.snapshot(job)
	}

	snapshot(job) {
		const counts = { queued: 0, running: 0, done: 0, skipped: 0, failed: 0, cancelled: 0 }
		for (const it of job.items) counts[it.state]++
		return {
			jobId: job.jobId,
			alpha: job.alpha,
			hq: job.hq,
			format: job.format,
			downgraded: job.downgraded,
			finished: job.items.every((it) => TERMINAL.has(it.state)),
			counts,
			items: job.items.map((it) => ({
				id: it.id,
				state: it.state,
				pct: it.pct,
				speed: it.speed,
				outId: it.state === 'done' ? it.outId : undefined,
				reason: it.reason || undefined,
				note: it.note || undefined,
			})),
		}
	}

	list() {
		return this.jobs.map((j) => this.snapshot(j))
	}

	/** @returns {boolean} false when the job is unknown */
	cancel(jobId) {
		const job = this.jobs.find((j) => j.jobId === jobId)
		if (!job) return false
		for (const it of job.items) {
			if (it.state === 'queued') this._setState(it, 'cancelled', 'cancelled')
			else if (it.state === 'running') {
				it.cancelRequested = true
				if (this.running?.item === it) this._kill(this.running.child)
			}
		}
		this._emit(job, true)
		return true
	}

	_kill(child) {
		if (!child) return
		try {
			child.kill('SIGTERM')
		} catch {
			return
		}
		setTimeout(() => {
			try {
				child.kill('SIGKILL')
			} catch {
				/* already exited */
			}
		}, KILL_GRACE_MS).unref()
	}

	_trimFinished() {
		const finished = this.jobs.filter((j) => j.items.every((it) => TERMINAL.has(it.state)))
		for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED_JOBS))) {
			this.jobs.splice(this.jobs.indexOf(j), 1)
		}
	}

	_setState(item, state, reason) {
		item.state = state
		item.reason = reason || null
		if (state === 'done') item.pct = 1
	}

	_emit(job, force) {
		const now = Date.now()
		if (!force && now - (job._lastEmit || 0) < this.deps.progressThrottleMs) return
		job._lastEmit = now
		if (typeof this.ctx._wsBroadcast === 'function') this.ctx._wsBroadcast(WS_EVENT, this.snapshot(job))
	}

	async _pump() {
		if (this._pumping) return
		this._pumping = true
		try {
			await this._sweepDone
			for (;;) {
				let next = null
				for (const job of this.jobs) {
					const item = job.items.find((it) => it.state === 'queued')
					if (item) {
						next = { job, item }
						break
					}
				}
				if (!next) break
				await this._runItem(next.job, next.item)
			}
		} finally {
			this._pumping = false
		}
	}

	_finish(job, item, state, reason) {
		this._setState(item, state, reason)
		if (state === 'failed') this._log('warn', `${item.id}: ${reason}`)
		else this._log('info', `${item.id}: ${state}${reason ? ` (${reason})` : ''}`)
		this._emit(job, true)
	}

	_unlink(p) {
		try {
			fs.unlinkSync(p)
		} catch {
			/* not there */
		}
	}

	async _runItem(job, item) {
		item.state = 'running'
		this._emit(job, true)
		const partPath = A.partPathFor(item.outPath)
		try {
			const src = await this.deps.probe(this._ffprobeBin(), item.srcPath)
			if (item.cancelRequested) return this._finish(job, item, 'cancelled', 'cancelled')
			if (!src) return this._finish(job, item, 'failed', 'ffprobe could not read the file')
			const skip = this._skipReason(src, item.srcPath, item.outPath)
			if (skip) return this._finish(job, item, 'skipped', skip)

			const target = A.hapSafeSize(src.width, src.height)
			if (target.resized)
				item.note = `resized ${src.width}×${src.height} → ${target.width}×${target.height} (HAP needs multiples of 4)`
			const need = A.estimateOutputBytes({
				width: target.width,
				height: target.height,
				frames: src.framesEst,
				format: job.format,
			})
			if (need > 0) {
				const st = await this.deps.statfs(path.dirname(item.outPath)).catch(() => null)
				const free = st ? Number(st.bavail) * Number(st.bsize) : Infinity
				if (free < need) {
					return this._finish(
						job,
						item,
						'failed',
						`not enough disk space: needs up to ${fmtBytes(need)}, ${fmtBytes(free)} free`
					)
				}
			}

			this._unlink(partPath)
			const argv = A.buildFfmpegArgs({
				input: item.srcPath,
				outputPart: partPath,
				format: job.format,
				audioMode: A.pickAudioMode(src.audioCodecs),
				scaleTo: target.resized ? target : null,
			})
			this._log(
				'info',
				`${item.id}: ${job.format} ${src.width}×${src.height} @ ${src.fps}fps${src.hasAlpha && job.format !== 'hap_alpha' ? ' (alpha dropped)' : ''}${item.note ? ` — ${item.note}` : ''}`
			)
			const res = await this._encode(job, item, argv, { frames: src.framesEst, durationSec: src.durationSec })

			if (item.cancelRequested) {
				this._unlink(partPath)
				return this._finish(job, item, 'cancelled', 'cancelled')
			}
			if (res.code !== 0) {
				this._unlink(partPath)
				return this._finish(
					job,
					item,
					'failed',
					`ffmpeg exited ${res.code ?? res.signal}: ${res.stderrTail || 'no output'}`
				)
			}
			const out = await this.deps.probe(this._ffprobeBin(), partPath)
			const bad = out
				? A.verifyEncoded({ ...src, width: target.width, height: target.height }, out)
				: 'encoded file could not be read back'
			if (bad) {
				this._unlink(partPath)
				return this._finish(job, item, 'failed', `verification failed: ${bad}`)
			}
			if (fs.existsSync(item.outPath)) {
				this._unlink(partPath)
				return this._finish(job, item, 'skipped', `${path.basename(item.outPath)} already exists`)
			}
			fs.renameSync(partPath, item.outPath)
			if (typeof this.ctx.runMediaLibraryQueryCycle === 'function') this.ctx.runMediaLibraryQueryCycle()
			return this._finish(job, item, 'done')
		} catch (e) {
			this._unlink(partPath)
			return this._finish(job, item, 'failed', e instanceof Error ? e.message : String(e))
		}
	}

	/**
	 * Spawn ffmpeg under `nice -n 10` (falls back to a bare spawn if `nice` isn't installed).
	 * @returns {Promise<{ code: number | null, signal: string | null, stderrTail: string }>}
	 */
	_encode(job, item, argv, total) {
		const bin = this._ffmpegBin()
		const useNice = process.platform === 'linux'
		const attempt = (nice) =>
			new Promise((resolve) => {
				const opts = { stdio: ['ignore', 'pipe', 'pipe'] }
				const child = nice ? this.deps.spawn('nice', ['-n', '10', bin, ...argv], opts) : this.deps.spawn(bin, argv, opts)
				this.running = { job, item, child }
				const pstate = { buf: '', cur: {} }
				let tail = ''
				child.stdout?.on('data', (c) => {
					for (const block of A.feedProgress(pstate, String(c))) {
						const { pct, speed } = A.progressFromBlock(block, total)
						if (pct != null) item.pct = pct
						item.speed = speed
						this._emit(job, false)
					}
				})
				child.stderr?.on('data', (c) => {
					tail = (tail + String(c)).slice(-2000)
				})
				child.on('error', (err) => {
					if (this.running?.child === child) this.running = null
					if (nice && err.code === 'ENOENT') resolve(attempt(false))
					else resolve({ code: -1, signal: null, stderrTail: err.message })
				})
				child.on('close', (code, signal) => {
					if (this.running?.child === child) this.running = null
					resolve({ code, signal, stderrTail: A.summarizeStderr(tail) })
				})
			})
		return attempt(useNice)
	}
}

module.exports = { HapEncodeQueue, sweepStaleParts, WS_EVENT }

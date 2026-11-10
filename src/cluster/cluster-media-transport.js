'use strict'

/**
 * WO-1029 plan 07 C10 — how one media file moves from this server to a linked one (the Spread, cluster-media-spread.js).
 *
 * Production: rsync over ssh, the hot-backup transport of "Send media" (cluster-media.js: signed key exchange first;
 * the receiver's forced command tools/runtime/highascg-replication-ssh.sh = `rsync --server` into media/ only). One
 * file per run, named in a `--files-from` list (no remote path splitting, WO-724). `-rtL`: times kept (the inventory's
 * mtime compares), links followed, NO owner / group / perms (exFAT targets: chown is EPERM), NEVER `--delete`. rsync
 * writes a temp name and renames, so Caspar never sees half a file. The forced command allows only `-vlogDtprRz`
 * letters + --server/--sender/--mkpath on the receiving side, so `--bwlimit` (sent to the receiver by rsync) is passed
 * only when the receiver says its wrapper accepts it (`can_throttle` in its inventory header), and likewise
 * `--partial-dir=.highascg-partial` (`can_resume`: a cancelled huge file resumes; never a truncated final name);
 * `--modify-window` is never sent (refused there; the inventory allows 2 s of mtime slack itself).
 * Sandbox (the virtual box bed, tools/e2e/virtual-boxes.js): HIGHASCG_SANDBOX_MEDIA_LOOPBACK=1 in a HIGHASCG_SANDBOX
 * node replaces ssh with a plain atomic copy between the boxes' media folders, refused for any path outside the temp
 * directory.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { isSandbox } = require('../bootstrap/sandbox')

/** The bed's loopback copy is on (both env switches). */
const loopbackMode = () => isSandbox() && process.env.HIGHASCG_SANDBOX_MEDIA_LOOPBACK === '1'

/** Does this server's forced ssh command accept `--bwlimit=N`? (an older wrapper refuses every other option) */
function wrapperAccepts(wrapperPath, option) {
	try {
		return fs.readFileSync(wrapperPath, 'utf8').includes(option)
	} catch {
		return false
	}
}
const wrapperAcceptsBwlimit = (p) => wrapperAccepts(p, '--bwlimit')
/** … and `--partial-dir .highascg-partial` (resume a cancelled / failed huge file instead of starting over)? */
const wrapperAcceptsPartialDir = (p) => wrapperAccepts(p, '--partial-dir')

/** Hidden folder (next to the file, as rsync's relative --partial-dir) holding an unfinished copy: never the final name. */
const PARTIAL_DIR = '.highascg-partial'

/** A relative media path that cannot leave the media folder ('' when it could). */
function safeRel(p) {
	const r = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '')
	if (!r || r.split('/').some((s) => s === '..' || s === '.' || s === '') || /[\0\n\r]/.test(r)) return ''
	return r
}

/**
 * rsync argv for one file (exported for the smoke: the flags are the contract).
 * @param {{ mediaBase: string, listFile: string, remote: string, remoteRoot: string, sshCommand: string, bwlimitKbps?: number|null,
 *   resume?: boolean }} o  resume: only when the receiver's wrapper accepts --partial-dir (an older one refuses it)
 */
function rsyncPushArgs(o) {
	const args = ['-rtL', '--info=progress2', `--files-from=${o.listFile}`, '-e', o.sshCommand]
	if (Number.isFinite(o.bwlimitKbps) && o.bwlimitKbps > 0) args.push(`--bwlimit=${Math.round(o.bwlimitKbps)}`)
	if (o.resume) args.push(`--partial-dir=${PARTIAL_DIR}`)
	args.push(`${o.mediaBase.replace(/\/+$/, '')}/`, `${o.remote}${path.posix.join(o.remoteRoot, 'media')}/`)
	return args
}

/** Bytes done from rsync --info=progress2 output ("   1,234,567  12%  10.00MB/s  0:00:10"). */
function parseProgress(text) {
	const lines = String(text).split(/[\r\n]+/).filter((l) => /\d+%/.test(l))
	const m = lines.length ? /^\s*([\d,.]+)\s+\d+%/.exec(lines[lines.length - 1]) : null
	return m ? Number(m[1].replace(/[,.]/g, '')) : null
}

/**
 * Push one file with rsync over ssh → { ok, error? } (never throws). Abort kills rsync.
 * @param {{ mediaBase: string, rel: string, host: string, user?: string, remoteRoot: string, sshOpts: string,
 *   bwlimitKbps?: number|null, resume?: boolean, signal?: AbortSignal, onProgress?: (bytes: number) => void, spawnFn?: Function,
 *   tmpDir?: string, timeoutMs?: number }} o
 */
async function rsyncPushFile(o) {
	const rel = safeRel(o.rel)
	if (!rel) return { ok: false, error: 'bad media path' }
	const dir = fs.mkdtempSync(path.join(o.tmpDir || os.tmpdir(), 'highascg-spread-'))
	const listFile = path.join(dir, 'files')
	fs.writeFileSync(listFile, `${rel}\n`)
	const args = rsyncPushArgs({ mediaBase: o.mediaBase, listFile, remote: `${o.user || 'casparcg'}@${o.host}:`, remoteRoot: o.remoteRoot, sshCommand: `ssh ${o.sshOpts}`, bwlimitKbps: o.bwlimitKbps, resume: o.resume })
	try {
		return await new Promise((resolve) => {
			let err = ''
			let done = false
			const finish = (r) => {
				if (done) return
				done = true
				clearTimeout(timer)
				o.signal?.removeEventListener?.('abort', onAbort)
				resolve(r)
			}
			const child = (o.spawnFn || spawn)('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] })
			const onAbort = () => {
				try {
					child.kill('SIGTERM')
				} catch {
					/* gone */
				}
				finish({ ok: false, error: 'cancelled' })
			}
			const timer = setTimeout(() => {
				try {
					child.kill('SIGKILL')
				} catch {
					/* gone */
				}
				finish({ ok: false, error: 'rsync timed out' })
			}, o.timeoutMs || 6 * 3600 * 1000)
			if (o.signal?.aborted) return onAbort()
			o.signal?.addEventListener?.('abort', onAbort, { once: true })
			child.stdout?.on('data', (c) => {
				const b = parseProgress(c.toString('utf8'))
				if (b != null) o.onProgress?.(b)
			})
			child.stderr?.on('data', (c) => (err = (err + c.toString('utf8')).slice(-4000)))
			child.on('error', (e) => finish({ ok: false, error: e.message }))
			child.on('close', (code) => finish(code === 0 ? { ok: true } : { ok: false, error: err.trim().split('\n').pop() || `rsync exit ${code}` }))
		})
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
}

/** realpath of the nearest existing parent, so a not-yet-created folder can be checked too. */
function realNearest(p) {
	let d = path.resolve(p)
	while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d)
	return path.join(fs.realpathSync(d), path.relative(d, path.resolve(p)))
}

/** Inside the temp directory (realpaths)? */
function underTemp(p, tmp = os.tmpdir()) {
	const root = fs.realpathSync(tmp)
	const r = path.relative(root, realNearest(p))
	return !!r && !r.startsWith('..') && !path.isAbsolute(r)
}

/**
 * Copy `src` to `dest` the way rsync --partial-dir does: bytes go to `<dir>/.highascg-partial/<name>` (resumed from its
 * size when an earlier copy was cancelled or failed), progress per chunk (a huge file reports bytes as it goes), then
 * fsync + rename onto the final name + the source mtime (rsync -t). The final name never holds a truncated file.
 * @param {{ signal?: AbortSignal, onProgress?: (bytes: number) => void, fsMod?: object }} [o]
 */
async function resumableCopy(src, dest, o = {}) {
	const st = fs.statSync(src)
	const pdir = path.join(path.dirname(dest), PARTIAL_DIR)
	const part = path.join(pdir, path.basename(dest))
	fs.mkdirSync(pdir, { recursive: true })
	let start
	try {
		start = fs.statSync(part).size
	} catch {
		start = 0
	}
	if (start > st.size) {
		fs.rmSync(part, { force: true })
		start = 0
	}
	let done = start
	o.onProgress?.(done)
	const fh = await fs.promises.open(part, start ? 'a' : 'w')
	try {
		// what was written stays in the partial on a cancel / failure: the next copy resumes from its size
		for await (const c of fs.createReadStream(src, { start, highWaterMark: 1 << 20 })) {
			if (o.signal?.aborted) break
			await fh.write(c)
			done += c.length
			o.onProgress?.(done)
		}
		if (o.signal?.aborted) throw new Error('cancelled')
		await fh.sync() // on disk before the rename makes it visible
	} finally {
		await fh.close()
	}
	if (fs.statSync(part).size !== st.size) throw new Error('size changed while copying')
	fs.renameSync(part, dest)
	fs.utimesSync(dest, st.atime, st.mtime)
	try {
		fs.rmdirSync(pdir) // only when empty
	} catch {
		/* another unfinished copy is still in there */
	}
	return st.size
}

/**
 * Sandbox only: copy one file between two media folders of the virtual box bed → { ok, error? } (resumableCopy). Refused
 * outside a sandbox with HIGHASCG_SANDBOX_MEDIA_LOOPBACK=1, and for any folder outside the temp directory.
 * @param {{ srcBase: string, rel: string, destRoot: string, signal?: AbortSignal, onProgress?: Function, tmp?: string }} o
 */
async function loopbackCopyFile(o) {
	if (!loopbackMode()) return { ok: false, error: 'loopback copy is for the sandbox bed only' }
	const rel = safeRel(o.rel)
	if (!rel || !o.destRoot) return { ok: false, error: 'bad media path' }
	const src = path.join(o.srcBase, rel)
	const dest = path.join(o.destRoot, rel)
	if (!underTemp(o.srcBase, o.tmp) || !underTemp(o.destRoot, o.tmp) || !underTemp(src, o.tmp) || !underTemp(dest, o.tmp))
		return { ok: false, error: 'loopback copy refused: outside the temp directory' }
	try {
		await resumableCopy(src, dest, o)
		return { ok: true }
	} catch (e) {
		return { ok: false, error: o.signal?.aborted ? 'cancelled' : e.message }
	}
}

module.exports = { rsyncPushArgs, rsyncPushFile, parseProgress, loopbackCopyFile, resumableCopy, loopbackMode, wrapperAcceptsBwlimit, wrapperAcceptsPartialDir, safeRel }

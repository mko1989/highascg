/**
 * USB File Copy and progression logic.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { resolveSafe, getMediaIngestBasePath } = require('./local-media')

const COPY_BUF = 1024 * 1024

function resolveUnderMount(mountRoot, relPath) {
	const root = path.resolve(mountRoot)
	const bits = String(relPath || '').replace(/\\/g, '/').split('/').filter(p => p && p !== '.')
	if (bits.includes('..')) return null
	const full = path.resolve(root, ...bits)
	return (full === root || (path.relative(root, full) && !path.relative(root, full).startsWith('..'))) ? full : null
}

function collectFilesForImport(mountRoot, items, maxFiles = 50000) {
	const root = path.resolve(mountRoot); const files = []
	const walk = rel => {
		const full = resolveUnderMount(root, rel); if (!full) return { error: 'Invalid path' }
		let st; try { st = fs.lstatSync(full) } catch (e) { return { error: e.message } }
		if (st.isFile()) {
			if (files.length >= maxFiles) return { error: 'Limit reached' }
			files.push({ src: full, rel: path.relative(root, full).split(path.sep).join('/') })
		} else if (st.isDirectory()) {
			try {
				for (const d of fs.readdirSync(full, { withFileTypes: true })) {
					if (d.name === '.' || d.name === '..') continue
					const w = walk(rel ? `${rel}/${d.name}` : d.name); if (w.error) return w
				}
			} catch (e) { return { error: e.message } }
		}
		return {}
	}
	for (const it of items) {
		const w = walk(String(it || '').replace(/\\/g, '/').replace(/^\/+/, ''))
		if (w.error) return { files, error: w.error }
	}
	return { files }
}

async function copyFileStreams({ src, dest, isCancelled, onProgress, verifyHash }) {
	await fs.promises.mkdir(path.dirname(dest), { recursive: true })
	const tmp = dest + '.partial'; if (fs.existsSync(tmp)) try { fs.unlinkSync(tmp) } catch {}
	const hash = verifyHash ? crypto.createHash('sha1') : null; let written = 0
	await new Promise((resolve, reject) => {
		const rs = fs.createReadStream(src, { highWaterMark: COPY_BUF })
		const ws = fs.createWriteStream(tmp, { highWaterMark: COPY_BUF })
		rs.on('data', c => { if (hash) hash.update(c); written += c.length; if (onProgress) onProgress(written) })
		rs.on('error', reject); ws.on('error', reject); ws.on('finish', resolve); rs.pipe(ws)
	})
	if (isCancelled()) { try { fs.unlinkSync(tmp) } catch {} throw new Error('Cancelled') }
	fs.renameSync(tmp, dest)
	if (verifyHash) {
		const h = hash.digest('hex'); const check = crypto.createHash('sha1')
		await new Promise((resolve, reject) => {
			const r = fs.createReadStream(dest); r.on('data', c => check.update(c)); r.on('error', reject); r.on('end', resolve)
		})
		if (check.digest('hex') !== h) throw new Error('Verify failed')
	}
}

async function copyFromUsb(ctx, opts, getDriveById) {
	const mediaBase = getMediaIngestBasePath(ctx.config || {})
	const drive = await getDriveById(opts.driveId); if (!drive || drive.readOnly) throw new Error('Invalid drive')
	const sub = String(opts.targetSubdir || '').trim().replace(/^\/+|\/+$/g, '')
	const effectiveDest = sub ? resolveSafe(mediaBase, sub.split('/').join(path.sep)) : mediaBase
	if (!effectiveDest) throw new Error('Invalid target')
	if (!fs.existsSync(effectiveDest)) fs.mkdirSync(effectiveDest, { recursive: true })
	const { files, error } = collectFilesForImport(drive.mountpoint, opts.items); if (error) throw new Error(error)
	
	let totalBytes = 0; files.forEach(f => { try { totalBytes += fs.statSync(f.src).size } catch {} })
	let doneBytes = 0; let skipped = 0; let lastEmit = 0
	for (let i = 0; i < files.length; i++) {
		if (opts.isCancelled()) throw new Error('Cancelled')
		const f = files[i]; const norm = f.rel.split('/').filter(Boolean).join(path.sep)
		let dest = resolveSafe(effectiveDest, norm); if (!dest) { skipped++; continue }
		if (fs.existsSync(dest)) {
			if (opts.overwritePolicy === 'skip') { skipped++; continue }
			if (opts.overwritePolicy === 'rename') {
				let n = 1; const dir = path.dirname(dest); const ext = path.extname(dest); const base = path.basename(dest, ext)
				while (fs.existsSync(path.join(dir, `${base}_${n}${ext}`))) n++
				dest = path.join(dir, `${base}_${n}${ext}`)
			}
		}
		await copyFileStreams({ src: f.src, dest, isCancelled: opts.isCancelled, verifyHash: opts.verifyHash, onProgress: cur => {
			const overall = doneBytes + cur; const pct = totalBytes > 0 ? (overall / totalBytes) * 100 : 0
			if (Date.now() - lastEmit > 220) {
				lastEmit = Date.now()
				if (opts.broadcast) opts.broadcast({ phase: 'copying', fileRel: f.rel, fileIndex: i, fileTotal: files.length, bytesDone: overall, bytesTotal: totalBytes, progress: pct })
			}
			opts.setState({ phase: 'copying', fileRel: f.rel, fileIndex: i, fileTotal: files.length, bytesDone: overall, bytesTotal: totalBytes, progress: pct, message: `Copying ${f.rel}…` })
		}})
		doneBytes += fs.statSync(dest).size
	}
	return { imported: files.length - skipped, skipped, bytes: doneBytes }
}

module.exports = { copyFromUsb, resolveUnderMount, collectFilesForImport }

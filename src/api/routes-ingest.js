/**
 * Media Ingest: Streaming uploads (busboy) and URL downloads (fetch + unzipper).
 * Supports 200GB+ files by avoiding RAM buffering.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const busboy = require('busboy')
const unzipper = require('unzipper')
const { JSON_HEADERS, jsonBody } = require('./response')
const { resolveSafe, getMediaIngestBasePath } = require('../media/local-media')

/**
 * @param {object} ctx
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} msg
 */
function ingestLog(ctx, level, msg) {
	const line = `[Ingest] ${msg}`
	if (typeof ctx.log === 'function') {
		try {
			ctx.log(level, line)
		} catch {
			/* ignore */
		}
	}
	if (level === 'error') console.error(line)
	else if (level === 'warn') console.warn(line)
	else console.log(line)
}

/**
 * @param {object} ctx
 * @param {object} patch
 */
function setDownloadState(ctx, patch) {
	if (!ctx._ingestDownloadState) {
		ctx._ingestDownloadState = {
			active: false,
			phase: 'idle',
			kind: null,
			progress: null,
			message: '',
			error: null,
			updatedAt: 0,
		}
	}
	Object.assign(ctx._ingestDownloadState, patch, { updatedAt: Date.now() })
}

/**
 * GET /api/ingest/download-status — poll while URL download runs in background.
 * @param {object} ctx
 */
function handleGetDownloadStatus(ctx) {
	const s = ctx._ingestDownloadState || {
		active: false,
		phase: 'idle',
		kind: null,
		progress: null,
		message: '',
		error: null,
		updatedAt: 0,
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			active: !!s.active,
			phase: s.phase || 'idle',
			kind: s.kind || null,
			progress: s.progress == null ? null : Number(s.progress),
			message: s.message || '',
			error: s.error || null,
		}),
	}
}

let _wetransfert = null
function getWetransfert() {
	if (_wetransfert !== null) return _wetransfert
	try {
		_wetransfert = require('wetransfert')
	} catch {
		_wetransfert = false
	}
	return _wetransfert
}

/**
 * @param {string} urlStr
 * @returns {boolean}
 */
function isWeTransferUrl(urlStr) {
	const wt = getWetransfert()
	if (!wt || !wt.isValidWetransfertUrl) return false
	try {
		return !!wt.isValidWetransfertUrl(urlStr)
	} catch {
		return false
	}
}

/**
 * POST /api/ingest/upload
 */
async function handleUpload(req, res, ctx) {
	return new Promise((resolve) => {
		const config = ctx.config || {}
		const mediaBase = getMediaIngestBasePath(config)

		if (!fs.existsSync(mediaBase)) {
			try {
				fs.mkdirSync(mediaBase, { recursive: true })
			} catch (e) {
				resolve({ status: 500, headers: JSON_HEADERS, body: jsonBody({ error: `Could not create media folder: ${e.message}` }) })
				return
			}
		}

		const bb = busboy({ headers: req.headers })
		let fileCount = 0
		let targetSubdir = ''

		bb.on('field', (name, val) => {
			if (name === 'path') targetSubdir = val
		})

		bb.on('file', (name, file, info) => {
			const { filename } = info
			// If path field was provided, use it to resolve safe path
			const effectiveBase = targetSubdir ? path.join(mediaBase, targetSubdir) : mediaBase
			
			// Ensure target subdir exists (sequential upload means we can do this here)
			try {
				if (!fs.existsSync(effectiveBase)) fs.mkdirSync(effectiveBase, { recursive: true })
			} catch (e) {}

			const savePath = resolveSafe(effectiveBase, filename)

			if (!savePath) {
				file.resume()
				return
			}

			fileCount++
			const writeStream = fs.createWriteStream(savePath)
			file.pipe(writeStream)

			writeStream.on('finish', () => {
				// Always unzip if it's a zip
				if (path.extname(savePath).toLowerCase() === '.zip') {
					console.log(`[Ingest] Unzipping ${filename}...`)
					const zipDir = path.dirname(savePath)
					fs.createReadStream(savePath)
						.pipe(unzipper.Extract({ path: zipDir }))
						.on('close', () => {
							console.log(`[Ingest] Unzipped ${filename}, removing archive.`)
							fs.unlink(savePath, () => {})
							if (ctx.runMediaLibraryQueryCycle) ctx.runMediaLibraryQueryCycle()
						})
				} else {
					if (ctx.runMediaLibraryQueryCycle) ctx.runMediaLibraryQueryCycle()
				}
			})
		})

		bb.on('finish', () => {
			resolve({ status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, count: fileCount }) })
		})

		bb.on('error', (err) => {
			resolve({ status: 500, headers: JSON_HEADERS, body: jsonBody({ error: err.message }) })
		})

		req.pipe(bb)
	})
}

/**
 * POST /api/ingest/download
 * body: { url: string }
 */
async function handleDownload(body, ctx) {
	const { url } = typeof body === 'object' ? body : JSON.parse(body || '{}')
	if (!url) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'url required' }) }

	const config = ctx.config || {}
	const mediaBase = getMediaIngestBasePath(config)

	if (isWeTransferUrl(url)) {
		const wt = getWetransfert()
		if (!wt || !wt.download) {
			return {
				status: 503,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'WeTransfer support is not available (missing wetransfert module)' }),
			}
		}
		if (!fs.existsSync(mediaBase)) {
			try {
				fs.mkdirSync(mediaBase, { recursive: true })
			} catch (e) {
				return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: `Could not create media folder: ${e.message}` }) }
			}
		}
		setDownloadState(ctx, {
			active: true,
			phase: 'queued',
			kind: 'wetransfer',
			progress: null,
			message: 'Queued: WeTransfer download…',
			error: null,
		})
		ingestLog(ctx, 'info', `WeTransfer download starting → ${mediaBase}`)
		;(async () => {
			try {
				setDownloadState(ctx, {
					active: true,
					phase: 'connecting',
					message: 'Connecting to WeTransfer (resolving link)…',
					progress: null,
				})
				await wt.download(url, mediaBase).onProgress((p) => {
					const n = parseFloat(p)
					const pct = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n * 100))) : null
					setDownloadState(ctx, {
						active: true,
						phase: 'downloading',
						progress: pct,
						message: 'Downloading from WeTransfer…',
					})
				})
				setDownloadState(ctx, {
					active: false,
					phase: 'complete',
					kind: 'wetransfer',
					progress: 100,
					message: 'WeTransfer download finished',
					error: null,
				})
				ingestLog(ctx, 'info', 'WeTransfer download complete')
				if (ctx.runMediaLibraryQueryCycle) ctx.runMediaLibraryQueryCycle()
			} catch (e) {
				const errMsg = e?.message || String(e)
				setDownloadState(ctx, {
					active: false,
					phase: 'error',
					kind: 'wetransfer',
					progress: null,
					message: 'WeTransfer download failed',
					error: errMsg,
				})
				ingestLog(ctx, 'error', `WeTransfer download failed: ${errMsg}`)
			}
		})()
		return {
			status: 202,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, message: 'WeTransfer download started', poll: '/api/ingest/download-status' }),
		}
	}

	let filename
	try {
		filename = path.basename(new URL(url).pathname) || 'downloaded_asset'
	} catch (e) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid URL' }) }
	}
	const savePath = resolveSafe(mediaBase, filename)

	if (!savePath) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid URL/path' }) }

	if (!fs.existsSync(mediaBase)) {
		try {
			fs.mkdirSync(mediaBase, { recursive: true })
		} catch (e) {
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: `Could not create media folder: ${e.message}` }) }
		}
	}

	setDownloadState(ctx, {
		active: true,
		phase: 'queued',
		kind: 'http',
		progress: null,
		message: 'Queued: HTTP download…',
		error: null,
	})
	ingestLog(ctx, 'info', `HTTP download starting → ${filename}`)

	// Start background download (direct HTTP)
	;(async () => {
		try {
			setDownloadState(ctx, {
				active: true,
				phase: 'downloading',
				message: `Downloading ${filename}…`,
				progress: null,
			})
			const response = await fetch(url)
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			const total = parseInt(response.headers.get('content-length') || '', 10)
			let received = 0

			const fileStream = fs.createWriteStream(savePath)
			const reader = response.body.getReader()

			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				const buf = Buffer.from(value)
				received += buf.length
				fileStream.write(buf)
				if (Number.isFinite(total) && total > 0) {
					setDownloadState(ctx, {
						active: true,
						phase: 'downloading',
						progress: Math.min(100, Math.round((received / total) * 100)),
						message: `Downloading ${filename}…`,
					})
				}
			}
			fileStream.end()

			await new Promise((resolve, reject) => {
				fileStream.on('finish', resolve)
				fileStream.on('error', reject)
			})

			if (path.extname(savePath).toLowerCase() === '.zip') {
				setDownloadState(ctx, {
					active: true,
					phase: 'extracting',
					progress: 100,
					message: `Unpacking ${filename}…`,
				})
				ingestLog(ctx, 'info', `Unzipping ${filename}`)
				await new Promise((resolve, reject) => {
					fs.createReadStream(savePath)
						.pipe(unzipper.Extract({ path: path.dirname(savePath) }))
						.on('close', resolve)
						.on('error', reject)
				})
				fs.unlink(savePath, () => {})
			}
			setDownloadState(ctx, {
				active: false,
				phase: 'complete',
				kind: 'http',
				progress: 100,
				message: `Saved ${filename}`,
				error: null,
			})
			ingestLog(ctx, 'info', `HTTP download complete: ${filename}`)
			if (ctx.runMediaLibraryQueryCycle) ctx.runMediaLibraryQueryCycle()
		} catch (e) {
			const errMsg = e?.message || String(e)
			setDownloadState(ctx, {
				active: false,
				phase: 'error',
				kind: 'http',
				progress: null,
				message: 'Download failed',
				error: errMsg,
			})
			ingestLog(ctx, 'error', `HTTP download failed: ${errMsg}`)
		}
	})()

	return {
		status: 202,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, message: 'Download started', poll: '/api/ingest/download-status' }),
	}
}

async function handleIngestPreview(query, ctx) {
	const relPath = query.id || query.path
	if (!relPath) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'id required' }) }

	const config = ctx.config || {}
	const mediaBase = getMediaIngestBasePath(config)
	const fullPath = resolveSafe(mediaBase, relPath)

	if (!fullPath || !fs.existsSync(fullPath)) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'File not found' }) }
	}

	const stat = fs.statSync(fullPath)
	if (!stat.isFile()) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Not a file' }) }
	}

	// Dynamic content type detection
	const ext = path.extname(fullPath).toLowerCase()
	let contentType = 'application/octet-stream'
	if (['.mp4', '.mov', '.mxf', '.mkv'].includes(ext)) contentType = 'video/quicktime'
	if (['.png', '.jpg', '.jpeg', '.tga'].includes(ext)) contentType = 'image/png'

	return {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Content-Length': stat.size,
			'Accept-Ranges': 'bytes'
		},
		body: fs.createReadStream(fullPath)
	}
}

module.exports = { handleUpload, handleDownload, handleGetDownloadStatus, handleIngestPreview }

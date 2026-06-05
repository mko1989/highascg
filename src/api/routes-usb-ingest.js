/**
 * USB media ingest REST API (WO-29).
 */

'use strict'

const defaults = require('../config/defaults')
const { JSON_HEADERS, jsonBody, parseBody, parseQueryString } = require('./response')
const usbDrives = require('../media/usb-drives')

/**
 * @param {object} cfg
 */
function getUsbIngestConfig(cfg) {
	const d = defaults.usbIngest || {}
	const u = cfg?.usbIngest && typeof cfg.usbIngest === 'object' ? cfg.usbIngest : {}
	const policy = String(u.overwritePolicy || d.overwritePolicy || 'rename')
	const overwritePolicy = ['skip', 'overwrite', 'rename'].includes(policy) ? policy : 'rename'
	return {
		enabled: u.enabled !== false,
		defaultSubfolder: String(u.defaultSubfolder ?? d.defaultSubfolder ?? ''),
		overwritePolicy,
		verifyHash: !!(u.verifyHash ?? d.verifyHash),
	}
}

/**
 * @param {object} ctx
 * @param {object} patch
 */
function setUsbImportState(ctx, patch) {
	if (!ctx._usbImportState) {
		ctx._usbImportState = {
			active: false,
			phase: 'idle',
			progress: null,
			message: '',
			error: null,
			fileRel: '',
			fileIndex: 0,
			fileTotal: 0,
			bytesDone: 0,
			bytesTotal: 0,
			updatedAt: 0,
		}
	}
	Object.assign(ctx._usbImportState, patch, { updatedAt: Date.now() })
}

/** Simple sliding window rate limit for browse. */
function allowBrowse(ctx, req) {
	const ip = (req?.socket?.remoteAddress || 'local').replace(/^::ffff:/, '')
	if (!ctx._usbBrowseHits) ctx._usbBrowseHits = new Map()
	const now = Date.now()
	const winMs = 10000
	const max = 40
	let arr = ctx._usbBrowseHits.get(ip)
	if (!arr) {
		arr = []
		ctx._usbBrowseHits.set(ip, arr)
	}
	while (arr.length && arr[0] < now - winMs) arr.shift()
	if (arr.length >= max) return false
	arr.push(now)
	return true
}

/**
 * @param {object} ctx
 */
function ensureUsbEnabled(ctx) {
	const cfg = getUsbIngestConfig(ctx.config)
	if (!cfg.enabled) {
		return { status: 403, headers: JSON_HEADERS, body: jsonBody({ error: 'USB ingest is disabled in settings' }) }
	}
	return null
}

/**
 * GET /api/usb/drives
 * @param {object} ctx
 */
async function handleGetDrives(ctx) {
	const denied = ensureUsbEnabled(ctx)
	if (denied) return denied
	try {
		const drives = await usbDrives.listUsbDrives()
		const platformNote =
			process.platform === 'win32'
				? 'USB import from the server is not supported on Windows in this version.'
				: null
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, drives, platform: process.platform, platformNote }),
		}
	} catch (e) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
	}
}

/**
 * GET /api/usb/browse?driveId=&path=
 * @param {object} ctx
 * @param {Record<string, string>} query
 * @param {import('http').IncomingMessage} req
 */
async function handleBrowse(ctx, query, req) {
	const denied = ensureUsbEnabled(ctx)
	if (denied) return denied
	if (!allowBrowse(ctx, req)) {
		return { status: 429, headers: JSON_HEADERS, body: jsonBody({ error: 'Too many browse requests' }) }
	}
	const driveId = query.driveId || ''
	const relPath = query.path || ''
	if (!driveId) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'driveId required' }) }
	const r = await usbDrives.listDirectory(driveId, relPath)
	if (r.error) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: r.error }) }
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, entries: r.entries, path: relPath }),
	}
}

/**
 * GET /api/usb/import-status
 * @param {object} ctx
 */
function handleImportStatus(ctx) {
	const denied = ensureUsbEnabled(ctx)
	if (denied) return denied
	const s = ctx._usbImportState || {
		active: false,
		phase: 'idle',
		progress: null,
		message: '',
		error: null,
		fileRel: '',
		fileIndex: 0,
		fileTotal: 0,
		bytesDone: 0,
		bytesTotal: 0,
		updatedAt: 0,
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			active: !!s.active,
			phase: s.phase || 'idle',
			progress: s.progress == null ? null : Number(s.progress),
			message: s.message || '',
			error: s.error || null,
			fileRel: s.fileRel || '',
			fileIndex: s.fileIndex || 0,
			fileTotal: s.fileTotal || 0,
			bytesDone: s.bytesDone || 0,
			bytesTotal: s.bytesTotal || 0,
		}),
	}
}

/**
 * POST /api/usb/import
 * @param {object} ctx
 * @param {string} body
 */
async function handleImport(ctx, body) {
	const denied = ensureUsbEnabled(ctx)
	if (denied) return denied
	if (ctx._usbImportState?.active) {
		return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: 'An import is already running' }) }
	}
	const parsed = parseBody(body)
	const driveId = parsed?.driveId
	const items = parsed?.items
	const targetSubdirExtra = typeof parsed?.targetSubdir === 'string' ? parsed.targetSubdir : ''
	if (!driveId || !Array.isArray(items) || items.length === 0) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'driveId and items[] required' }) }
	}
	const uCfg = getUsbIngestConfig(ctx.config)
	const drive = await usbDrives.getDriveById(String(driveId))
	if (!drive) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Drive not found' }) }

	let targetSubdir = targetSubdirExtra.trim()
	if (!targetSubdir && uCfg.defaultSubfolder) {
		targetSubdir = usbDrives.formatImportSubdirTemplate(uCfg.defaultSubfolder, drive)
	}

	ctx._usbImportCancel = { cancelled: false }
	const cancelFn = () => {
		ctx._usbImportCancel.cancelled = true
	}

	setUsbImportState(ctx, {
		active: true,
		phase: 'queued',
		progress: null,
		message: 'Starting import…',
		error: null,
		fileRel: '',
		fileIndex: 0,
		fileTotal: 0,
		bytesDone: 0,
		bytesTotal: 0,
	})

	const broadcastProgress = (payload) => {
		if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('usb:copy-progress', payload)
	}

	;(async () => {
		try {
			const result = await usbDrives.copyFromUsb(ctx, {
				driveId: String(driveId),
				items: items.map((x) => String(x || '')),
				targetSubdir,
				overwritePolicy: uCfg.overwritePolicy,
				verifyHash: uCfg.verifyHash,
				isCancelled: () => !!(ctx._usbImportCancel && ctx._usbImportCancel.cancelled),
				setState: (patch) => setUsbImportState(ctx, patch),
				broadcast: broadcastProgress,
			})
			setUsbImportState(ctx, {
				active: false,
				phase: 'complete',
				progress: 100,
				message: `Imported ${result.imported} file(s)${result.skipped ? `, skipped ${result.skipped}` : ''}`,
				error: null,
			})
			broadcastProgress({ phase: 'complete', ...result })
			if (ctx.runMediaLibraryQueryCycle) ctx.runMediaLibraryQueryCycle()
		} catch (e) {
			const msg = e?.message || String(e)
			setUsbImportState(ctx, {
				active: false,
				phase: 'error',
				progress: null,
				message: 'Import failed',
				error: msg,
			})
			broadcastProgress({ phase: 'error', error: msg })
		} finally {
			ctx._usbImportCancel = null
		}
	})()

	return {
		status: 202,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, poll: '/api/usb/import-status', cancelHint: 'POST /api/usb/import-cancel' }),
	}
}

/**
 * POST /api/usb/import-cancel
 * @param {object} ctx
 */
function handleImportCancel(ctx) {
	const denied = ensureUsbEnabled(ctx)
	if (denied) return denied
	if (ctx._usbImportCancel) ctx._usbImportCancel.cancelled = true
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
}

/**
 * POST /api/usb/eject
 * @param {object} ctx
 * @param {string} body
 */
async function handleEject(ctx, body) {
	const denied = ensureUsbEnabled(ctx)
	if (denied) return denied
	const parsed = parseBody(body)
	const driveId = parsed?.driveId
	if (!driveId) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'driveId required' }) }
	const drive = await usbDrives.getDriveById(String(driveId))
	if (!drive) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Drive not found' }) }
	const r = await usbDrives.ejectUsb(drive)
	if (!r.ok) return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: r.message || 'Eject failed' }) }
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, message: r.message || 'OK' }) }
}

/**
 * @param {string} method
 * @param {string} p path without query
 * @param {string} pathWithQuery
 * @param {string} body
 * @param {object} ctx
 * @param {import('http').IncomingMessage} req
 */
async function handle(method, p, pathWithQuery, body, ctx, req) {
	const qIdx = pathWithQuery.indexOf('?')
	const query = parseQueryString(qIdx >= 0 ? pathWithQuery.slice(qIdx + 1) : '')

	if (method === 'GET' && p === '/api/usb/drives') return handleGetDrives(ctx)
	if (method === 'GET' && p === '/api/usb/browse') return handleBrowse(ctx, query, req)
	if (method === 'GET' && p === '/api/usb/import-status') return handleImportStatus(ctx)
	if (method === 'POST' && p === '/api/usb/import') return handleImport(ctx, body)
	if (method === 'POST' && p === '/api/usb/import-cancel') return handleImportCancel(ctx)
	if (method === 'POST' && p === '/api/usb/eject') return handleEject(ctx, body)
	return null
}

module.exports = {
	handle,
	getUsbIngestConfig,
}

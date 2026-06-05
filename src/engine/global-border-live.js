'use strict'

const fs = require('fs')
const path = require('path')

const { REPO_ROOT } = require('../repo-paths')
const { buildGlobalBorderCgJson } = require('./global-border')

/** Caspar template-path: live JSON siblings of pip_*.html (polled by CEF). */
const TEMPLATE_DIR = path.join(REPO_ROOT, 'template')

function liveFileName(channel) {
	const ch = parseInt(channel, 10)
	return `global-border-live-${Number.isFinite(ch) && ch >= 1 ? ch : 1}.json`
}

function liveFilePath(channel) {
	return path.join(TEMPLATE_DIR, liveFileName(channel))
}

/**
 * Atomic write of visual border state for template polling (no CG UPDATE per DMX step).
 * @param {number} channel — Caspar program channel
 * @param {{ type?: string, params?: object, slices?: array }} overlay
 */
function writeGlobalBorderLiveFile(channel, overlay, logFn) {
	if (!overlay?.type) return
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || ch < 1) return
	try {
		const raw = buildGlobalBorderCgJson(overlay)
		const payload = JSON.parse(raw)
		payload.liveFile = liveFileName(ch)
		const dest = liveFilePath(ch)
		const tmp = `${dest}.tmp`
		fs.mkdirSync(TEMPLATE_DIR, { recursive: true })
		fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8')
		fs.renameSync(tmp, dest)
	} catch (e) {
		const msg = e?.message || String(e)
		if (typeof logFn !== 'function') return
		const key = `${ch}:${msg}`
		const now = Date.now()
		const prev = liveWriteErrorLoggedAt.get(key) || 0
		if (now - prev < 30_000) return
		liveWriteErrorLoggedAt.set(key, now)
		logFn('warn', `[ArtNet] global-border live file write failed ch${ch}: ${msg}`)
	}
}

/** Last CG template type loaded per program channel (ADD only on change). */
const casparBorderTypeByChannel = new Map()

/** Throttle repeated live-file write errors (DMX can fire ~60/s). */
const liveWriteErrorLoggedAt = new Map()

function markCasparBorderType(channel, type) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || ch < 1 || !type) return
	casparBorderTypeByChannel.set(ch, String(type))
}

function casparBorderTypeChanged(channel, type) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || ch < 1) return true
	const prev = casparBorderTypeByChannel.get(ch)
	return prev == null || prev !== String(type)
}

function clearCasparBorderType(channel) {
	const ch = parseInt(channel, 10)
	if (Number.isFinite(ch) && ch >= 1) casparBorderTypeByChannel.delete(ch)
}

module.exports = {
	liveFileName,
	liveFilePath,
	writeGlobalBorderLiveFile,
	markCasparBorderType,
	casparBorderTypeChanged,
	clearCasparBorderType,
	TEMPLATE_DIR,
}

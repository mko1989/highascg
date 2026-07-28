'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const RENDER_PROFILE_VERSION = 2

/**
 * @param {object} [config]
 * @returns {string}
 */
function getCgThumbCacheDir(config) {
	const raw = (config?.cg_look_thumb_cache_path || '').trim()
	if (raw) return path.resolve(raw)
	return path.join(process.cwd(), 'data', 'cg-look-thumbs')
}

/**
 * WO-344 — the template FILE's fingerprint, so re-saving a shader busts its thumb.
 *
 * The hash below is built from the request alone (id, cgData, size). Editing a shader in Shader
 * Live rewrites `template/shaders/sh-*.html` without changing any of those, so the request hashed
 * identically and the deck kept serving the OLD picture — the acceptance criterion "thumb refresh
 * on shader re-save" could never hold. Best-effort: any resolution failure just leaves the hash as
 * it was (an un-fingerprinted template behaves exactly like before).
 * @param {object} req
 * @returns {string}
 */
function templateFileFingerprint(req) {
	try {
		// Lazy: the resolver lives in the render module, which must not depend on this one.
		const { resolveCgTemplateHtmlPath } = require('./cg-look-thumb-render')
		const p = resolveCgTemplateHtmlPath(req)
		if (!p) return ''
		const st = fs.statSync(p)
		return `${Math.floor(st.mtimeMs)}:${st.size}`
	} catch {
		return ''
	}
}

/**
 * @param {object} req
 * @returns {string}
 */
function hashCgThumbRequest(req) {
	const payload = {
		v: RENDER_PROFILE_VERSION,
		templateId: String(req?.templateId || req?.sourceValue || '').toLowerCase(),
		sourceValue: String(req?.sourceValue || '').trim(),
		cgData: req?.cgData ?? null,
		width: Number(req?.width) || 640,
		height: Number(req?.height) || 360,
		file: templateFileFingerprint(req),
	}
	return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32)
}

/**
 * @param {object} [config]
 * @param {string} hash
 * @returns {string}
 */
function cgThumbCachePath(config, hash) {
	const safe = String(hash || '').replace(/[^a-f0-9]/gi, '')
	return path.join(getCgThumbCacheDir(config), `${safe}.png`)
}

/**
 * @param {object} [config]
 */
function ensureCgThumbCacheDir(config) {
	const dir = getCgThumbCacheDir(config)
	fs.mkdirSync(dir, { recursive: true })
	return dir
}

/**
 * @param {object} [config]
 * @param {string} hash
 * @returns {{ exists: boolean, mtimeMs: number, path: string }}
 */
function readCgThumbCacheStat(config, hash) {
	const filePath = cgThumbCachePath(config, hash)
	if (!fs.existsSync(filePath)) return { exists: false, mtimeMs: 0, path: filePath }
	const st = fs.statSync(filePath)
	return { exists: true, mtimeMs: st.mtimeMs, path: filePath }
}

module.exports = {
	RENDER_PROFILE_VERSION,
	getCgThumbCacheDir,
	hashCgThumbRequest,
	cgThumbCachePath,
	ensureCgThumbCacheDir,
	readCgThumbCacheStat,
}

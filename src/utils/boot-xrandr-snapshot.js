'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

const DEFAULT_REL = path.join('data', 'runtime', 'boot-xrandr-query.txt')
const META_BASENAME = 'boot-xrandr-meta.json'

/** Default max age for boot capture (24 h). */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * @returns {string}
 */
function resolveBootXrandrQueryPath() {
	const env = String(process.env.HIGHASCG_BOOT_XRANDR_PATH || '').trim()
	if (env) return path.resolve(env)
	return path.join(REPO_ROOT, DEFAULT_REL)
}

/**
 * @param {string} queryPath
 * @returns {string}
 */
function resolveBootXrandrMetaPath(queryPath) {
	return path.join(path.dirname(queryPath), META_BASENAME)
}

/**
 * @param {{ maxAgeMs?: number }} [opts]
 * @returns {{ raw: string, meta: object | null, path: string } | null}
 */
function readBootXrandrSnapshot(opts = {}) {
	const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS
	const queryPath = resolveBootXrandrQueryPath()
	try {
		if (!fs.existsSync(queryPath)) return null
		const raw = fs.readFileSync(queryPath, 'utf8')
		if (!String(raw || '').trim()) return null

		let meta = null
		const metaPath = resolveBootXrandrMetaPath(queryPath)
		if (fs.existsSync(metaPath)) {
			try {
				meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
			} catch {
				meta = null
			}
		}
		const capturedAt = meta?.capturedAt ? Date.parse(String(meta.capturedAt)) : NaN
		if (Number.isFinite(capturedAt) && maxAgeMs > 0 && Date.now() - capturedAt > maxAgeMs) {
			return null
		}
		return { raw, meta, path: queryPath }
	} catch {
		return null
	}
}

module.exports = {
	DEFAULT_MAX_AGE_MS,
	resolveBootXrandrQueryPath,
	resolveBootXrandrMetaPath,
	readBootXrandrSnapshot,
}

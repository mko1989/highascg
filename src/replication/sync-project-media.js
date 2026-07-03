'use strict'

const fs = require('fs')
const path = require('path')
const { expandMediaIdToMediaRoot } = require('../media/project-media-root')

function resolveMediaFile(ref, mediaBase, slug, config) {
	const raw = String(ref || '').trim()
	if (!raw) return null
	const candidates = []
	if (slug) candidates.push(expandMediaIdToMediaRoot(raw, slug, config))
	candidates.push(raw, path.basename(raw))
	const seen = new Set()
	for (const cand of candidates) {
		const key = String(cand || '')
		if (!key || seen.has(key)) continue
		seen.add(key)
		const p = path.join(mediaBase, key)
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * Sync active project media + templates to/from peer via rsync over SSH.
 * Project media lives in media/projects/<slug>/ and spreads only on explicit
 * push/pull — the old `.replication-active` staging-folder workflow was removed
 * (it duplicated clips at the media root and hijacked clip resolution).
 * @param {object} ctx
 * @param {object} project
 * @param {{ direction?: 'push'|'pull'|'auto' }} [opts]
 */
async function syncProjectMediaToPeer(ctx, project, opts = {}) {
	const { rsyncProjectMediaToPeer } = require('./sync-project-media-rsync')
	return rsyncProjectMediaToPeer(ctx, project, opts)
}

module.exports = {
	syncProjectMediaToPeer,
	resolveMediaFile,
}

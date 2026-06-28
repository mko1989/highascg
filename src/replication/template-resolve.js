'use strict'

const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

const SKIP_VALUE_RE = /^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route):/i

/**
 * Resolve template id to an on-disk HTML file under repo template/.
 * @param {string} ref
 * @param {string} [repoRoot]
 * @returns {string|null}
 */
function resolveTemplateFile(ref, repoRoot = REPO_ROOT) {
	const raw = String(ref || '').trim().replace(/\.html$/i, '')
	if (!raw) return null
	const templateRoot = path.join(repoRoot, 'template')
	const candidates = [
		path.join(templateRoot, `${raw}.html`),
		path.join(templateRoot, raw),
		path.join(templateRoot, 'lower-thirds', `${raw}.html`),
		path.join(templateRoot, 'studio', `${raw}.html`),
	]
	for (const p of candidates) {
		try {
			const fs = require('fs')
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

module.exports = { resolveTemplateFile, SKIP_VALUE_RE }

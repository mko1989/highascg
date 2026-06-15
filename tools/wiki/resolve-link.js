'use strict'

const path = require('path')

/**
 * Resolve a markdown link for the standalone wiki (hash routes + file paths).
 * @param {string} href
 * @param {string} sourceFile docs-relative path e.g. wiki/api/project.md
 * @param {Map<string, { id: string }>} pageByFile
 * @param {string} currentPageId
 * @param {string} docsRoot
 * @param {string} siteDir docs/wiki-site
 * @param {string} repoRoot
 */
function resolveWikiLink(href, sourceFile, pageByFile, currentPageId, docsRoot, siteDir, repoRoot) {
	if (!href) return href
	if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) return href

	// Same-page or cross-page anchor: #heading
	if (href.startsWith('#')) {
		return `#/${encodeURIComponent(currentPageId)}${href}`
	}

	const [pathPart, ...rest] = href.split('#')
	const anchor = rest.length ? `#${rest.join('#')}` : ''
	const query = pathPart.includes('?') ? pathPart.slice(pathPart.indexOf('?')) : ''
	const targetPath = pathPart.split('?')[0]
	if (!targetPath) {
		return `#/${encodeURIComponent(currentPageId)}${anchor}${query}`
	}

	const sourceDir = path.dirname(sourceFile)
	let docsRel = path.normalize(path.join(sourceDir, targetPath)).replace(/\\/g, '/')
	if (docsRel.startsWith('../')) {
		// Path escapes docs/ — resolve from repo root instead.
		const sourceAbs = path.join(docsRoot, sourceFile)
		const abs = path.normalize(path.join(path.dirname(sourceAbs), targetPath))
		if (abs.startsWith(docsRoot + path.sep) || abs === docsRoot) {
			docsRel = path.relative(docsRoot, abs).replace(/\\/g, '/')
		} else if (abs.startsWith(repoRoot + path.sep)) {
			return fileLinkFromSite(abs, siteDir, anchor, query)
		}
	}

	// Markdown page in wiki
	if (docsRel.endsWith('.md')) {
		const page = pageByFile.get(docsRel)
		if (page) {
			return `#/${encodeURIComponent(page.id)}${anchor}${query}`
		}
		// Fallback: match by basename if unique
		const base = path.basename(docsRel)
		const matches = [...pageByFile.entries()].filter(([f]) => path.basename(f) === base)
		if (matches.length === 1) {
			return `#/${encodeURIComponent(matches[0][1].id)}${anchor}${query}`
		}
	}

	// Other files under docs/ (yaml, etc.)
	const docsAbs = path.join(docsRoot, docsRel)
	if (docsAbs.startsWith(docsRoot) && !docsRel.includes('..')) {
		try {
			const fs = require('fs')
			if (fs.existsSync(docsAbs)) {
				return fileLinkFromSite(docsAbs, siteDir, anchor, query)
			}
		} catch {
			/* ignore */
		}
	}

	// Repo files (src/, tools/, config/)
	const sourceAbs = path.join(docsRoot, sourceFile)
	const absFromSource = path.normalize(path.join(path.dirname(sourceAbs), targetPath))
	if (absFromSource.startsWith(repoRoot + path.sep)) {
		return fileLinkFromSite(absFromSource, siteDir, anchor, query)
	}

	return href
}

function fileLinkFromSite(absPath, siteDir, anchor, query) {
	const rel = path.relative(siteDir, absPath).replace(/\\/g, '/')
	if (rel.startsWith('..')) return rel + anchor + query
	return rel + anchor + query
}

module.exports = { resolveWikiLink }

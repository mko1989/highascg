/**
 * Scan lower-thirds and studio-export HTML templates on disk.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { getLtDir, getStudioDir } = require('./cg-studio-context')
const { getDefaultPayload, parseInitSelectors } = require('./lt-param-registry')

/** Built-in display names (id without .html). */
const BUILTIN_NAMES = {
	'lt-classic-box': 'Classic Box',
	'lt-slide-bar': 'Slide Bar',
	'lt-minimal-fade': 'Minimal Fade',
	'lt-split-color': 'Split Color',
	'lt-frosted-glass': 'Frosted Glass',
	'lt-underline-reveal': 'Underline Reveal',
	'lt-tag-badge': 'Tag Badge',
	'lt-gradient-wave': 'Gradient Wave',
	'lt-corner-bracket': 'Corner Bracket',
}

/**
 * @param {string} dir
 * @param {'lower-thirds' | 'studio'} category
 * @returns {Array<object>}
 */
function scanDir(dir, category) {
	if (!fs.existsSync(dir)) return []
	const thumbDir = path.join(getLtDir(), 'thumbnails')
	const out = []
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!ent.isFile() || !ent.name.endsWith('.html') || !ent.name.startsWith('lt-')) continue
		const id = ent.name.replace(/\.html$/, '')
		const htmlPath = category + '/' + ent.name
		const casparPath = htmlPath.replace(/\.html$/, '')
		const thumbFile = path.join(thumbDir, id + '.png')
		out.push({
			id,
			name: BUILTIN_NAMES[id] || humanizeId(id),
			category,
			htmlPath,
			casparPath,
			available: true,
			thumbnail: fs.existsSync(thumbFile) ? '/studio-assets/lower-thirds/thumbnails/' + id + '.png' : null,
			previewUrl: '/studio-assets/' + htmlPath + '?studio=1',
		})
	}
	return out.sort((a, b) => a.name.localeCompare(b.name))
}

function humanizeId(id) {
	return id
		.replace(/^lt-/, '')
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')
}

/**
 * @returns {Array<object>}
 */
function scanAllTemplates() {
	return scanDir(getLtDir(), 'lower-thirds').concat(scanDir(getStudioDir(), 'studio'))
}

/**
 * @param {string} id
 * @param {'lower-thirds' | 'studio'} [category]
 * @returns {{ filePath: string, category: string } | null}
 */
function resolveTemplateFile(id, category) {
	const safeId = String(id || '').replace(/\.html$/, '')
	if (!/^lt-[a-z0-9-]+$/.test(safeId)) return null
	const studioDir = getStudioDir()
	const ltDir = getLtDir()
	if (category === 'studio' || (!category && fs.existsSync(path.join(studioDir, safeId + '.html')))) {
		const fp = path.join(studioDir, safeId + '.html')
		if (fs.existsSync(fp)) return { filePath: fp, category: 'studio' }
	}
	if (category === 'lower-thirds' || !category) {
		const fp = path.join(ltDir, safeId + '.html')
		if (fs.existsSync(fp)) return { filePath: fp, category: 'lower-thirds' }
	}
	return null
}

/**
 * @param {string} id
 * @param {'lower-thirds' | 'studio'} [category]
 * @returns {object | null}
 */
function getTemplateDetail(id, category) {
	const resolved = resolveTemplateFile(id, category)
	if (!resolved) return null
	const selectors = parseInitSelectors(fs.readFileSync(resolved.filePath, 'utf8'))
	const defaults = getDefaultPayload(id)
	const all = scanAllTemplates()
	const meta = all.find((t) => t.id === id && t.category === resolved.category)
	return {
		...(meta || { id, category: resolved.category }),
		selectors,
		fields: require('./lt-param-registry').getFieldsForTemplate(id),
		defaults,
	}
}

module.exports = {
	BUILTIN_NAMES,
	scanAllTemplates,
	resolveTemplateFile,
	getTemplateDetail,
}

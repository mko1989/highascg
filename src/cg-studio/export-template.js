/**
 * Export inspector values as a new CasparCG HTML template (lt-engine contract).
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { parseInitSelectors } = require('./lt-param-registry')
const { resolveTemplateFile } = require('./template-scan')
const { getStudioDir } = require('./cg-studio-context')

const EXPORT_ID_RE = /^lt-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

function fixStudioAssetPaths(html) {
	return html
		.replace(/src="vendor\//g, 'src="../lower-thirds/vendor/')
		.replace(/src="lt-engine\.js"/g, 'src="../lower-thirds/lt-engine.js"')
		.replace(/src="lt-engine-controls\.js"/g, 'src="../lower-thirds/lt-engine-controls.js"')
}

function bakeDefaults(html, payload) {
	const data = payload.data || {}
	const style = payload.style || {}
	const { titleSel, subtitleSel } = parseInitSelectors(html)
	let out = html

	const titleText = data.title ?? data.name ?? data.f0 ?? ''
	const subtitleText = data.subtitle ?? data.role ?? data.f1 ?? ''

	if (titleText) out = replaceSelectorText(out, titleSel, titleText)
	if (subtitleText) out = replaceSelectorText(out, subtitleSel, subtitleText)

	const cssVars = []
	if (style.primaryColor) cssVars.push(`--primary: ${style.primaryColor}`)
	if (style.textColor) cssVars.push(`--text: ${style.textColor}`)
	if (style.gradientMid) cssVars.push(`--grad-mid: ${style.gradientMid}`)
	if (style.gradientEnd) cssVars.push(`--grad-end: ${style.gradientEnd}`)
	if (style.panelColor) cssVars.push(`--panel: ${style.panelColor}`)

	if (cssVars.length) {
		const block = `:root { ${cssVars.join('; ')}; }`
		if (out.includes(':root')) {
			out = out.replace(/:root\s*\{[^}]*\}/, block)
		} else if (out.includes('</style>')) {
			out = out.replace('</style>', `${block}\n</style>`)
		}
	}

	// WO-321: colors bake as CSS vars above (the engine's applyStyles never touches color), but every
	// OTHER style field — typography, layout, box size, opacity, timing — is applied by the engine at
	// runtime from its style store, which an exported template previously never seeded. Bake the full
	// style into window.__LT_INITIAL_STYLE__ so lt-engine.js seeds it at init and the export renders
	// the studio's configured look, not just its colors. (data/text is already baked into the HTML.)
	const seed = {}
	for (const [k, v] of Object.entries(style)) {
		if (v == null || v === '') continue
		if (/color|gradient|panel/i.test(k)) continue // colors ride the CSS vars above, not the engine seed
		seed[k] = v
	}
	if (Object.keys(seed).length) {
		// Escape </ so a style value can never close the injected <script> early.
		const json = JSON.stringify(seed).replace(/<\//g, '<\\/')
		const seedScript = `<script>window.__LT_INITIAL_STYLE__ = ${json};</script>`
		if (out.includes('</head>')) out = out.replace('</head>', `${seedScript}\n</head>`)
		else out = seedScript + out
	}

	return out
}

function replaceSelectorText(html, selector, text) {
	const escaped = escapeHtml(text)
	if (selector === 'h1' || selector.endsWith(' h1')) {
		return html.replace(/(<h1[^>]*>)([\s\S]*?)(<\/h1>)/i, `$1${escaped}$3`)
	}
	if (selector.includes('.subtitle p') || selector.endsWith(' p')) {
		const subBlock = html.match(/<div[^>]*class="[^"]*subtitle[^"]*"[^>]*>[\s\S]*?<\/div>/i)
		if (subBlock) {
			return html.replace(
				/(<div[^>]*class="[^"]*subtitle[^"]*"[^>]*>[\s\S]*?<p[^>]*>)([\s\S]*?)(<\/p>)/i,
				`$1${escaped}$3`,
			)
		}
		return html.replace(/(<p[^>]*>)([\s\S]*?)(<\/p>)/i, `$1${escaped}$3`)
	}
	return html
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function validateExportedHtml(html, style) {
	if (!html.includes('LTEngine.init')) throw new Error('Export missing LTEngine.init')
	if (!html.includes('lt-engine.js')) throw new Error('Export missing lt-engine.js reference')
	// WO-321: guard against the original "only exports color changes" bug — a non-color style must be
	// persisted via the window.__LT_INITIAL_STYLE__ seed, or the exported template silently reverts
	// typography/layout/box/timing to the base template's defaults on air.
	const hasNonColorStyle =
		style &&
		typeof style === 'object' &&
		Object.entries(style).some(([k, v]) => v != null && v !== '' && !/color|gradient|panel/i.test(k))
	if (hasNonColorStyle && !html.includes('window.__LT_INITIAL_STYLE__')) {
		throw new Error('Export dropped non-color style (missing window.__LT_INITIAL_STYLE__ seed)')
	}
}

function exportTemplate(opts) {
	const baseId = String(opts.baseTemplateId || '').replace(/\.html$/, '')
	const exportId = String(opts.exportId || '').replace(/\.html$/, '')
	if (!EXPORT_ID_RE.test(exportId)) {
		throw new Error('exportId must match lt-[a-z0-9-]+')
	}

	const source = resolveTemplateFile(baseId, opts.baseCategory)
	if (!source) throw new Error('Base template not found: ' + baseId)

	const raw = fs.readFileSync(source.filePath, 'utf8')
	let html = bakeDefaults(raw, { data: opts.data, style: opts.style })
	html = fixStudioAssetPaths(html)
	validateExportedHtml(html, opts.style)

	const studioDir = getStudioDir()
	fs.mkdirSync(studioDir, { recursive: true })
	const dest = path.join(studioDir, exportId + '.html')
	if (fs.existsSync(dest) && exportId !== baseId) {
		throw new Error('Template already exists: ' + exportId)
	}
	fs.writeFileSync(dest, html, 'utf8')

	const htmlPath = 'studio/' + exportId + '.html'
	return {
		ok: true,
		id: exportId,
		name: opts.exportName || exportId,
		casparPath: 'studio/' + exportId,
		htmlPath,
		filePath: dest,
	}
}

module.exports = {
	exportTemplate,
	bakeDefaults,
	validateExportedHtml,
}

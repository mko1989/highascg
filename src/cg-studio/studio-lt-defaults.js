/**
 * WO-663 — what a CG Studio export (`template/studio/lt-*.html`) has baked in: its title / subtitle text
 * (export-template.js bakeDefaults writes them into the title/subtitle elements), its colours (the `:root` CSS
 * vars) and its non-colour style (the `window.__LT_INITIAL_STYLE__` seed, WO-321).
 *
 * lt-engine never reads the baked text back — a play with no data shows its own "Name / Title" — so a studio
 * lower third with no operator text takes with these values (scene-template-cg.js), and the inspector opens
 * pre-filled with them instead of empty fields.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { parseInitSelectors } = require('./lt-param-registry')

const STUDIO_DIR = path.join(__dirname, '..', '..', 'template', 'studio')
/** `__LT_INITIAL_STYLE__` keys the lower-third inspector edits (client/lib/lower-third-cg-data.js). */
const CONFIG_STYLE_KEYS = ['position', 'titleFontSize', 'subtitleFontSize', 'displayDurationSec']

const decode = (s) =>
	String(s)
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.trim()

/** The text bakeDefaults wrote for `selector` (same element choice as its replaceSelectorText). */
function bakedText(html, selector) {
	if (selector === 'h1' || selector.endsWith(' h1')) {
		const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
		return m ? decode(m[1]) : ''
	}
	if (selector.includes('.subtitle p') || selector.endsWith(' p')) {
		const sub = html.match(/<div[^>]*class="[^"]*subtitle[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
		const m = sub || html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
		return m ? decode(m[1]) : ''
	}
	return ''
}

/**
 * @param {string} html a studio export
 * @returns {{ title: string, subtitle: string, primaryColor?: string, textColor?: string, position?: string,
 *   titleFontSize?: number, subtitleFontSize?: number, displayDurationSec?: number }}
 */
function studioLtDefaultsFromHtml(html) {
	const body = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
	const { titleSel, subtitleSel } = parseInitSelectors(html)
	/** @type {Record<string, any>} */
	const out = { title: bakedText(body, titleSel), subtitle: bakedText(body, subtitleSel) }
	const root = html.match(/:root\s*\{([^}]*)\}/)
	if (root) {
		const v = (name) => root[1].match(new RegExp(`--${name}\\s*:\\s*([^;]+)`))?.[1].trim()
		if (v('primary')) out.primaryColor = v('primary')
		if (v('text')) out.textColor = v('text')
	}
	const seed = html.match(/window\.__LT_INITIAL_STYLE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/)
	if (seed) {
		try {
			const s = JSON.parse(seed[1])
			for (const k of CONFIG_STYLE_KEYS)
				if (s[k] != null && s[k] !== '') out[k] = k === 'position' ? String(s[k]) : Number(s[k])
		} catch {
			/* a hand-edited seed — the text and colours still count */
		}
	}
	return out
}

/**
 * @param {string} id `lt-…` (a studio export id) or a Caspar path `studio/lt-…`
 * @param {string} [dir]
 * @returns {ReturnType<typeof studioLtDefaultsFromHtml> | null} null when there is no such export
 */
function studioLtDefaults(id, dir = STUDIO_DIR) {
	const m = String(id || '')
		.toLowerCase()
		.match(/(?:^|\/)(lt-[a-z0-9-]+)$/)
	if (!m) return null
	try {
		return studioLtDefaultsFromHtml(fs.readFileSync(path.join(dir, m[1] + '.html'), 'utf8'))
	} catch {
		return null
	}
}

module.exports = { studioLtDefaults, studioLtDefaultsFromHtml }

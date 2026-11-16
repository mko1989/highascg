'use strict'

/**
 * WO-1096 — licence/attribution of the shader library (third-party works, NOT under HighAsCG's AGPL).
 *
 * Every Shadertoy-dialect shader carries an attribution header at the top of its image pass:
 *
 *   // <title> — by <author>
 *   // <source URL>
 *   // License: <licence> — <licence URL> [(basis)]
 *   // Note: … / Converted for HighAsCG … / Modified for HighAsCG …   (optional)
 *
 * A FragCoord shader (WO-999) keeps its attribution in `config.source` (author, url, license) instead.
 * tools/shaders/shader-licence-manifest.js turns these headers into template/shaders/LICENSES/manifest.json, and the
 * Shadertoy link import (shadertoy-import.js) writes the header on every new import.
 */

/** Shadertoy's terms ("What license will my Shaders have?"), read from web.archive.org snapshots 20251001020819 and
 * 20250920061115 of https://www.shadertoy.com/terms (the live page answers 403 to non-browser clients). */
const SHADERTOY_TERMS_URL = 'https://www.shadertoy.com/terms'
const SHADERTOY_DEFAULT_LICENCE = 'CC-BY-NC-SA-3.0'

/** SPDX-style id → { url, nc: non-commercial only, sa: share-alike, own: HighAsCG's own code }. */
const LICENCES = {
	'CC-BY-NC-SA-3.0': { url: 'https://creativecommons.org/licenses/by-nc-sa/3.0/', nc: true, sa: true },
	'CC-BY-NC-SA-4.0': { url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', nc: true, sa: true },
	'CC-BY-NC-4.0': { url: 'https://creativecommons.org/licenses/by-nc/4.0/', nc: true, sa: false },
	'CC-BY-3.0': { url: 'https://creativecommons.org/licenses/by/3.0/', nc: false, sa: false },
	'CC-BY-4.0': { url: 'https://creativecommons.org/licenses/by/4.0/', nc: false, sa: false },
	'CC0-1.0': { url: 'https://creativecommons.org/publicdomain/zero/1.0/', nc: false, sa: false },
	MIT: { url: 'https://opensource.org/licenses/MIT', nc: false, sa: false },
	'AGPL-3.0-or-later': { url: 'https://www.gnu.org/licenses/agpl-3.0.html', nc: false, sa: true, own: true },
}

/** Licence statements that forbid redistribution — never shippable. */
const FORBIDDEN_RE = /all rights reserved|proprietary/i

/**
 * Licence id named by a licence statement (one line of text), or null when it names nothing we recognise.
 * Order matters: the NC-SA variants before plain NC, NC before plain BY.
 * @param {string} text
 * @returns {string|null}
 */
function licenceIdFromText(text) {
	const s = String(text || '')
	if (FORBIDDEN_RE.test(s)) return null
	if (/(NonCommercial-ShareAlike|by-nc-sa)[\s/-]*4\.0/i.test(s)) return 'CC-BY-NC-SA-4.0'
	if (/(NonCommercial-ShareAlike|by-nc-sa)[\s/-]*3\.0/i.test(s)) return 'CC-BY-NC-SA-3.0'
	if (/(CC[\s-]BY-NC|by-nc)[\s/-]*4\.0/i.test(s)) return 'CC-BY-NC-4.0'
	if (/AGPL-3\.0/.test(s)) return 'AGPL-3.0-or-later'
	if (/\bCC0\b|cc0-1\.0|public ?domain/i.test(s)) return 'CC0-1.0'
	if (/\bMIT\b/i.test(s)) return 'MIT'
	if (/(CC[\s-]BY|licenses\/by)[\s/-]*4\.0/i.test(s)) return 'CC-BY-4.0'
	if (/(CC[\s-]BY|licenses\/by)[\s/-]*3\.0/i.test(s)) return 'CC-BY-3.0'
	return null
}

/**
 * Parse the attribution header at the top of a shader source (leading `//` lines only).
 * @param {string} source
 * @returns {{ title: string, author: string, url: string, licenceLine: string, licence: string|null, notes: string[], modified: boolean } | null}
 */
function parseShaderHeader(source) {
	const lines = []
	for (const raw of String(source || '').split('\n')) {
		const l = raw.trim()
		if (!l.startsWith('//')) break
		lines.push(l.replace(/^\/\/\s?/, '').trim())
	}
	const by = /^(.+?) — by (.+)$/.exec(lines[0] || '')
	const url = /^(https?:\/\/\S+)$/.exec(lines[1] || '')
	const lic = lines.find((l) => /^License:\s*/i.test(l))
	if (!by || !url || !lic) return null
	const licenceLine = lic.replace(/^License:\s*/i, '')
	return {
		title: by[1].trim(),
		author: by[2].trim(),
		url: url[1],
		licenceLine,
		licence: licenceIdFromText(licenceLine),
		notes: lines.filter((l) => /^(Note|Based on|Ported to|Converted for|Imported for|Modified for)\b/.test(l)),
		modified: lines.some((l) => /^(Converted|Modified) for HighAsCG/.test(l)),
	}
}

/**
 * The attribution header lines for a shader (newline-terminated, ready to prepend to its image pass).
 * @param {{ title: string, author: string, url: string, licence: string, basis?: string, notes?: string[] }} a
 */
function buildShaderHeader(a) {
	const L = LICENCES[a.licence]
	if (!L) throw new Error(`unknown licence "${a.licence}"`)
	const out = [
		`// ${String(a.title).trim()} — by ${String(a.author).trim()}`,
		`// ${a.url}`,
		`// License: ${a.licence} — ${L.url}${a.basis ? ` (${a.basis})` : ''}`,
		...(a.notes || []).map((n) => `// ${n}`),
	]
	return out.join('\n') + '\n\n'
}

/**
 * Attribution of a stored config, either dialect.
 * @param {any} cfg
 */
function shaderAttribution(cfg) {
	if (cfg?.dialect === 'fragcoord') {
		const s = cfg.source || {}
		if (!s.author || !s.url || !s.license) return null
		return {
			title: String(s.title || cfg.name),
			author: String(s.author),
			url: String(s.url),
			licenceLine: `${s.license}${s.licenseUrl ? ` — ${s.licenseUrl}` : ''}`,
			licence: licenceIdFromText(s.license),
			notes: [`Imported from ${s.site || 'fragcoord'} (WO-999); attribution kept in the config's "source" field`],
			modified: false,
		}
	}
	return parseShaderHeader(cfg?.passes?.image?.source)
}

/**
 * WO-1096 — shaders taken out of the shipped library. On a box that still has the untracked data/shaders/<id>.json,
 * the store neither re-exports nor lists them — unless the operator gave the config a valid attribution header (that is
 * the opt-in: a header with a known licence brings it back). Reasons: template/shaders/LICENSES/opt-in.json.
 */
const RETIRED_SHADER_IDS = new Set([
	'sh-mario',
	'sh-balatro',
	'sh-audio-visualiser-v0-1-sadeghi',
	'sh-blue-thunder',
	'sh-closer-to-god',
	'sh-dot-globe',
	'sh-shader-equalizor',
])

/** @param {string} id @param {any} cfg */
function isRetiredShader(id, cfg) {
	if (!RETIRED_SHADER_IDS.has(id)) return false
	const a = shaderAttribution(cfg)
	return !(a && a.licence)
}

module.exports = {
	SHADERTOY_TERMS_URL,
	SHADERTOY_DEFAULT_LICENCE,
	LICENCES,
	FORBIDDEN_RE,
	licenceIdFromText,
	parseShaderHeader,
	buildShaderHeader,
	shaderAttribution,
	RETIRED_SHADER_IDS,
	isRetiredShader,
}

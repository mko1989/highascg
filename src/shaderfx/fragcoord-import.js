'use strict'

/**
 * WO-999 step 3 — paste a FragCoord link, get a native FragCoord library config (fragcoord-config.js).
 *
 * The source is public without login: FragCoord's MCP server (`https://fragcoord.xyz/mcp`, JSON-RPC over HTTP) answers
 * `get_shader {slug}` with the same markdown as `https://fragcoord.xyz/s/<slug>.md`: title, `**Author:** … ·
 * **License:** … · **Tags:** …`, then `## Source` with one `### <label> (<kind>)` heading + fenced block per pass —
 * kind `common`, `main`, or `pass` (aux passes, numbered by their order: the first is u_pass1).
 *
 * Licenses gate the import (the library ships in a public repo and plays paid shows):
 *   - "none specified (all rights reserved)" → refused; FragCoord itself says to link, not copy;
 *   - non-commercial (NC) → refused unless the caller passes `allowNonCommercial`;
 *   - the rest (CC0, MIT, CC-BY[-SA], GPL, Apache…) → kept with author + URL for attribution.
 *
 * Many shaders are written in FragCoord's "golf" macro dialect (the macro set is undocumented); those passes go through
 * the MCP `convert_shader {from: 'golf', to: 'glsl'}` and the golf original is kept in `source.golf`.
 *
 * Pure parts (`fragcoordSlugFromInput`, `parseFragcoordMarkdown`, `classifyLicense`, `looksGolf`,
 * `fragcoordConfigFromParsed`) are tested offline; `fetchFragcoordMarkdown` / `convertGolf` are the network edge.
 */

const MCP_URL = 'https://fragcoord.xyz/mcp'
const UA = 'highascg-shader-import/1.0'
const SLUG_RE = /^[a-z0-9]{6,16}$/i
const MAX_AUX = 8

/**
 *   https://fragcoord.xyz/s/ao6dc217[.md]  → ao6dc217
 *   https://fragcoord.xyz/embed/ao6dc217   → ao6dc217
 *   ao6dc217                               → ao6dc217
 * @returns {string|null}
 */
function fragcoordSlugFromInput(raw) {
	const s = String(raw ?? '').trim()
	if (!s) return null
	const m = /fragcoord\.xyz\/(?:s|embed)\/([A-Za-z0-9]+)/i.exec(s)
	if (m) return SLUG_RE.test(m[1]) ? m[1] : null
	if (/[/:.]/.test(s)) return null // some other URL
	return SLUG_RE.test(s) ? s : null
}

/** True for a FragCoord link (so the import route picks this importer over Shadertoy's). */
function isFragcoordInput(raw) {
	return /fragcoord\.xyz\//i.test(String(raw ?? ''))
}

/** `[label](url)` → {label, url}; plain text → {label, url: ''}. */
function mdLink(s) {
	const m = /^\[([^\]]*)\]\(([^)]*)\)/.exec(String(s || '').trim())
	return m ? { label: m[1].trim(), url: m[2].trim() } : { label: String(s || '').trim(), url: '' }
}

/**
 * @param {string} md
 * @returns {{ title: string, author: string, authorUrl: string, license: string, licenseUrl: string, tags: string[],
 *            url: string, common: string, main: string, aux: Array<{label: string, code: string}>, hidden: boolean }}
 */
function parseFragcoordMarkdown(md) {
	const text = String(md || '').replace(/\r\n/g, '\n')
	const title = (/^# (.+)$/m.exec(text) || [])[1]?.trim() || ''
	const meta = (/^\*\*Author:\*\*.*$/m.exec(text) || [''])[0]
	const field = (name) => (new RegExp(`\\*\\*${name}:\\*\\*\\s*([^·\\n]*)`).exec(meta) || [])[1]?.trim() || ''
	const author = mdLink(field('Author'))
	const license = mdLink(field('License'))
	const tags = field('Tags')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean)
	const url = (/^- Live shader:\s*(\S+)/m.exec(text) || [])[1] || ''
	const out = {
		title,
		author: author.label.replace(/^@/, ''),
		authorUrl: author.url,
		license: license.label,
		licenseUrl: license.url,
		tags,
		url,
		common: '',
		main: '',
		aux: [],
		hidden: false,
	}
	const src = text.indexOf('\n## Source')
	if (src < 0) {
		out.hidden = true
		return out
	}
	const re = /^### (.+?) \((common|main|pass)\)\s*\n+```[^\n]*\n([\s\S]*?)\n```/gm
	re.lastIndex = src
	let m
	while ((m = re.exec(text))) {
		const [, label, kind, code] = m
		if (kind === 'common') out.common = code
		else if (kind === 'main') out.main = code
		else out.aux.push({ label: label.trim(), code })
	}
	if (!out.main.trim()) out.hidden = true
	return out
}

/**
 * @returns {{ kind: 'open'|'nc'|'none', shareAlike: boolean }}
 */
function classifyLicense(label) {
	const s = String(label || '').toLowerCase()
	if (!s || /none specified|all rights reserved|^none$/.test(s)) return { kind: 'none', shareAlike: false }
	const shareAlike = /\bsa\b|share.?alike|gpl/.test(s)
	if (/\bnc\b|non.?commercial/.test(s)) return { kind: 'nc', shareAlike }
	return { kind: 'open', shareAlike }
}

/**
 * FragCoord golf: its loop macro `@(`, the f2/f3/f4 types, or golf-typed uniforms (`uniform f2 R`). Markers only — a
 * `golf` tag says nothing about a given pass (a golf Main often sits next to a plain-GLSL Common of uniform lines, and
 * "converting" that Common added an empty `void main()` beside Main's).
 */
function looksGolf(code) {
	const c = String(code || '')
	if (!c.trim()) return false
	return /@\s*\(/.test(c) || /(?:^|[\s(;,])f[234]\s*[\s(]/m.test(c) || /^\s*uniform\s+(?:f|f[234]|s2)\s+[A-Z]\b/m.test(c)
}

/** `<title>` → `sh-fc-<slug>-<words>`, inside the store's id rules (shader-store.js isValidShaderId). */
function fragcoordShaderId(slug, title) {
	const words = String(title || '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/, '')
	return `sh-fc-${String(slug).toLowerCase()}${words ? '-' + words : ''}`
}

/**
 * The library config for a parsed (and, where needed, golf-converted) shader.
 * @param {ReturnType<typeof parseFragcoordMarkdown>} p
 * @param {string} slug
 * @param {{ golf?: Record<string, string> }} [extra] the golf originals of converted passes
 */
function fragcoordConfigFromParsed(p, slug, extra = {}) {
	const lic = classifyLicense(p.license)
	const passes = { main: { source: p.main } }
	p.aux.slice(0, MAX_AUX).forEach((a, i) => {
		passes[`pass${i + 1}`] = { source: a.code }
	})
	return {
		id: fragcoordShaderId(slug, p.title),
		name: p.title || `FragCoord ${slug}`,
		dialect: 'fragcoord',
		common: p.common,
		passes,
		opts: { alpha: false },
		source: {
			site: 'fragcoord',
			slug,
			url: p.url || `https://fragcoord.xyz/s/${slug}`,
			title: p.title,
			author: p.author,
			authorUrl: p.authorUrl,
			license: p.license,
			licenseUrl: p.licenseUrl,
			licenseKind: lic.kind,
			...(extra.golf && Object.keys(extra.golf).length ? { golf: extra.golf } : {}),
		},
		skipped: p.aux.length > MAX_AUX ? p.aux.slice(MAX_AUX).map((a) => a.label) : [],
	}
}

async function mcpCall(name, args, fetchImpl = fetch) {
	const r = await fetchImpl(MCP_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': UA },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
		signal: AbortSignal.timeout(20000),
	})
	if (!r.ok) throw new Error(`FragCoord ${name}: HTTP ${r.status}`)
	let body = await r.text()
	if (/^(event|data):/m.test(body)) body = (/^data:\s*(.*)$/m.exec(body) || [])[1] || '' // SSE framing
	const j = JSON.parse(body)
	if (j.error) throw new Error(`FragCoord ${name}: ${j.error.message || 'error'}`)
	if (j.result?.isError) throw new Error(`FragCoord ${name}: ${j.result.content?.[0]?.text || 'error'}`)
	return String(j.result?.content?.[0]?.text ?? '')
}

/** The shader page as markdown: the MCP `get_shader`, else the public `.md` page. */
async function fetchFragcoordMarkdown(slug, fetchImpl = fetch) {
	try {
		return await mcpCall('get_shader', { slug, include_source: true }, fetchImpl)
	} catch (e) {
		const r = await fetchImpl(`https://fragcoord.xyz/s/${encodeURIComponent(slug)}.md`, {
			headers: { 'User-Agent': UA },
			signal: AbortSignal.timeout(20000),
		})
		if (!r.ok) throw new Error(`FragCoord shader ${slug} not found (${e.message}; page HTTP ${r.status})`, { cause: e })
		return r.text()
	}
}

/** golf → GLSL through FragCoord's own converter; the answer may wrap the code in a fence. */
async function convertGolf(code, fetchImpl = fetch) {
	const t = await mcpCall('convert_shader', { source: code, from: 'golf', to: 'glsl' }, fetchImpl)
	const fenced = /```[^\n]*\n([\s\S]*?)\n```/.exec(t)
	let out = fenced ? fenced[1] : t
	try {
		const j = JSON.parse(t)
		out = j.source || j.code || j.output || out
	} catch {
		/* plain text */
	}
	if (!String(out).trim()) throw new Error('golf conversion returned nothing')
	return String(out)
}

/**
 * The converter wraps every golf body in `void main() { … }` — for a Common of declarations only that leaves an empty
 * main (comments at most), which would collide with Main's. Only an empty one is removed.
 */
function stripEmptyMain(code) {
	return String(code).replace(/\bvoid\s+main\s*\(\s*\)\s*\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}/g, '')
}

/**
 * Link → gated, converted library config (not saved).
 * @param {string} input link or slug
 * @param {{ allowNonCommercial?: boolean, fetchImpl?: typeof fetch }} [opts]
 */
async function importFragcoordShader(input, opts = {}) {
	const slug = fragcoordSlugFromInput(input)
	if (!slug) throw new Error('not a FragCoord shader link')
	const f = opts.fetchImpl || fetch
	const p = parseFragcoordMarkdown(await fetchFragcoordMarkdown(slug, f))
	if (p.hidden) throw new Error(`"${p.title || slug}" has no public source (marketplace shader) — nothing to import`)
	const lic = classifyLicense(p.license)
	if (lic.kind === 'none') {
		throw new Error(
			`"${p.title}" by ${p.author} has no license (all rights reserved) — it can only be linked, not copied: ${p.url || 'https://fragcoord.xyz/s/' + slug}`
		)
	}
	if (lic.kind === 'nc' && !opts.allowNonCommercial) {
		throw new Error(
			`"${p.title}" is ${p.license} — non-commercial use only; import it with allowNonCommercial to keep it for non-paid work`
		)
	}
	const golf = {}
	for (const [key, get, set] of [
		['common', () => p.common, (v) => (p.common = v)],
		['main', () => p.main, (v) => (p.main = v)],
		...p.aux.map((a, i) => [`pass${i + 1}`, () => a.code, (v) => (a.code = v)]),
	]) {
		const code = get()
		if (!looksGolf(code)) continue
		golf[key] = code
		const glsl = await convertGolf(code, f)
		set(key === 'common' ? stripEmptyMain(glsl) : glsl)
	}
	return { ...fragcoordConfigFromParsed(p, slug, { golf }), licenseKind: lic.kind, shareAlike: lic.shareAlike }
}

module.exports = {
	fragcoordSlugFromInput,
	isFragcoordInput,
	parseFragcoordMarkdown,
	classifyLicense,
	looksGolf,
	fragcoordShaderId,
	stripEmptyMain,
	importFragcoordShader,
}

#!/usr/bin/env node
'use strict'

/**
 * WO-1096 — the shader library's licence manifest: template/shaders/LICENSES/manifest.json.
 *
 *   node tools/shaders/shader-licence-manifest.js            report: counts per licence + every problem (exit 1 on any)
 *   node tools/shaders/shader-licence-manifest.js --write    rebuild the manifest from the shaders' attribution headers
 *   node tools/shaders/shader-licence-manifest.js --check    exit 1 when the manifest is stale or a shader has a problem
 *
 * Source of truth is the attribution header at the top of each shader's image pass (src/shaderfx/shader-licence.js):
 * the manifest is derived from it, never edited by hand. Two sections:
 *   - `templates`: every tracked template/shaders/<id>.html (the shipped artefact; its embedded config is parsed);
 *   - `boxLibrary`: data/shaders configs with no template (WO-999 FragCoord shaders) — box state, untracked, so a
 *     fresh clone keeps the committed rows instead of dropping them.
 * To fix an attribution: edit the header in the shader editor and save (writes both halves), then --write.
 *
 * WO-1106 B67: only shippable shaders are recorded. A NonCommercial licence is a problem (it does not ship: owner
 * 17.11.26), and NC / retired configs a box holds locally are not part of the library, so `boxLibrary` skips them.
 * The withdrawn NC shaders are recorded in LICENSES/withdrawn-nc.json instead.
 */

const fs = require('fs')
const path = require('path')
const {
	LICENCES,
	FORBIDDEN_RE,
	SHADERTOY_TERMS_URL,
	SHADERTOY_DEFAULT_LICENCE,
	shaderAttribution,
	isShippableShader,
	isNonCommercialLicence,
	WITHDRAWN_NC_SHADERS,
} = require('../../src/shaderfx/shader-licence')

const DEFAULT_ROOT = path.join(__dirname, '..', '..')
const MANIFEST_REL = 'template/shaders/LICENSES/manifest.json'

/** The config a template embeds (same extraction as shader-store reconcile). */
function configFromHtml(html) {
	const m = /window\.__SHADERFX_CONFIG__ = (\{[\s\S]*?\})<\/script>/.exec(html)
	return m ? JSON.parse(m[1].replace(/<\\\//g, '</')) : null
}

/** @param {string} file repo-relative @param {any} cfg */
function entryOf(file, cfg) {
	const id = path.basename(file).replace(/\.(html|json)$/, '')
	const a = cfg ? shaderAttribution(cfg) : null
	const L = a && a.licence ? LICENCES[a.licence] : null
	return {
		file,
		id,
		name: cfg?.name || null,
		title: a?.title || null,
		author: a?.author || null,
		source: a?.url || null,
		licence: a?.licence || null,
		licenceUrl: L?.url || null,
		licenceLine: a?.licenceLine || null,
		nonCommercial: L ? L.nc : null,
		shareAlike: L ? L.sa : null,
		ownWork: L ? !!L.own : null,
		modified: a ? a.modified || !!cfg.parentId : null,
		...(cfg?.parentId ? { parentId: cfg.parentId } : {}),
		notes: a?.notes || [],
	}
}

/** Problems of one manifest entry (empty = shippable). */
function problemsOf(e) {
	const out = []
	if (!e.author || !e.source) out.push('no attribution header (title — by author / source URL / License: line)')
	if (e.licenceLine && FORBIDDEN_RE.test(e.licenceLine)) out.push(`forbidden licence "${e.licenceLine}"`)
	else if (!e.licence || !LICENCES[e.licence]) out.push(`unknown licence "${e.licenceLine || ''}"`)
	else if (isNonCommercialLicence(e.licence)) out.push(`non-commercial licence ${e.licence}: not shippable (WO-1106 B67)`)
	if (WITHDRAWN_NC_SHADERS.has(e.id)) out.push('withdrawn (LICENSES/withdrawn-nc.json): not shippable (WO-1106 B67)')
	return out.map((p) => `${e.file}: ${p}`)
}

/**
 * @param {{ root?: string, previous?: any }} [opts]
 * @returns {{ manifest: any, problems: string[] }}
 */
function buildManifest(opts = {}) {
	const root = opts.root || DEFAULT_ROOT
	const tplDir = path.join(root, 'template', 'shaders')
	const dataDir = path.join(root, 'data', 'shaders')
	const templates = []
	const tplIds = new Set()
	for (const f of fs
		.readdirSync(tplDir)
		.filter((n) => n.endsWith('.html'))
		.sort()) {
		let cfg = null
		try {
			cfg = configFromHtml(fs.readFileSync(path.join(tplDir, f), 'utf8'))
		} catch {
			/* reported as a problem below */
		}
		templates.push(entryOf(`template/shaders/${f}`, cfg))
		tplIds.add(f.slice(0, -5))
	}
	let boxLibrary
	if (fs.existsSync(dataDir)) {
		boxLibrary = []
		for (const f of fs
			.readdirSync(dataDir)
			.filter((n) => n.endsWith('.json'))
			.sort()) {
			if (tplIds.has(f.slice(0, -5))) continue
			let cfg = null
			try {
				cfg = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'))
			} catch {
				/* reported below */
			}
			if (cfg && !isShippableShader(f.slice(0, -5), cfg)) continue // WO-1106 B67: held on this box only
			boxLibrary.push(entryOf(`data/shaders/${f}`, cfg))
		}
	} else {
		boxLibrary = opts.previous?.boxLibrary || [] // fresh clone: data/shaders is box state — keep the committed rows
	}
	const counts = {}
	for (const e of [...templates, ...boxLibrary])
		counts[e.licence || 'UNKNOWN'] = (counts[e.licence || 'UNKNOWN'] || 0) + 1
	const manifest = {
		about:
			"Third-party shaders under their own licences — NOT under HighAsCG's AGPL. See README.md. Generated by " +
			"tools/shaders/shader-licence-manifest.js from each shader's attribution header; do not edit by hand.",
		shadertoyDefault: {
			licence: SHADERTOY_DEFAULT_LICENCE,
			url: SHADERTOY_TERMS_URL,
			quote:
				"All the shaders you create in Shadertoy are owned by you. You decide which license applies to every shader you create. We recommend you paste your preferred license on top of your code, if you don't place a license on a shader, it will be protected by our default license: This work is licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.",
			readFrom: [
				'https://web.archive.org/web/20251001020819/https://www.shadertoy.com/terms',
				'https://web.archive.org/web/20250920061115/https://www.shadertoy.com/terms',
			],
		},
		counts,
		templates,
		boxLibrary,
	}
	const problems = [...templates, ...boxLibrary].flatMap(problemsOf)
	return { manifest, problems }
}

const serialise = (m) => JSON.stringify(m, null, '\t') + '\n'

function main(argv) {
	const manifestPath = path.join(DEFAULT_ROOT, MANIFEST_REL)
	let previous = null
	try {
		previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
	} catch {
		/* first run */
	}
	const { manifest, problems } = buildManifest({ previous })
	for (const p of problems) console.error('PROBLEM', p)
	if (argv.includes('--write')) {
		fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
		fs.writeFileSync(manifestPath, serialise(manifest))
		console.log(`wrote ${MANIFEST_REL}: ${JSON.stringify(manifest.counts)}`)
	} else if (argv.includes('--check')) {
		if (!previous || serialise(previous) !== serialise(manifest)) {
			console.error(`${MANIFEST_REL} is stale — run node tools/shaders/shader-licence-manifest.js --write`)
			return 1
		}
		console.log(`${MANIFEST_REL} up to date: ${JSON.stringify(manifest.counts)}`)
	} else {
		console.log(JSON.stringify(manifest.counts))
	}
	return problems.length ? 1 : 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))

module.exports = { buildManifest, problemsOf, configFromHtml, MANIFEST_REL }

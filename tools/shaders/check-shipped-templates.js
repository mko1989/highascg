#!/usr/bin/env node
'use strict'

/**
 * WO-1106 B67 — which shader templates in a folder must not ship? The same rule the store applies
 * (src/shaderfx/shader-licence.js isShippableShader): retired ids (WO-1096) and NonCommercial ones (a withdrawn id,
 * an -NC licence in the attribution header, a FragCoord nc import). Only the attribution header counts: a dual-licensed
 * helper snippet further down the code ("License: MIT OR CC-BY-NC-4.0") does not make the shader NC.
 *
 *   node tools/shaders/check-shipped-templates.js <dir>    prints one "<file>\t<reason>" per template that must not
 *                                                          ship (searched recursively); exit 1 if any, 0 if none
 *
 * Used by tools/eggs/live-usb/verify-iso-redistribution.sh on the templates extracted from the image.
 */

const fs = require('fs')
const path = require('path')
const { isRetiredShader, nonCommercialLicenceOf } = require('../../src/shaderfx/shader-licence')
const { configFromHtml } = require('./shader-licence-manifest')

/** @param {string} dir @returns {string[]} */
function htmlFilesUnder(dir) {
	const out = []
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name)
		if (ent.isDirectory()) out.push(...htmlFilesUnder(p))
		else if (/^sh-[^/]+\.html$/.test(ent.name)) out.push(p)
	}
	return out
}

/**
 * @param {string} file
 * @returns {string|null} why it must not ship, or null when it may
 */
function unshippableReason(file) {
	const id = path.basename(file, '.html')
	let cfg = null
	try {
		cfg = configFromHtml(fs.readFileSync(file, 'utf8'))
	} catch {
		/* judged by id below */
	}
	const nc = nonCommercialLicenceOf(id, cfg || {})
	if (nc) return `non-commercial licence ${nc}`
	if (isRetiredShader(id, cfg || {})) return 'retired (template/shaders/LICENSES/opt-in.json)'
	return null
}

function main(argv) {
	const dir = argv[0]
	if (!dir || !fs.existsSync(dir)) {
		console.error('usage: check-shipped-templates.js <dir>')
		return 2
	}
	let bad = 0
	for (const f of htmlFilesUnder(dir).sort()) {
		const why = unshippableReason(f)
		if (!why) continue
		console.log(`${path.relative(dir, f)}\t${why}`)
		bad++
	}
	return bad ? 1 : 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))

module.exports = { unshippableReason, htmlFilesUnder }

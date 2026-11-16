'use strict'

/**
 * WO-765 — where each <Fixture> of an MVR GeneralSceneDescription.xml sits in the text, and where its OWN <Matrix> is
 * (a direct child — not one of its Geometries' or its ChildList's), so the calibrated export can replace exactly those
 * bytes and leave every other byte of the desk's file alone (no re-serialisation: unknown elements, attribute order,
 * whitespace and comments survive). A small tag scanner, not a parser: comments, CDATA, processing instructions and
 * the doctype are skipped; attribute values may hold '>' when quoted. Pure.
 */

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g

const attrOf = (attrs, name) => {
	const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs || '')
	return m ? (m[2] ?? m[3] ?? '') : ''
}

/**
 * @param {string} xml
 * @returns {{ fixtures: { uuid: string, name: string, start: number, bodyStart: number, end: number,
 *   matrix: { start: number, end: number, text: string } | null }[], layersClose: number, rootClose: number,
 *   declEnd: number }}
 *   start / end: the Fixture element's span; bodyStart: just after its start tag; matrix: its own Matrix element's
 *   span and inner text; layersClose: index of the first </Layers> (−1 none); declEnd: after the <?xml …?> declaration.
 */
function scanScene(xml) {
	const text = String(xml)
	const stack = [] // { name, fx?: record, matrix?: { start } }
	const fixtures = []
	let layersClose = -1
	let rootClose = -1
	let declEnd = 0
	TOKEN.lastIndex = 0
	for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
		const tok = m[0]
		if (!m[2]) {
			if (tok.startsWith('<?xml') && m.index === text.indexOf('<?xml')) declEnd = m.index + tok.length
			continue
		}
		const [, close, name, attrs, self] = m
		if (close) {
			// pop to the matching open tag (a stray close tag pops nothing)
			let i = stack.length - 1
			while (i >= 0 && stack[i].name !== name) i--
			if (i < 0) continue
			const top = stack[i]
			stack.length = i
			if (top.fx) top.fx.end = m.index + tok.length
			if (top.matrixOf) top.matrixOf.matrix = { start: top.start, end: m.index + tok.length, text: text.slice(top.inner, m.index) }
			if (name === 'Layers' && layersClose < 0) layersClose = m.index
			if (i === 0) rootClose = m.index
			continue
		}
		const parent = stack[stack.length - 1]
		const ownMatrix = name === 'Matrix' && parent?.fx && !parent.fx.matrix
		if (self) {
			if (ownMatrix) parent.fx.matrix = { start: m.index, end: m.index + tok.length, text: '' }
			if (name === 'Fixture') {
				const fx = { uuid: attrOf(attrs, 'uuid'), name: attrOf(attrs, 'name'), start: m.index, bodyStart: -1, end: m.index + tok.length, matrix: null }
				fixtures.push(fx)
			}
			continue
		}
		const entry = { name, start: m.index, inner: m.index + tok.length }
		if (name === 'Fixture') {
			entry.fx = { uuid: attrOf(attrs, 'uuid'), name: attrOf(attrs, 'name'), start: m.index, bodyStart: m.index + tok.length, end: -1, matrix: null }
			fixtures.push(entry.fx)
		}
		if (ownMatrix) entry.matrixOf = parent.fx
		stack.push(entry)
	}
	return { fixtures, layersClose, rootClose, declEnd }
}

/** Apply [{ start, end, text }] replacements (non-overlapping) to `text`. */
function splice(text, edits) {
	let out = ''
	let at = 0
	for (const e of [...edits].sort((a, b) => a.start - b.start)) {
		out += text.slice(at, e.start) + e.text
		at = e.end
	}
	return out + text.slice(at)
}

module.exports = { scanScene, splice }

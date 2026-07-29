#!/usr/bin/env node
'use strict'

/**
 * WO-383 — catch "can't access lexical declaration 'x' before initialization" before the operator
 * does.
 *
 * Flags an identifier READ in straight-line code that runs before the `const`/`let`/`class` that
 * declares it in the SAME scope. A forward reference from inside a nested function is legal (it
 * runs later), so those are ignored — that distinction is what makes this quiet enough to gate on.
 *
 * The bug that motivated it (WO-381, device-view-destinations-ui.js): a `??` chain was hoisted out
 * of a ternary branch, so `intent?.pgmChannel` — declared 24 lines further down — started being
 * evaluated for every destination whose `casparChannel` was unset. The Devices page rendered the
 * TypeError instead of its contents.
 */

const fs = require('fs')
const path = require('path')
const acorn = require('acorn')

const REPO_ROOT = path.resolve(__dirname, '../..')
const ROOTS = ['client']
const SKIP_DIRS = new Set(['node_modules', 'dist-web', 'dist-map', '.vite'])

/** @param {string} dir @param {string[]} out */
function collect(dir, out) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIRS.has(entry.name)) continue
		const p = path.join(dir, entry.name)
		if (entry.isDirectory()) collect(p, out)
		else if (entry.name.endsWith('.js')) out.push(p)
	}
}

/** @param {object} id @param {(name: string) => void} cb */
function eachName(id, cb) {
	if (!id) return
	if (id.type === 'Identifier') cb(id.name)
	else if (id.type === 'ObjectPattern') id.properties.forEach((p) => eachName(p.value || p.argument, cb))
	else if (id.type === 'ArrayPattern') id.elements.forEach((e) => e && eachName(e, cb))
	else if (id.type === 'AssignmentPattern') eachName(id.left, cb)
	else if (id.type === 'RestElement') eachName(id.argument, cb)
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])

/**
 * @param {string} file
 * @returns {{ line: number, name: string }[]}
 */
function scanFile(file) {
	const src = fs.readFileSync(file, 'utf8')
	const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
	/** @type {{ line: number, name: string }[]} */
	const hits = []

	/**
	 * @param {object} node
	 * @param {{ decls: Map<string, number>, fnDepth: number }[]} chain
	 * @param {number} fnDepth — how many function bodies deep this node sits
	 */
	function walk(node, chain, fnDepth, parent) {
		if (!node || typeof node.type !== 'string') return

		if (node.type === 'Identifier' && parent && isRead(node, parent)) {
			for (let i = chain.length - 1; i >= 0; i--) {
				const start = chain[i].decls.get(node.name)
				if (start === undefined) continue
				// Only straight-line reads: the read must sit at the same function depth as the
				// declaration's scope. Deeper means it is inside a callback that runs later.
				if (node.start < start && fnDepth === chain[i].fnDepth) {
					hits.push({ line: node.loc.start.line, name: node.name })
				}
				break
			}
		}

		const opensScope = node.type === 'Program' || node.type === 'BlockStatement' || node.type.startsWith('For')
		const nextDepth = FUNCTION_TYPES.has(node.type) ? fnDepth + 1 : fnDepth
		let nextChain = chain
		if (opensScope) {
			const decls = new Map()
			const body = Array.isArray(node.body) ? node.body : []
			for (const stmt of body) {
				if (stmt?.type === 'VariableDeclaration' && (stmt.kind === 'const' || stmt.kind === 'let')) {
					for (const d of stmt.declarations) eachName(d.id, (n) => decls.set(n, stmt.start))
				} else if (stmt?.type === 'ClassDeclaration' && stmt.id) {
					decls.set(stmt.id.name, stmt.start)
				}
			}
			nextChain = chain.concat([{ decls, fnDepth: nextDepth }])
		}

		for (const key of Object.keys(node)) {
			if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue
			const child = node[key]
			if (Array.isArray(child)) {
				for (const c of child) if (c && typeof c.type === 'string') walk(c, nextChain, nextDepth, node)
			} else if (child && typeof child.type === 'string') {
				walk(child, nextChain, nextDepth, node)
			}
		}
	}

	/** @param {object} node @param {object} parent */
	function isRead(node, parent) {
		if (parent.type === 'VariableDeclarator' && parent.id === node) return false
		if ((parent.type === 'FunctionDeclaration' || parent.type === 'ClassDeclaration') && parent.id === node) return false
		if (parent.type === 'Property' && parent.key === node && !parent.computed) return false
		if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false
		if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier') return false
		if (parent.type === 'ExportSpecifier') return false
		if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return false
		return true
	}

	walk(ast, [], 0, null)
	return hits
}

/** @returns {{ file: string, line: number, name: string }[]} */
function findTdzReads() {
	/** @type {string[]} */
	const files = []
	for (const root of ROOTS) {
		const abs = path.join(REPO_ROOT, root)
		if (fs.existsSync(abs)) collect(abs, files)
	}
	/** @type {{ file: string, line: number, name: string }[]} */
	const findings = []
	for (const file of files) {
		let hits
		try {
			hits = scanFile(file)
		} catch (e) {
			// A parse failure is a real problem, but not this gate's job to adjudicate.
			console.warn(`[check-tdz-reads] skipped ${path.relative(REPO_ROOT, file)}: ${e.message}`)
			continue
		}
		for (const h of hits) findings.push({ file: path.relative(REPO_ROOT, file), ...h })
	}
	return findings
}

module.exports = { findTdzReads, scanFile }

if (require.main === module) {
	const findings = findTdzReads()
	for (const f of findings) {
		console.error(`${f.file}:${f.line} — '${f.name}' is read before its lexical declaration (TDZ at runtime)`)
	}
	if (findings.length) {
		console.error(`\n[check-tdz-reads] ${findings.length} temporal-dead-zone read(s) — these throw when the branch runs.`)
		process.exit(1)
	}
	console.log('[check-tdz-reads] no temporal-dead-zone reads in straight-line client code')
}

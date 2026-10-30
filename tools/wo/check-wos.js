'use strict'

/**
 * WO-846: work-order hygiene gate.
 *  1. every WO header has a title, a canonical status (OPEN | IN PROGRESS | DONE | DEPRECATED) and a valid Area line;
 *  2. a WO in deprecated/ says DEPRECATED, and a DEPRECATED WO lives in deprecated/;
 *  3. INDEX.md / index.json are current;
 *  4. no reference (markdown link, or a `work-orders/<file>` path mention) in a tracked text file points at a
 *     work-order file that does not exist.
 *
 * CLI: node tools/wo/check-wos.js   (exit 1 on any problem; prints one line per problem)
 */

const fs = require('fs')
const path = require('path')
const { REPO_ROOT, WO_DIR, STATUSES, AREAS, listWorkOrders, parseHeader } = require('./wo-lib')
const { build } = require('./build-index')
const { trackedTextFiles } = require('./wo-move')

const WO_REL = 'work/work-orders'

function headerProblems() {
	const out = []
	for (const e of listWorkOrders()) {
		const h = parseHeader(fs.readFileSync(path.join(WO_DIR, e.rel), 'utf8'))
		const where = `${WO_REL}/${e.rel}`
		if (!h.title) out.push(`${where}: no "# " title in the header`)
		if (!STATUSES.includes(h.status)) out.push(`${where}: status line missing or not one of ${STATUSES.join(' | ')}`)
		if (!h.area.length) out.push(`${where}: no **Area:** line`)
		for (const a of h.area) if (!AREAS[a]) out.push(`${where}: unknown area "${a}"`)
		if (e.deprecated && h.status !== 'DEPRECATED') out.push(`${where}: in deprecated/ but status is ${h.status}`)
		if (!e.deprecated && h.status === 'DEPRECATED') out.push(`${where}: DEPRECATED but not in deprecated/`)
	}
	return out
}

const LINK_RE = /\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g
const MENTION_RE = /(?:^|[^\w./-])((?:[\w.-]+\/)*work-orders\/(?:deprecated\/)?\d+[a-z]?_WO_[\w.-]+?\.md)(?![\w.-])/g

/** References into work/work-orders/ that resolve to no file. */
function referenceProblems() {
	const out = []
	for (const f of trackedTextFiles(REPO_ROOT)) {
		const abs = path.join(REPO_ROOT, f)
		if (!fs.existsSync(abs)) continue
		const text = fs.readFileSync(abs, 'utf8')
		if (!text.includes('_WO_')) continue
		const dir = path.posix.dirname(f)
		const seen = new Set()
		for (const m of text.matchAll(LINK_RE)) {
			const t = m[1]
			if (/^[a-z]+:/i.test(t) || t.startsWith('/') || !/_WO_.*\.md$/.test(t)) continue
			const target = path.posix.normalize(path.posix.join(dir, decodeURI(t)))
			if (!target.startsWith(`${WO_REL}/`) || seen.has(target)) continue
			seen.add(target)
			if (!fs.existsSync(path.join(REPO_ROOT, target))) out.push(`${f}: link to missing ${target}`)
		}
		for (const m of text.matchAll(MENTION_RE)) {
			const name = m[1].replace(/^.*work-orders\//, '')
			const target = `${WO_REL}/${name}`
			if (seen.has(target)) continue
			seen.add(target)
			if (!fs.existsSync(path.join(REPO_ROOT, target))) out.push(`${f}: mentions missing ${target}`)
		}
	}
	return out
}

function checkAll() {
	const problems = [...headerProblems()]
	if (build({ check: true }).stale) problems.push(`${WO_REL}/INDEX.md: stale — run node tools/wo/build-index.js`)
	problems.push(...referenceProblems())
	return problems
}

module.exports = { headerProblems, referenceProblems, checkAll }

if (require.main === module) {
	const problems = checkAll()
	for (const p of problems) console.error(p)
	console.log(`[check-wos] ${problems.length ? `FAILED (${problems.length})` : 'OK'}`)
	process.exit(problems.length ? 1 : 0)
}

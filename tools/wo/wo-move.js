'use strict'

/**
 * WO-846: move work-order files (into deprecated/, notes, archive…) and rewrite every reference in the same step.
 *
 * Two kinds of references are rewritten in tracked text files:
 *  - markdown links `](target)` whose relative target resolves to a moved file (any file, any directory), and the
 *    relative links INSIDE a moved file, re-based on its new directory;
 *  - plain path mentions `…<old dir>/<name>` (code comments, docs, smokes) — the directory part right before the
 *    file name is replaced, so `work/work-orders/X.md`, `./work-orders/X.md` and `../work-orders/X.md` all follow.
 * config/ is never touched (live runtime state).
 *
 * CLI: node tools/wo/wo-move.js <plan.json> [--dry-run]   plan = [{ "from": "work/…", "to": "work/…" }]
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { REPO_ROOT } = require('./wo-lib')

const TEXT_EXT = new Set([
	'.md',
	'.js',
	'.cjs',
	'.mjs',
	'.gd',
	'.json',
	'.sh',
	'.py',
	'.txt',
	'.html',
	'.yml',
	'.yaml',
	'',
])
const SKIP_RE = /^(config\/|node_modules\/|dist[^/]*\/|docs\/wiki-site\/assets\/|godot\/client\/\.godot\/)/
const LINK_RE = /(\]\()([^)\s#]+)(#[^)\s]*)?(\))/g

function trackedTextFiles(root) {
	const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
	return out
		.split('\0')
		.filter(Boolean)
		.filter((f) => !SKIP_RE.test(f) && TEXT_EXT.has(path.extname(f)))
		.filter((f) => {
			try {
				return fs.lstatSync(path.join(root, f)).isFile() // not symlinks (licenses/), not deleted files
			} catch {
				return false
			}
		})
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Relative link from `fromDir` (repo-relative dir) to `toFile` (repo-relative), POSIX, `./` kept off. */
function relLink(fromDir, toFile) {
	return path.posix.relative(fromDir || '.', toFile) || path.posix.basename(toFile)
}

/**
 * @param {string} text
 * @param {string} oldFile  repo-relative path of the file this text belongs to (before moves)
 * @param {string} newFile  its path after moves (same when it does not move)
 * @param {Map<string,string>} moves  old repo-relative → new repo-relative
 */
function rewriteText(text, oldFile, newFile, moves) {
	const oldDir = path.posix.dirname(oldFile)
	const newDir = path.posix.dirname(newFile)
	let out = text.replace(LINK_RE, (m, open, target, hash, close) => {
		if (/^[a-z]+:/i.test(target) || target.startsWith('/')) return m
		const abs = path.posix.normalize(path.posix.join(oldDir, decodeURI(target)))
		if (abs.startsWith('..')) return m
		const dest = moves.get(abs) || abs
		if (dest === abs && oldDir === newDir) return m
		let rel = relLink(newDir, dest)
		if (target.startsWith('./') && !rel.startsWith('.')) rel = './' + rel
		return open + rel + (hash || '') + close
	})
	for (const [from, to] of moves) {
		const fromDir = path.posix.dirname(from)
		// `work-orders/X.md` → `work-orders/deprecated/X.md` / `notes/X.md`: the part after the old dir's parent
		const seg = `${path.posix.basename(fromDir)}/${path.posix.basename(from)}`
		const toRel = path.posix.relative(path.posix.dirname(fromDir), to)
		const re = new RegExp(`(^|[^\\w./-])((?:[\\w.-]+/)*)${escapeRe(seg)}(?![\\w.-])`, 'g')
		out = out.replace(re, (m, pre, lead) => pre + lead + toRel)
	}
	return out
}

/**
 * @param {{from: string, to: string}[]} plan
 * @param {{ dryRun?: boolean, root?: string, log?: (s: string) => void }} [opts]
 * @returns {{ moved: number, rewritten: string[] }}
 */
function applyMoves(plan, opts = {}) {
	const root = opts.root || REPO_ROOT
	const log = opts.log || (() => {})
	const moves = new Map(plan.map((p) => [path.posix.normalize(p.from), path.posix.normalize(p.to)]))
	for (const [from] of moves) if (!fs.existsSync(path.join(root, from))) throw new Error(`missing: ${from}`)
	const rewritten = []
	for (const f of trackedTextFiles(root)) {
		const abs = path.join(root, f)
		if (!fs.existsSync(abs)) continue
		const text = fs.readFileSync(abs, 'utf8')
		const next = rewriteText(text, f, moves.get(f) || f, moves)
		if (next !== text) {
			rewritten.push(f)
			if (!opts.dryRun) fs.writeFileSync(abs, next)
		}
	}
	if (!opts.dryRun) {
		for (const [from, to] of moves) {
			fs.mkdirSync(path.join(root, path.posix.dirname(to)), { recursive: true })
			execFileSync('git', ['mv', from, to], { cwd: root })
			log(`git mv ${from} ${to}`)
		}
	}
	return { moved: moves.size, rewritten }
}

module.exports = { applyMoves, rewriteText, trackedTextFiles }

if (require.main === module) {
	const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
	const r = applyMoves(plan, { dryRun: process.argv.includes('--dry-run'), log: console.log })
	console.log(`${r.moved} moves; references rewritten in ${r.rewritten.length} files`)
	for (const f of r.rewritten) console.log(`  ~ ${f}`)
}

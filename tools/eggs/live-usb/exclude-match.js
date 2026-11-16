'use strict'

/**
 * WO-1096 — an offline model of how coa applies custom.exclude.list: `mksquashfs -wildcards -ef` (squashfs-tools 4.7.5
 * `excluded_match`, see WO-870 §coa): every pattern is anchored at the liveroot, split on `/`, and each component is
 * matched with fnmatch(FNM_PATHNAME | FNM_PERIOD) — `*` / `?` / `[…]` never match `/`, and never match a LEADING dot
 * (root/* does not match root/.ssh). A pattern that matches a path's first N components excludes that entry and its
 * whole subtree. Extglob (`!(a|b)`, coa's built-in lines only) is not modelled: such patterns are reported, not matched.
 *
 * Used by tools/smoke/smoke-wo1096-iso-redistribution-excludes.test.js and the CLI below, which applies the generated
 * list to a squashfs listing (`unsquashfs -l` / `-lls` output, or plain liveroot-relative paths):
 *   node tools/eggs/live-usb/exclude-match.js <listing.txt> [--list custom.exclude.list] [--grep <regex>]
 */

const fs = require('fs')

/** @param {string} glob one path component */
function componentRegex(glob) {
	let re = ''
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]
		if (c === '*') re += '[^/]*'
		else if (c === '?') re += '[^/]'
		else if (c === '[') {
			const end = glob.indexOf(']', i + 2)
			if (end < 0) re += '\\['
			else {
				let body = glob.slice(i + 1, end)
				if (body[0] === '!') body = '^' + body.slice(1)
				re += '[' + body.replace(/\\/g, '\\\\') + ']'
				i = end
			}
		} else re += c.replace(/[.+^${}()|\\]/g, '\\$&')
	}
	// FNM_PERIOD: a wildcard may not supply a leading dot.
	const leadWild = /^[*?[]/.test(glob)
	return new RegExp('^' + (leadWild ? '(?!\\.)' : '') + re + '$')
}

/** @param {string[]} lines exclude-list text lines (comments / blanks ignored) */
function compileExcludes(lines) {
	const patterns = []
	const unsupported = []
	for (const raw of lines) {
		const l = raw.trim().replace(/^\/+/, '')
		if (!l || l.startsWith('#')) continue
		if (/[!@+]\(/.test(l)) {
			unsupported.push(l)
			continue
		}
		patterns.push({ line: l, parts: l.replace(/\/+$/, '').split('/').map(componentRegex) })
	}
	return { patterns, unsupported }
}

/**
 * @param {{ patterns: Array<{ line: string, parts: RegExp[] }> }} compiled
 * @param {string} relPath liveroot-relative path
 * @returns {string|null} the first pattern that excludes it (itself or an ancestor)
 */
function excludedBy(compiled, relPath) {
	const comps = relPath.replace(/^\/+|\/+$/g, '').split('/')
	for (const p of compiled.patterns) {
		if (p.parts.length > comps.length) continue
		let ok = true
		for (let i = 0; i < p.parts.length && ok; i++) ok = p.parts[i].test(comps[i])
		if (ok) return p.line
	}
	return null
}

/** `unsquashfs -l` / `-lls` line → liveroot-relative path ('' for the root itself). */
function listingPath(line) {
	let s = line.replace(/\r$/, '')
	const m = /^[-dlcbps][-rwxsStT]{9}\s+\S+\s+\d+(?:,\s*\d+)?\s+\d{4}-\d\d-\d\d \d\d:\d\d (.*)$/.exec(s)
	if (m) s = m[1].replace(/ -> .*$/, '')
	return s.replace(/^squashfs-root\/?/, '')
}

function main(argv) {
	const listing = argv[0]
	if (!listing) {
		process.stderr.write('usage: exclude-match.js <listing.txt> [--list custom.exclude.list] [--grep <regex>]\n')
		return 2
	}
	const opt = (k) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : null)
	const text = opt('--list')
		? fs.readFileSync(opt('--list'), 'utf8')
		: require('./generate-eggs-config').buildExcludeList({ embedServer: true })
	const compiled = compileExcludes(text.split('\n'))
	const grep = opt('--grep') ? new RegExp(opt('--grep')) : null
	let kept = 0
	let dropped = 0
	for (const line of fs.readFileSync(listing, 'utf8').split('\n')) {
		const p = listingPath(line)
		if (!p) continue
		if (excludedBy(compiled, p)) dropped++
		else {
			kept++
			if (grep && grep.test(p)) process.stdout.write(p + '\n')
		}
	}
	process.stderr.write(`kept ${kept}, excluded ${dropped}, extglob patterns not modelled: ${compiled.unsupported.length}\n`)
	return 0
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))

module.exports = { compileExcludes, excludedBy, listingPath }

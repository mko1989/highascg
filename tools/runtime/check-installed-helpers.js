#!/usr/bin/env node
'use strict'

/**
 * WO-728 — do the root-installed copies still match the repo?
 *
 * Root helpers run from copies the setup / install scripts wrote once (`/usr/local/lib/highascg/*`,
 * `/usr/local/bin/highascg-*`). A fix in the repo reaches ~/highascg but not those copies unless something
 * reinstalls them — WO-511 (the updater rejected its own new flag) and WO-727 (sshd ran a July forced command that
 * refused every name with a space) were both that. This compares each installed file with the repo file of the
 * same name, also without the `highascg-` prefix or with `.sh` (capture-boot-xrandr.sh → highascg-capture-boot-xrandr.sh,
 * highascg-replication-ssh.sh → highascg-replication-ssh, the forced command sshd runs).
 *
 *   node tools/runtime/check-installed-helpers.js          # exit 1 when a copy differs
 *   node tools/runtime/check-installed-helpers.js --json
 *
 * Files written from a heredoc or compiled (highascg-display-mode, highascg-fb-corner-throbber) have no repo file: listed as "generated", not compared.
 */

const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const INSTALLED = [
	{ dir: '/usr/local/lib/highascg' },
	{ dir: '/usr/local/bin', only: /^highascg-/ },
]
const SOURCE_DIRS = ['scripts', 'tools']
const SKIP = new Set(['node_modules', 'deprecated', '.git'])

/** basename → [repo-relative paths] for every file under scripts/ and tools/ (deprecated left out). */
function repoFilesByName(repo) {
	const byName = new Map()
	const walk = (rel) => {
		let ents
		try {
			ents = fs.readdirSync(path.join(repo, rel), { withFileTypes: true })
		} catch {
			return
		}
		for (const e of ents) {
			if (SKIP.has(e.name)) continue
			const r = path.posix.join(rel, e.name)
			if (e.isDirectory()) walk(r)
			else if (e.isFile()) byName.set(e.name, [...(byName.get(e.name) || []), r])
		}
	}
	SOURCE_DIRS.forEach(walk)
	return byName
}

const same = (a, b) => {
	try {
		return fs.readFileSync(a).equals(fs.readFileSync(b))
	} catch {
		return false
	}
}

/** → [{ installed, status: 'same'|'differs'|'generated', source?, sources? }] */
function checkInstalledHelpers({ repo = REPO, installed = INSTALLED } = {}) {
	const byName = repoFilesByName(repo)
	const out = []
	for (const { dir, only } of installed) {
		let names
		try {
			names = fs.readdirSync(dir).sort()
		} catch {
			continue
		}
		for (const name of names) {
			if (only && !only.test(name)) continue
			const file = path.join(dir, name)
			if (!fs.statSync(file).isFile()) continue
			const candidates = [name, name.replace(/^highascg-/, ''), `${name}.sh`]
			const sources = [...new Set(candidates.flatMap((n) => byName.get(n) || []))]
			if (!sources.length) out.push({ installed: file, status: 'generated' })
			else {
				const hit = sources.find((s) => same(file, path.join(repo, s)))
				out.push(hit ? { installed: file, status: 'same', source: hit } : { installed: file, status: 'differs', sources })
			}
		}
	}
	return out
}

if (require.main === module) {
	const rows = checkInstalledHelpers()
	const differs = rows.filter((r) => r.status === 'differs')
	if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 1))
	else {
		for (const r of differs) console.log(`DIFFERS    ${r.installed}  (repo: ${r.sources.join(', ')})`)
		for (const r of rows.filter((x) => x.status === 'generated')) console.log(`generated  ${r.installed}`)
		const n = (st) => rows.filter((r) => r.status === st).length
		console.log(`${n('same')} same, ${differs.length} differ, ${n('generated')} generated (no repo file)`)
		if (differs.length) console.log('reinstall: sudo bash scripts/exfat/install-exfat-systemd-units.sh casparcg; sudo bash scripts/replication/install-replication-ssh-wrapper.sh')
	}
	process.exit(differs.length ? 1 : 0)
}

module.exports = { checkInstalledHelpers }

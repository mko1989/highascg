#!/usr/bin/env node
'use strict'

/**
 * WO-1076 — pack one external module for installation: modules/<name>/ → highascg-module-<name>-<version>.tgz plus a
 * sha256sum-format `.sha256` next to it. Install with POST /api/modules/install { path | url, sha256 } (docs/MODULES.md).
 * The base server release never carries modules/ (make-github-release-server.sh refuses a tarball that does).
 *
 * Usage: node tools/release/make-module-tarball.js <name> [--out DIR] [--src DIR]
 *   --out  output directory (default dist/modules/ — dist/ is git- and Syncthing-ignored)
 *   --src  modules root to read from (default <repo>/modules)
 *
 * The archive is what the installer accepts and nothing else: one top-level `<name>/`, regular files + directories,
 * fixed owner / mtime (reproducible). Symlinks are refused (the installer refuses them too) except node_modules/.bin,
 * which is skipped; .git, *.log, .DS_Store and the module's own tarballs are skipped.
 */

const fs = require('fs')
const path = require('path')
const { readManifest } = require('../../src/module-host/module-manifest')
const { writeTarGz, readTarGz } = require('../../src/module-host/module-tar')
const { sha256Hex } = require('../../src/module-host/module-fetch')

const REPO_ROOT = path.join(__dirname, '..', '..')
const SKIP = (rel, name) => name === '.git' || name === '.DS_Store' || name.endsWith('.log') || /^highascg-module-.*\.tgz(\.sha256)?$/.test(name) || rel === 'node_modules/.bin'

function walk(root, rel, out) {
	const abs = path.join(root, rel)
	for (const d of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const r = rel ? `${rel}/${d.name}` : d.name
		if (SKIP(r, d.name)) continue
		if (d.isSymbolicLink()) throw new Error(`symlink in module tree (not packable): ${r}`)
		if (d.isDirectory()) {
			out.push({ rel: r, type: 'dir' })
			walk(root, r, out)
		} else if (d.isFile()) {
			const st = fs.statSync(path.join(root, r))
			out.push({ rel: r, type: 'file', mode: st.mode & 0o111 ? 0o755 : 0o644, data: fs.readFileSync(path.join(root, r)) })
		} else throw new Error(`special file in module tree: ${r}`)
	}
	return out
}

/**
 * @param {string} name
 * @param {{ out?: string, src?: string }} [opts]
 * @returns {{ tgz: string, sha256: string, sha256File: string, version: string, entries: number }}
 */
function makeModuleTarball(name, opts = {}) {
	const srcRoot = path.resolve(opts.src || path.join(REPO_ROOT, 'modules'))
	const dir = path.join(srcRoot, name)
	const r = readManifest(dir)
	if (!r.ok) throw new Error(`${dir}: ${r.error}`)
	if (r.manifest.name !== name) throw new Error(`module.json name "${r.manifest.name}" does not match directory "${name}"`)
	const files = walk(dir, '', [])
	const entries = [{ name, type: 'dir' }, ...files.map((f) => ({ name: `${name}/${f.rel}`, type: f.type, mode: f.mode, data: f.data }))]
	const gz = writeTarGz(entries)
	readTarGz(gz) // round trip through the installer's own reader: what we ship, it accepts
	const outDir = path.resolve(opts.out || path.join(REPO_ROOT, 'dist', 'modules'))
	fs.mkdirSync(outDir, { recursive: true })
	const base = `highascg-module-${name}-${r.manifest.version}.tgz`
	const tgz = path.join(outDir, base)
	fs.writeFileSync(tgz, gz)
	const sha256 = sha256Hex(gz)
	const sha256File = `${tgz}.sha256`
	fs.writeFileSync(sha256File, `${sha256}  ${base}\n`)
	return { tgz, sha256, sha256File, version: r.manifest.version, entries: entries.length }
}

function main(argv) {
	const args = argv.slice(2)
	const opt = (k) => {
		const i = args.indexOf(k)
		if (i < 0) return undefined
		const v = args[i + 1]
		args.splice(i, 2)
		return v
	}
	const out = opt('--out')
	const src = opt('--src')
	if (args.length !== 1 || args[0].startsWith('-')) {
		console.error('usage: node tools/release/make-module-tarball.js <name> [--out DIR] [--src DIR]')
		return 2
	}
	try {
		const r = makeModuleTarball(args[0], { out, src })
		console.log(`${r.tgz}\n  ${r.entries} entries, version ${r.version}\n  sha256 ${r.sha256} (${path.basename(r.sha256File)})`)
		return 0
	} catch (e) {
		console.error(`make-module-tarball: ${e.message}`)
		return 1
	}
}

if (require.main === module) process.exitCode = main(process.argv)

module.exports = { makeModuleTarball }

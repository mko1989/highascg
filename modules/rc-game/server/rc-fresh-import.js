'use strict'

/**
 * WO-1106 B51 — import() the client's ES modules (rc-room-bots.js: the bot brain + physics) under a version, so an edited
 * or upgraded entry file is loaded fresh. Node caches an ES module by its URL for good, so the URL carries
 * `?rcv=<hash of the folder's .js names, sizes and mtimes>`. Only the entry files get the version: their own relative
 * imports (`./physics.js` …) stay cached until node restarts, so restart node after upgrading the RC module. (A
 * process-wide resolve hook would refresh them too, but it would wrap every resolve of the live playout server.)
 * Old versions stay in memory (an ES module cannot be unloaded): one graph per change, not per load.
 *
 *   freshImport(dir, files) → Promise<module namespaces in the order of `files`>
 *   folderVersion(dir) → the version string
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const QUERY = '?rcv='

function folderVersion(dir) {
	const h = crypto.createHash('sha1')
	let names = []
	try {
		names = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
	} catch {
		/* no folder: the import fails on its own */
	}
	for (const f of names) {
		try {
			const s = fs.statSync(path.join(dir, f))
			h.update(`${f}:${s.size}:${Math.round(s.mtimeMs)};`)
		} catch {
			h.update(`${f}:gone;`)
		}
	}
	return h.digest('hex').slice(0, 12)
}

function freshImport(dir, files) {
	const v = folderVersion(dir)
	return Promise.all(files.map((f) => import(`${pathToFileURL(path.join(dir, f)).href}${QUERY}${v}`)))
}

module.exports = { freshImport, folderVersion }

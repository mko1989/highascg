'use strict'

/**
 * WO-1106 B51 — import() the client's ES modules (rc-room-bots.js: the bot brain + physics) so that a module upgrade or an
 * edit reaches the server bots without a node restart. Node caches an ES module by its URL for good, so the URL carries
 * a version: `?rcv=<hash of the folder's .js names, sizes and mtimes>`. A query on the entry file alone would leave its
 * own imports (`./physics.js` …) on the old cached copies, so a resolve hook (module.registerHooks, Node ≥ 22.15)
 * hands the parent's `?rcv=` on to every relative import in the same folder. Without registerHooks only the entry
 * files are fresh. Old versions stay in memory (an ES module cannot be unloaded): one graph per change, not per load.
 *
 *   freshImport(dir, files) → Promise<module namespaces in the order of `files`>
 *   folderVersion(dir) → the version string
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const HOOKS = Symbol.for('highascg.rc-game.fresh-import-hooks/1')
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

/** A relative import from a `?rcv=` file inherits that query when it lands in the same folder without one. */
function passVersion(parentURL, url) {
	if (typeof parentURL !== 'string' || typeof url !== 'string' || !url.startsWith('file:') || url.includes('?')) return url
	const q = parentURL.indexOf(QUERY)
	if (q < 0 || !parentURL.startsWith('file:')) return url
	const dirOf = (u) => u.slice(0, u.lastIndexOf('/', u.indexOf('?') < 0 ? u.length : u.indexOf('?')) + 1)
	return dirOf(parentURL) === dirOf(url) ? url + parentURL.slice(q) : url
}

function installHooks() {
	if (globalThis[HOOKS]) return
	globalThis[HOOKS] = true // once per process (this file is required again after a module re-enable)
	const { registerHooks } = require('module')
	if (typeof registerHooks !== 'function') return
	registerHooks({
		resolve(specifier, context, next) {
			const r = next(specifier, context)
			const url = passVersion(context?.parentURL, r?.url)
			return url === r?.url ? r : { ...r, url }
		},
	})
}

function freshImport(dir, files) {
	installHooks()
	const v = folderVersion(dir)
	return Promise.all(files.map((f) => import(`${pathToFileURL(path.join(dir, f)).href}${QUERY}${v}`)))
}

module.exports = { freshImport, folderVersion, passVersion }

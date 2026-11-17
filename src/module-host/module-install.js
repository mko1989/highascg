'use strict'

/**
 * WO-1076 — install / uninstall an external module package into ~/.highascg/modules/<name>/ (module-paths.js).
 *
 * Package = `highascg-module-<name>-<version>.tgz` (tools/release/make-module-tarball.js): ONE top-level directory
 * `<name>/` holding module.json + the module's files. Installing executes nothing until the module is enabled, but an
 * enabled module is in-process code with the server's rights — so the archive is checked before a byte is written:
 *   - source: an absolute local .tgz path or an https URL; packed size ≤ 64 MB (module-fetch.js)
 *   - sha256: a URL install needs the caller's `sha256` (WO-1106 B1: a sidecar from the same origin vouches for
 *     nothing). A local file is checked against the body `sha256`, else against a `<package>.sha256` sidecar next to
 *     it; a mismatch refuses. The reply says `sha256Source` ('caller' | 'sidecar' | 'none'); only 'caller' is
 *     `sha256Verified` (WO-1106 B8).
 *   - entries: regular files and directories only (no symlinks / hard links / devices), no absolute / `..` names,
 *     ≤ 256 MB unpacked, ≤ 5000 entries (module-tar.js)
 *   - layout: everything under `<name>/`, module.json valid, its name = that directory (= body `name` when given),
 *     not an in-tree module name, compatible with this core, and no repo `modules/<name>` (a dev checkout is never
 *     overwritten or shadowed)
 *   - unpacked into a fresh `.staging-*` dir next to the target with exclusive creates, then swapped in by rename;
 *     an upgrade unloads the running copy first; the previous copy is kept as `.old-*` until the new one is enabled
 *     and put back (and restarted) when the new one does not start or the swap fails (WO-1106 B7).
 * Uninstall: unload (onShutdown + unregister) first, then remove — only ever under ~/.highascg/modules.
 */

const fs = require('fs')
const path = require('path')
const { installedModulesDir, repoModulesDir } = require('./module-paths')
const { validateManifest, satisfiesCore, coreVersion, isValidModuleName } = require('./module-manifest')
const { readTarGz } = require('./module-tar')
const { fetchHttps, readLocalPackage, parseSha256, sha256Hex, MAX_PACKED_BYTES } = require('./module-fetch')
const loader = require('./module-loader')
const moduleRegistry = require('../module-registry')
const { forgetModule, setModuleEnabled } = require('./module-state')

const fail = (status, code, error) => ({ ok: false, status, code, error })

async function readPackage(opts, deps, maxPacked) {
	const fetch = deps.fetch || fetchHttps
	if (opts.url) return { buf: await fetch(String(opts.url), { maxBytes: maxPacked }), sidecar: null } // sha256 is the caller's (B1)
	const buf = readLocalPackage(opts.path, maxPacked)
	let side = null
	if (!opts.sha256) {
		try {
			side = parseSha256(fs.readFileSync(`${opts.path}.sha256`, 'utf8').slice(0, 4096))
		} catch {}
	}
	return { buf, sidecar: side }
}

/** Check the entries' layout + manifest. @returns {{ manifest: object } | { error: object }} */
function checkLayout(entries, wantName) {
	const tops = new Set(entries.map((e) => e.name.split('/')[0]))
	if (tops.size !== 1) return { error: fail(400, 'LAYOUT', 'the package must hold exactly one top-level directory <name>/') }
	const top = [...tops][0]
	if (entries.some((e) => e.name === top && e.type !== 'dir')) return { error: fail(400, 'LAYOUT', 'the top-level entry must be a directory') }
	const mf = entries.find((e) => e.name === `${top}/module.json` && e.type === 'file')
	if (!mf) return { error: fail(400, 'LAYOUT', `${top}/module.json missing`) }
	let raw
	try {
		raw = JSON.parse(mf.data.toString('utf8'))
	} catch {
		return { error: fail(400, 'MANIFEST', 'module.json is not JSON') }
	}
	const v = validateManifest(raw)
	if (!v.ok) return { error: fail(400, 'MANIFEST', v.error) }
	if (v.manifest.name !== top) return { error: fail(400, 'NAME', `module.json name "${v.manifest.name}" does not match the package directory "${top}"`) }
	if (wantName && wantName !== top) return { error: fail(400, 'NAME', `package holds "${top}", not "${wantName}"`) }
	return { manifest: v.manifest }
}

function unpack(entries, staging, top) {
	const base = path.resolve(staging) + path.sep
	for (const e of entries) {
		if (e.name === top) continue
		const rel = e.name.slice(top.length + 1)
		const dest = path.resolve(staging, rel)
		if (!dest.startsWith(base)) throw new Error(`refusing to write outside the module dir: ${e.name}`)
		if (e.type === 'dir') fs.mkdirSync(dest, { recursive: true, mode: 0o755 })
		else {
			fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o755 })
			fs.writeFileSync(dest, e.data, { flag: 'wx', mode: e.mode & 0o111 ? 0o755 : 0o644 }) // wx: a duplicate entry fails
		}
	}
}

/**
 * @param {{ path?: string, url?: string, sha256?: string, name?: string, enable?: boolean }} opts
 * @param {any} ctx
 * @param {{ fetch?: Function, limits?: { maxPackedBytes?: number, maxUnpackedBytes?: number, maxEntries?: number } }} [deps]
 *   code-only overrides (the smokes); never taken from an HTTP body
 */
function installModule(opts, ctx, deps = {}) {
	return loader.serial(() => installNow(opts || {}, ctx, deps))
}

async function installNow(opts, ctx, deps) {
	if (!!opts.path === !!opts.url) return fail(400, 'BAD_REQUEST', 'give exactly one of `path` (local .tgz) or `url` (https)')
	if (opts.name !== undefined && !isValidModuleName(opts.name)) return fail(400, 'NAME', 'invalid module name')
	const wantSha = opts.sha256 ? parseSha256(opts.sha256) : null
	if (opts.sha256 && !wantSha) return fail(400, 'SHA256', 'sha256 must be 64 hex characters')
	// WO-1106 B1: whoever controls the URL controls a sidecar next to it — a download needs the hash from the caller
	if (opts.url && !wantSha) return fail(400, 'SHA256_REQUIRED', 'a download needs its sha256: copy it from the release page into `sha256`')
	const lim = deps.limits || {}
	let pkg
	try {
		pkg = await readPackage(opts, deps, lim.maxPackedBytes ?? MAX_PACKED_BYTES)
	} catch (e) {
		return fail(e.status || 400, e.code || 'SOURCE', e.message)
	}
	const actual = sha256Hex(pkg.buf)
	const expected = wantSha || pkg.sidecar
	if (expected && expected !== actual) return fail(400, 'SHA256', `sha256 mismatch: package is ${actual}, expected ${expected}`)
	let entries
	try {
		entries = readTarGz(pkg.buf, { maxUnpackedBytes: lim.maxUnpackedBytes, maxEntries: lim.maxEntries })
	} catch (e) {
		return fail(e.code === 'TAR_TOO_LARGE' || e.code === 'TAR_TOO_MANY' ? 413 : 400, e.code || 'TAR', e.message)
	}
	const lay = checkLayout(entries, opts.name)
	if (lay.error) return lay.error
	const m = lay.manifest
	if (loader.isInTreeName(m.name)) return fail(409, 'NAME', `"${m.name}" is an in-tree module name`)
	if (fs.existsSync(path.join(repoModulesDir(), m.name))) return fail(409, 'REPO_MODULE', `modules/${m.name} exists in the repo checkout; it is never overwritten`)
	if (!satisfiesCore(m.requiresCore, coreVersion())) return fail(409, 'CORE', `needs core ${m.requiresCore}, this core is ${coreVersion()}`)

	const root = installedModulesDir()
	fs.mkdirSync(root, { recursive: true, mode: 0o755 })
	const staging = fs.mkdtempSync(path.join(root, '.staging-'))
	try {
		unpack(entries, staging, m.name)
	} catch (e) {
		fs.rmSync(staging, { recursive: true, force: true })
		return fail(400, 'UNPACK', e.message)
	}
	const target = path.join(root, m.name)
	const replaced = fs.existsSync(target)
	if (replaced && !fs.lstatSync(target).isDirectory()) {
		fs.rmSync(staging, { recursive: true, force: true })
		return fail(409, 'TARGET', `${target} exists and is not a directory`)
	}
	const wasLoaded = await loader.unloadModule(m.name, ctx) // an upgrade: the running copy stops before its files move
	const old = replaced ? `${path.join(root, '.old-')}${m.name}-${process.pid}-${Date.now()}` : null
	try {
		if (old) fs.renameSync(target, old)
		fs.renameSync(staging, target)
	} catch (e) {
		if (old && !fs.existsSync(target)) fs.renameSync(old, target)
		fs.rmSync(staging, { recursive: true, force: true })
		if (wasLoaded) loader.enableModuleNow(m.name, ctx) // WO-1106 B7: the copy that was running runs again
		return fail(500, 'SWAP', e.message)
	}
	const sha256Source = wantSha ? 'caller' : pkg.sidecar ? 'sidecar' : 'none' // WO-1106 B8: only the caller's hash verifies
	ctx?.log?.('info', `[modules] installed "${m.name}" ${m.version} (sha256 ${actual}, ${wantSha ? 'verified' : sha256Source === 'sidecar' ? 'matches its sidecar' : 'unverified'})`)
	const out = { ok: true, status: 200, name: m.name, version: m.version, sha256: actual, sha256Verified: !!wantSha, sha256Source, replaced, enabled: false }
	if (opts.enable !== false) {
		const en = loader.enableModuleNow(m.name, ctx)
		out.enabled = en.ok
		if (!en.ok && old) return rollBack(m, target, old, wasLoaded, en.error, ctx)
		if (!en.ok) out.enableError = en.error
	} else setModuleEnabled(m.name, false) // the copy it replaced may have been enabled: stays off, also after a restart
	if (old) fs.rmSync(old, { recursive: true, force: true }) // WO-1106 B7: the previous copy goes only once the new one runs
	return out
}

/**
 * WO-1106 B7: the new version did not start — put the previous copy back (and running, when it was) instead of leaving
 * the module down with nothing to go back to.
 */
function rollBack(m, target, old, wasLoaded, enableError, ctx) {
	const failed = path.join(path.dirname(old), path.basename(old).replace(/^\.old-/, '.failed-'))
	try {
		fs.renameSync(target, failed)
		fs.renameSync(old, target)
	} catch (e) {
		ctx?.log?.('error', `[modules] "${m.name}" ${m.version} did not start and the previous copy could not be put back: ${e.message}`)
		return { ...fail(500, 'ENABLE', `${m.name} ${m.version} did not start (${enableError}) and the previous copy could not be put back: ${e.message}`), rolledBack: false }
	}
	fs.rmSync(failed, { recursive: true, force: true })
	const back = wasLoaded ? loader.enableModuleNow(m.name, ctx) : { ok: false }
	ctx?.log?.('warn', `[modules] "${m.name}" ${m.version} did not start (${enableError}); the previous copy is back${back.ok ? ' and running' : ''}`)
	const error = `${m.name} ${m.version} did not start (${enableError}). The previous version is back${back.ok ? ' and running' : ''}.`
	return { ...fail(409, 'ENABLE', error), rolledBack: true, enableError, previousRunning: !!back.ok }
}

/** @param {string} name @param {any} ctx */
function uninstallModule(name, ctx) {
	return loader.serial(async () => {
		if (!isValidModuleName(name)) return fail(400, 'NAME', 'invalid module name')
		const target = path.join(installedModulesDir(), name)
		let st
		try {
			st = fs.lstatSync(target)
		} catch {
			const repo = fs.existsSync(path.join(repoModulesDir(), name))
			return repo ? fail(409, 'REPO_MODULE', `"${name}" lives in the repo checkout (modules/${name}); uninstall only removes installed copies`) : fail(404, 'NOT_INSTALLED', 'not_installed')
		}
		if (!st.isDirectory()) return fail(409, 'TARGET', `${target} is not a directory`)
		const info = moduleRegistry.externalInfo(name)
		if (info && info.dir === fs.realpathSync(target)) await loader.unloadModule(name, ctx) // not the repo copy shadowing it
		fs.rmSync(target, { recursive: true, force: true })
		if (!fs.existsSync(path.join(repoModulesDir(), name))) forgetModule(name)
		ctx?.log?.('info', `[modules] uninstalled "${name}"`)
		return { ok: true, status: 200, name }
	})
}

module.exports = { installModule, uninstallModule }

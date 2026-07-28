/**
 * exFAT sync filesystem helpers: walk, copy, per-file mtime sync.
 */
'use strict'

const fs = require('fs')
const path = require('path')

function walkRelativeFiles(dir, excludePred) {
	/** @type {string[]} */
	const files = []
	function walk(abs, rel) {
		let st
		try {
			st = fs.statSync(abs)
		} catch {
			return
		}
		if (st.isFile()) {
			if (!excludePred(rel)) files.push(rel)
			return
		}
		if (!st.isDirectory()) return
		let names
		try {
			names = fs.readdirSync(abs)
		} catch {
			return
		}
		for (const name of names) {
			const relNext = rel ? `${rel}/${name}` : name
			if (excludePred(relNext)) continue
			walk(path.join(abs, name), relNext)
		}
	}
	walk(path.resolve(dir), '')
	return files.sort()
}

function copyFilePreserveTimes(src, dst) {
	fs.mkdirSync(path.dirname(dst), { recursive: true })
	fs.copyFileSync(src, dst)
	const st = fs.statSync(src)
	fs.utimesSync(dst, st.atime, st.mtime)
}

function syncOneFilePair(pathExfat, pathProject, direction, dryRun, pairId, rel, syncOpts) {
	let copied = 0
	let skipped = 0
	const bootPreferExfat = !!(syncOpts && syncOpts.bootPreferExfat)
	const blockExfatToProject = !!(syncOpts && syncOpts.blockExfatToProject)
	/** @type {fs.Stats | null} */
	let stA = null
	/** @type {fs.Stats | null} */
	let stB = null
	try {
		stA = fs.statSync(pathExfat)
	} catch {}
	try {
		stB = fs.statSync(pathProject)
	} catch {}
	const hasA = stA?.isFile() === true
	const hasB = stB?.isFile() === true
	if (!hasA && !hasB) return { copied: 0, skipped: 1 }
	try {
		if (bootPreferExfat && hasA) {
			if (blockExfatToProject) return { copied: 0, skipped: 1 }
			if (dryRun) return { copied: 1, skipped: 0 }
			copyFilePreserveTimes(pathExfat, pathProject)
			return { copied: 1, skipped: 0 }
		}
		if (hasA && !hasB) {
			if (direction === 'to_exfat' || blockExfatToProject) return { copied: 0, skipped: 1 }
			if (dryRun) return { copied: 1, skipped: 0 }
			copyFilePreserveTimes(pathExfat, pathProject)
			return { copied: 1, skipped: 0 }
		}
		if (!hasA && hasB) {
			if (direction === 'to_project') return { copied: 0, skipped: 1 }
			if (dryRun) return { copied: 1, skipped: 0 }
			copyFilePreserveTimes(pathProject, pathExfat)
			return { copied: 1, skipped: 0 }
		}
		if (hasA && hasB) {
			const mtA = /** @type {fs.Stats} */ (stA).mtimeMs
			const mtB = /** @type {fs.Stats} */ (stB).mtimeMs
			if (mtA > mtB) {
				if (direction === 'to_project' || blockExfatToProject) return { copied: 0, skipped: 1 }
				if (dryRun) return { copied: 1, skipped: 0 }
				copyFilePreserveTimes(pathExfat, pathProject)
				return { copied: 1, skipped: 0 }
			}
			if (mtB > mtA) {
				if (direction === 'to_exfat') return { copied: 0, skipped: 1 }
				if (dryRun) return { copied: 1, skipped: 0 }
				copyFilePreserveTimes(pathProject, pathExfat)
				return { copied: 1, skipped: 0 }
			}
			if (/** @type {fs.Stats} */ (stA).size !== /** @type {fs.Stats} */ (stB).size) {
				if (/** @type {fs.Stats} */ (stA).size > /** @type {fs.Stats} */ (stB).size) {
					if (direction === 'to_project' || blockExfatToProject) return { copied: 0, skipped: 1 }
					if (dryRun) return { copied: 1, skipped: 0 }
					copyFilePreserveTimes(pathExfat, pathProject)
					return { copied: 1, skipped: 0 }
				}
				if (/** @type {fs.Stats} */ (stB).size > /** @type {fs.Stats} */ (stA).size) {
					if (direction === 'to_exfat') return { copied: 0, skipped: 1 }
					if (dryRun) return { copied: 1, skipped: 0 }
					copyFilePreserveTimes(pathProject, pathExfat)
					return { copied: 1, skipped: 0 }
				}
			}
			return { copied: 0, skipped: 1 }
		}
	} catch (e) {
		const m = e instanceof Error ? e.message : String(e)
		return { copied: 0, skipped: 0, error: `${pairId} ${rel}: ${m}` }
	}
	return { copied: 0, skipped: 0 }
}

function syncPairBootPreferExfat(exfatAbs, projectAbs, dryRun, pairId, exPred, syncOneFilePairFn, syncOpts = {}) {
	let copied = 0
	let skipped = 0
	/** @type {string[]} */
	const errors = []
	let exSt
	try {
		exSt = fs.statSync(exfatAbs)
	} catch {
		return { copied: 0, skipped: 1, errors }
	}
	const pairOpts = { bootPreferExfat: true, ...syncOpts }
	if (exSt.isFile()) {
		const r = syncOneFilePairFn(exfatAbs, projectAbs, 'both', dryRun, pairId, path.basename(exfatAbs), pairOpts)
		return { copied: r.copied, skipped: r.skipped, errors: r.error ? [r.error] : [] }
	}
	if (!exSt.isDirectory()) return { copied: 0, skipped: 1, errors }
	for (const rel of walkRelativeFiles(exfatAbs, exPred)) {
		const a = path.join(exfatAbs, rel)
		const b = path.join(projectAbs, rel)
		let stA
		try {
			stA = fs.statSync(a)
		} catch {
			continue
		}
		if (stA.isDirectory()) continue
		const r = syncOneFilePairFn(a, b, 'both', dryRun, pairId, rel, pairOpts)
		copied += r.copied
		skipped += r.skipped
		if (r.error) errors.push(r.error)
	}
	return { copied, skipped, errors }
}

module.exports = {
	walkRelativeFiles,
	copyFilePreserveTimes,
	syncOneFilePair,
	syncPairBootPreferExfat,
}

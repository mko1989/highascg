'use strict'

const fs = require('fs')
const path = require('path')
const unzipper = require('unzipper')

/**
 * Extract a zip archive into targetDir, rejecting Zip-Slip paths (WO-97).
 * @param {string} zipPath
 * @param {string} targetDir
 */
async function extractZipSafely(zipPath, targetDir) {
	const root = path.resolve(targetDir)
	fs.mkdirSync(root, { recursive: true })
	const directory = await unzipper.Open.file(zipPath)
	let count = 0
	for (const entry of directory.files) {
		const name = String(entry.path || '')
		if (!name || name.endsWith('/')) continue
		if (name.includes('..') || path.isAbsolute(name)) {
			throw new Error(`zip slip blocked: ${name}`)
		}
		const dest = path.resolve(root, name)
		const rel = path.relative(root, dest)
		if (rel.startsWith('..') || path.isAbsolute(rel)) {
			throw new Error(`zip slip blocked: ${name}`)
		}
		fs.mkdirSync(path.dirname(dest), { recursive: true })
		await new Promise((resolve, reject) => {
			entry
				.stream()
				.pipe(fs.createWriteStream(dest))
				.on('finish', resolve)
				.on('error', reject)
		})
		count++
		if (count > 10_000) throw new Error('zip entry limit exceeded')
	}
	return count
}

module.exports = { extractZipSafely }

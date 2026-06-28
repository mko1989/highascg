'use strict'

const fs = require('fs')
const path = require('path')
const jpeg = require('jpeg-js')
const { locationKey } = require('./companion-config')

const REPO_ROOT = path.join(__dirname, '../..')
const CACHE_DIR = path.join(REPO_ROOT, 'data/companion-button-preview')

/** @type {Map<string, { text?: string, mtimeMs: number, width: number, height: number }>} */
const _meta = new Map()

function ensureCacheDir() {
	fs.mkdirSync(CACHE_DIR, { recursive: true })
}

function cachePath(page, row, column) {
	return path.join(CACHE_DIR, `${page}_${row}_${column}.jpg`)
}

function rgbBufferToJpeg(rgbBuffer, width, height, quality = 85) {
	const rgba = Buffer.alloc(width * height * 4)
	for (let i = 0, j = 0; i < rgbBuffer.length && j < rgba.length; i += 3, j += 4) {
		rgba[j] = rgbBuffer[i]
		rgba[j + 1] = rgbBuffer[i + 1]
		rgba[j + 2] = rgbBuffer[i + 2]
		rgba[j + 3] = 255
	}
	return jpeg.encode({ data: rgba, width, height }, quality).data
}

/**
 * @param {number} page
 * @param {number} row
 * @param {number} column
 * @param {Buffer} rgbBuffer — 8-bit RGB, width*height*3
 * @param {number} width
 * @param {number} height
 * @param {{ text?: string }} [meta]
 */
function writePreviewJpeg(page, row, column, rgbBuffer, width, height, meta) {
	ensureCacheDir()
	const out = cachePath(page, row, column)
	const jpegBuf = rgbBufferToJpeg(rgbBuffer, width, height)
	const tmp = `${out}.tmp.${process.pid}`
	fs.writeFileSync(tmp, jpegBuf)
	fs.renameSync(tmp, out)
	const st = fs.statSync(out)
	const key = locationKey(page, row, column)
	const entry = {
		text: meta?.text,
		mtimeMs: st.mtimeMs,
		width,
		height,
	}
	_meta.set(key, entry)
	return { path: out, mtimeMs: st.mtimeMs, ...entry }
}

function readPreviewJpeg(page, row, column) {
	const fp = cachePath(page, row, column)
	if (!fs.existsSync(fp)) return null
	const st = fs.statSync(fp)
	const key = locationKey(page, row, column)
	const prev = _meta.get(key)
	if (!prev || prev.mtimeMs !== st.mtimeMs) {
		_meta.set(key, { ...(prev || {}), mtimeMs: st.mtimeMs, width: prev?.width ?? 0, height: prev?.height ?? 0 })
	}
	return { path: fp, mtimeMs: st.mtimeMs, buffer: fs.readFileSync(fp) }
}

function getPreviewMeta(page, row, column) {
	const key = locationKey(page, row, column)
	const m = _meta.get(key)
	const fp = cachePath(page, row, column)
	if (!fs.existsSync(fp)) return null
	const st = fs.statSync(fp)
	return { ...(m || {}), mtimeMs: st.mtimeMs, url: previewUrl(page, row, column) }
}

function previewUrl(page, row, column) {
	return `/api/companion/button-preview/${page}/${row}/${column}.jpg`
}

function decodeSubStateText(textB64) {
	if (!textB64) return undefined
	try {
		return Buffer.from(String(textB64), 'base64').toString('utf8')
	} catch {
		return undefined
	}
}

module.exports = {
	CACHE_DIR,
	cachePath,
	writePreviewJpeg,
	readPreviewJpeg,
	getPreviewMeta,
	previewUrl,
	decodeSubStateText,
	rgbBufferToJpeg,
}

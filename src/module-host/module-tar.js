'use strict'

/**
 * WO-1076 — a deliberately small tar.gz reader / writer for module packages. Not a general tar: the installer only
 * needs regular files and directories, so EVERYTHING else is refused (symlinks, hard links, devices, FIFOs) — a link
 * can never point out of the module dir because none is ever written. Names are checked before anything touches the
 * disk: no absolute paths, no `..` / `.` segments, no backslash / NUL / control characters, bounded length.
 * Caps: compressed bytes (caller), decompressed bytes (zlib maxOutputLength), entry count.
 * Reads ustar + GNU long names (`L`) + pax `path` records (`x`; global `g` ignored). Writes ustar (+ `L` for long
 * names) with fixed owner / mtime so a module tarball is reproducible.
 */

const zlib = require('zlib')

const DEFAULT_LIMITS = { maxUnpackedBytes: 256 * 1024 * 1024, maxEntries: 5000 }

class TarError extends Error {
	constructor(code, message) {
		super(message)
		this.code = code
	}
}

const cstr = (buf, start, len) => {
	const end = buf.indexOf(0, start)
	return buf.toString('utf8', start, end >= 0 && end < start + len ? end : start + len)
}

function octal(buf, start, len) {
	if (buf[start] & 0x80) throw new TarError('TAR_BAD', 'base-256 sizes are not supported')
	const s = cstr(buf, start, len).trim()
	if (s && !/^[0-7]+$/.test(s)) throw new TarError('TAR_BAD', 'corrupt tar header')
	return s ? parseInt(s, 8) : 0
}

function checksumOk(h) {
	let sum = 0
	for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i]
	return sum === octal(h, 148, 8)
}

/** Safe relative entry name or a TarError. Trailing `/` (directories) and a leading `./` are dropped. */
function safeName(raw) {
	let n = String(raw)
	while (n.startsWith('./')) n = n.slice(2)
	n = n.replace(/\/+$/, '')
	// eslint-disable-next-line no-control-regex
	if (!n || n.length > 1024 || /[\u0000-\u001f\u007f\\]/.test(n) || n.startsWith('/')) throw new TarError('TAR_PATH', `unsafe path in archive: ${JSON.stringify(raw)}`)
	const segs = n.split('/')
	if (segs.some((s) => !s || s === '.' || s === '..' || s.length > 255)) throw new TarError('TAR_PATH', `unsafe path in archive: ${JSON.stringify(raw)}`)
	return n
}

function paxPath(data) {
	let out = null
	let i = 0
	const s = data.toString('utf8')
	while (i < s.length) {
		const sp = s.indexOf(' ', i)
		if (sp < 0) break
		const len = parseInt(s.slice(i, sp), 10)
		if (!(len > 0)) break
		const rec = s.slice(sp + 1, i + len - 1)
		const eq = rec.indexOf('=')
		const key = rec.slice(0, eq)
		if (key === 'path') out = rec.slice(eq + 1)
		if (key === 'linkpath' || key === 'size') throw new TarError('TAR_TYPE', `pax ${key} records are not supported`)
		i += len
	}
	return out
}

/**
 * @param {Buffer} gz a .tgz
 * @param {{ maxUnpackedBytes?: number, maxEntries?: number }} [limits]
 * @returns {Array<{ name: string, type: 'file'|'dir', mode: number, data: Buffer }>}
 */
function readTarGz(gz, limits = {}) {
	const lim = { ...DEFAULT_LIMITS, ...limits }
	let tar
	try {
		tar = zlib.gunzipSync(gz, { maxOutputLength: lim.maxUnpackedBytes })
	} catch (e) {
		if (e && (e.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|buffer.*large/i.test(e.message))) {
			throw new TarError('TAR_TOO_LARGE', `archive unpacks to more than ${lim.maxUnpackedBytes} bytes`)
		}
		throw new TarError('TAR_BAD', `not a gzip archive: ${e?.message || e}`)
	}
	const out = []
	let off = 0
	let longName = null
	while (off + 512 <= tar.length) {
		const h = tar.subarray(off, off + 512)
		if (h.every((b) => b === 0)) break
		if (!checksumOk(h)) throw new TarError('TAR_BAD', 'corrupt tar header (checksum)')
		const size = octal(h, 124, 12)
		const type = String.fromCharCode(h[156] || 48)
		const dataStart = off + 512
		if (dataStart + size > tar.length) throw new TarError('TAR_BAD', 'truncated archive')
		const data = tar.subarray(dataStart, dataStart + size)
		off = dataStart + Math.ceil(size / 512) * 512
		if (type === 'L') {
			longName = cstr(data, 0, data.length)
			continue
		}
		if (type === 'x') {
			longName = paxPath(data) ?? longName
			continue
		}
		if (type === 'g') continue
		let name = longName
		longName = null
		if (name == null) {
			name = cstr(h, 0, 100)
			const prefix = h.toString('latin1', 257, 263) === 'ustar\0' ? cstr(h, 345, 155) : '' // POSIX only; GNU keeps atime there
			if (prefix) name = `${prefix}/${name}`
		}
		if (type === '1' || type === '2' || type === 'K') throw new TarError('TAR_LINK', `links are not allowed in a module package: ${JSON.stringify(name)}`)
		if (type !== '0' && type !== '7' && type !== '5') throw new TarError('TAR_TYPE', `unsupported entry type "${type}": ${JSON.stringify(name)}`)
		if (out.length >= lim.maxEntries) throw new TarError('TAR_TOO_MANY', `more than ${lim.maxEntries} entries`)
		out.push({ name: safeName(name), type: type === '5' ? 'dir' : 'file', mode: octal(h, 100, 8) & 0o777, data: type === '5' ? Buffer.alloc(0) : Buffer.from(data) })
	}
	return out
}

function header(name, size, type, mode) {
	const h = Buffer.alloc(512)
	h.write(name, 0, 100, 'utf8')
	h.write(`${mode.toString(8).padStart(7, '0')}\0`, 100)
	h.write('0000000\0', 108) // uid
	h.write('0000000\0', 116) // gid
	h.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
	h.write('00000000000\0', 136) // mtime 0: reproducible
	h.write('        ', 148)
	h.write(type, 156)
	h.write('ustar\0', 257)
	h.write('00', 263)
	let sum = 0
	for (let i = 0; i < 512; i++) sum += h[i]
	h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
	return h
}

const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512)

/**
 * @param {Array<{ name: string, type?: 'file'|'dir'|'symlink'|'hardlink', mode?: number, data?: Buffer|string, linkTarget?: string }>} entries
 *   names are written verbatim (the smokes build hostile archives with this too); `symlink` / `hardlink` exist only so
 *   a test can prove the reader refuses them
 * @returns {Buffer} gzip'd tar
 */
function writeTarGz(entries) {
	const parts = []
	for (const e of entries) {
		const type = e.type === 'dir' ? '5' : e.type === 'symlink' ? '2' : e.type === 'hardlink' ? '1' : '0'
		const data = type === '0' ? (Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data ?? ''), 'utf8')) : Buffer.alloc(0)
		const name = e.type === 'dir' && !e.name.endsWith('/') ? `${e.name}/` : e.name
		if (Buffer.byteLength(name) > 99) {
			const ln = Buffer.from(`${name}\0`, 'utf8')
			parts.push(header('././@LongLink', ln.length, 'L', 0o644), ln, pad(ln.length))
		}
		const h = header(name, data.length, type, e.mode ?? (type === '5' ? 0o755 : 0o644))
		if (e.linkTarget) {
			h.write(e.linkTarget, 157, 100, 'utf8')
			h.write('        ', 148)
			let sum = 0
			for (let i = 0; i < 512; i++) sum += h[i]
			h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
		}
		parts.push(h, data, pad(data.length))
	}
	parts.push(Buffer.alloc(1024))
	return zlib.gzipSync(Buffer.concat(parts), { level: 9 })
}

module.exports = { readTarGz, writeTarGz }

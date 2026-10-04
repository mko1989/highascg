/**
 * Ingest logic (upload and URL download) for Sources Panel.
 */
import { api, getApiBase } from '../lib/api-client.js'
import { postFormDataWithProgress } from '../lib/form-upload.js'

/**
 * Flatten a drop into `{ file, dir }` entries, walking dropped folders (dataTransfer.files alone
 * yields one empty entry per folder — the "drop a folder, only the folder appears" bug).
 * Must be called synchronously inside the drop handler: entries die once the event returns.
 * @param {DataTransfer | null | undefined} dt
 * @returns {Promise<{ file: File, dir: string }[]>}
 */
export function collectDroppedFiles(dt) {
	const entries = Array.from(dt?.items || []).map((it) => (it.kind === 'file' ? it.webkitGetAsEntry?.() : null))
	if (!entries.length || entries.some((e) => !e)) return Promise.resolve(Array.from(dt?.files || []).map((file) => ({ file, dir: '' })))
	const out = []
	const readAll = (reader) => new Promise((res, rej) => {
		const acc = []
		const next = () => reader.readEntries((batch) => { if (!batch.length) res(acc); else { acc.push(...batch); next() } }, rej)
		next()
	})
	const walk = async (entry, dir) => {
		if (entry.isFile) out.push({ file: await new Promise((res, rej) => entry.file(res, rej)), dir })
		else if (entry.isDirectory) {
			const sub = dir ? `${dir}/${entry.name}` : entry.name
			for (const child of await readAll(entry.createReader())) await walk(child, sub)
		}
	}
	return entries.reduce((p, e) => p.then(() => walk(e, '')), Promise.resolve()).then(() => out)
}

/**
 * Upload dropped `{ file, dir }` entries: one request per folder (server takes one target `path`
 * per request), chunked under busboy's 64-files limit.
 */
export async function uploadDroppedEntries(entries, opts) {
	const groups = new Map()
	for (const { file, dir } of entries) {
		if (!groups.has(dir)) groups.set(dir, [])
		groups.get(dir).push(file)
	}
	const base = opts.uploadSubdir || ''
	const total = entries.length
	let done = 0
	for (const [dir, files] of groups) {
		for (let i = 0; i < files.length; i += 64) {
			const chunk = files.slice(i, i + 64)
			const sub = [base, dir].filter(Boolean).join('/')
			const ok = await uploadFiles(chunk, { ...opts, uploadSubdir: sub, refreshCallback: () => {}, label: total > chunk.length ? ` (${done + chunk.length}/${total})` : '' })
			if (!ok) return
			done += chunk.length
		}
	}
	if (groups.size > 1 || total > 64) opts.setStatus(`✓ Uploaded ${total} file(s) in ${groups.size} folder(s)`, 'ok')
	opts.refreshCallback()
}

export async function uploadFiles(files, { setStatus, showProgress, updateProgress, refreshCallback, uploadSubdir = '', label = '' }) {
	if (!files?.length) return false
	const fd = new FormData()
	// `path` first: busboy streams parts in order, so a trailing field arrives after the files.
	if (uploadSubdir) fd.append('path', uploadSubdir)
	for (const f of files) fd.append('file', f, f.name)
	setStatus(`Uploading ${files.length} file(s)${label}…`, 'info'); showProgress(true)
	try {
		const res = await postFormDataWithProgress(getApiBase() + '/api/ingest/upload', fd, (l, t) => { if (t > 0) updateProgress(Math.min(100, Math.round((l / t) * 100))); else updateProgress(null) })
		if (!res.ok) { setStatus(`✗ ${res.error || 'Upload failed'}`, 'error'); return false }
		setStatus(`✓ Uploaded ${res.count || files.length} file(s)`, 'ok'); refreshCallback()
		return true
	} catch (e) { setStatus(`✗ ${e.message}`, 'error'); return false }
}

export function createDownloadPoller({ setStatus, refreshCallback }) {
	let timer = null; const stop = () => { if (timer) { clearInterval(timer); timer = null } }
	const tick = async () => {
		try {
			const st = await api.get('/api/ingest/download-status')
			if (st.active) { setStatus(`${st.message || 'Working…'}${st.progress ? ` ${Math.round(Number(st.progress))}%` : ''}`, 'info'); return }
			stop(); if (st.error) setStatus(`✗ ${st.error}`, 'error'); else { setStatus(`✓ ${st.message || 'Done'}`, 'ok'); refreshCallback() }
		} catch (e) { stop(); setStatus(`✗ ${e.message}`, 'error') }
	}
	return { start: () => { stop(); tick(); timer = setInterval(tick, 450) }, stop }
}

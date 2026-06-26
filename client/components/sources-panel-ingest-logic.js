/**
 * Ingest logic (upload and URL download) for Sources Panel.
 */
import { api, getApiBase } from '../lib/api-client.js'
import { postFormDataWithProgress } from '../lib/form-upload.js'

export async function uploadFiles(files, { setStatus, showProgress, updateProgress, refreshCallback }) {
	if (!files?.length) return
	const fd = new FormData(); for (const f of files) fd.append('file', f, f.name)
	setStatus(`Uploading ${files.length} file(s)…`, 'info'); showProgress(true)
	try {
		const res = await postFormDataWithProgress(getApiBase() + '/api/ingest/upload', fd, (l, t) => { if (t > 0) updateProgress(Math.min(100, Math.round((l / t) * 100))); else updateProgress(null) })
		if (!res.ok) { setStatus(`✗ ${res.error || 'Upload failed'}`, 'error'); return }
		setStatus(`✓ Uploaded ${res.count || files.length} file(s)`, 'ok'); refreshCallback()
	} catch (e) { setStatus(`✗ ${e.message}`, 'error') }
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

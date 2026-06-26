/**
 * Settings modal: media mount, exFAT sync table, system hardware (NVIDIA), DeckLink summaries.
 */
import { api } from '../lib/api-client.js'
import { resolveApiUrl } from '../lib/api-origin.js'
import { settingsState } from '../lib/settings-state.js'

function escapeHtml(s) {
	return String(s || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function exfatPairStatus(row) {
	if (row.pairError) return row.pairError
	if (!row.exfatExists && !row.projectExists) return 'both sides missing'
	if (!row.exfatExists) return 'exFAT side missing'
	if (!row.projectExists) return 'project side missing'
	if (row.exfatIsDirectory && row.projectIsDirectory) return 'directory ↔ directory'
	if (row.exfatIsFile || row.projectIsFile) return 'file pair'
	return 'ok'
}

export async function refreshMediaMountPanel(modal) {
	const sel = modal.querySelector('#media-mount-part-select')
	const line = modal.querySelector('#media-mount-status-line')
	const applyBtn = modal.querySelector('#media-mount-apply-btn')
	if (!sel || !line) return
	const prev = sel.value
	line.textContent = 'Loading…'
	try {
		const [dRes, mRes] = await Promise.all([
			api.get('/api/usb/drives').catch((e) => { throw e }),
			api.get('/api/system/media-mount/status').catch(() => null),
		])
		const devices = Array.isArray(dRes?.drives) ? dRes.drives : []
		sel.innerHTML = '<option value="">— select —</option>'
		for (const d of devices) {
			const rm = d.removable ? 'removable' : 'internal'
			const lbl = [d.label, d.mountpoint ? ` @ ${d.mountpoint}` : ''].join('').trim()
			const pathStr = d.device || d.mountpoint || ''
			const fsTypeStr = d.fsType || d.fstype || ''
			const txt =
				`[${rm}] ${pathStr} ${d.size || ''} ${fsTypeStr}${lbl ? ' — ' + lbl : ''}`
					.replace(/\s+/g, ' ')
					.trim()
			const opt = document.createElement('option')
			opt.value = d.id || d.uuid
			opt.textContent = txt
			sel.appendChild(opt)
		}
		if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev
		const lines = []
		if (mRes?.unsupported) lines.push('Drive list unavailable on this platform.')
		if (mRes?.mounted)
			lines.push(`Mounted: ${mRes.source || '?'} (${mRes.fstype || '?'})  uuid=${mRes.uuid || '?'}`)
		else if (mRes?.inheritsFromFilesystem)
			lines.push(
				`On host filesystem (${mRes.inheritsFromFilesystem}); no partition mounted solely at /home/casparcg/highascg/media/drive.`,
			)
		else if (!mRes)
			lines.push('Mount status endpoint not available.')
		else lines.push('Folder is not separately mounted.')
		if (mRes?.savedUuid)
			lines.push(
				`Saved at startup: ${mRes.savedUuid}${mRes.savedKernelName ? ` (${mRes.savedKernelName})` : ''}`,
			)
		line.textContent = lines.join(' · ')
		if (applyBtn) applyBtn.disabled = !sel.value
	} catch (e) {
		line.textContent = formatSettingsFetchError(e, '/api/usb/drives')
	}
}

function formatSettingsFetchError(err, path) {
	const msg = err?.message || String(err)
	if (/networkerror/i.test(msg)) {
		return `${msg} — cannot reach ${resolveApiUrl(path)}. Check the playout API is running, firewall allows the port, and the Web UI uses the same host (not 127.0.0.1 from another machine).`
	}
	return msg
}

export async function refreshExfatSyncPanel(modal) {
	const line = modal.querySelector('#exfat-sync-status-line')
	const tbody = modal.querySelector('#exfat-sync-pairs-table tbody')
	if (!line || !tbody) return
	line.textContent = 'Loading…'
	try {
		const r = await api.get('/api/system/exfat-sync')
		if (r?.unsupported) {
			line.textContent = 'exFAT sync map is only listed on Linux.'
			tbody.innerHTML = ''
			return
		}
		const bits = []
		if (r?.mapPath) bits.push(`map: ${r.mapPath}`)
		else bits.push('no map file matched')
		if (r?.mapLoadError) bits.push(r.mapLoadError)
		bits.push(
			r?.mounted ?
				`mounted: ${r.mountSource || '?'} (${r.mountFstype || '?'})`
			:	`exFAT root not mounted (${r.exfatRoot || '/home/casparcg/exfat'})`,
		)
		line.textContent = bits.join(' · ')
		const pairs = Array.isArray(r?.pairs) ? r.pairs : []
		tbody.innerHTML = ''
		for (const row of pairs) {
			const tr = document.createElement('tr')
			tr.style.borderBottom = '1px solid rgba(255,255,255,0.06)'
			const excl = Array.isArray(row.exclude) ? row.exclude.join(', ') : ''
			const dir = String(row.direction || 'both')
			tr.innerHTML = `<td style="padding:0.25rem 0.35rem;vertical-align:top">${escapeHtml(row.id)}</td><td style="padding:0.25rem 0.35rem;vertical-align:top"><code>${escapeHtml(row.exfatRelative)}</code></td><td style="padding:0.25rem 0.35rem;vertical-align:top"><code>${escapeHtml(row.projectPath)}</code></td><td style="padding:0.25rem 0.35rem;vertical-align:top;max-width:10rem;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(excl)}">${escapeHtml(excl)}</td><td style="padding:0.25rem 0.35rem;vertical-align:top">${escapeHtml(dir)}</td><td style="padding:0.25rem 0.35rem;vertical-align:top">${escapeHtml(exfatPairStatus(row))}</td>`
			tbody.appendChild(tr)
		}
		if (!pairs.length) {
			const tr = document.createElement('tr')
			tr.innerHTML =
				'<td colspan="6" style="padding:0.35rem">No pairs in map. Add a JSON map (see <code>config/exfat-sync.json</code>).</td>'
			tbody.appendChild(tr)
		}
	} catch (e) {
		line.textContent = formatSettingsFetchError(e, '/api/system/exfat-sync')
		tbody.innerHTML = ''
	}
}

export async function refreshSystemHardwarePanel(modal) {
	const summary = modal.querySelector('#system-hw-nvidia-summary')
	const stat = modal.querySelector('#system-hw-nvidia-status')
	if (!summary) return
	summary.textContent = 'Loading…'
	try {
		const r = await api.get('/api/system/gpu-nvidia')
		const lines = []
		if (Array.isArray(r?.nvidiaSmiLines) && r.nvidiaSmiLines.length)
			r.nvidiaSmiLines.forEach((l) => lines.push(`nvidia-smi: ${l}`))
		if (r?.loadedModuleVersion) lines.push(`modinfo nvidia version: ${r.loadedModuleVersion}`)
		if (r?.dpkgDriverLine) lines.push(`dpkg: ${r.dpkgDriverLine}`)
		summary.textContent = lines.length ? lines.join('\n') : '(no NVIDIA probes — GPU driver not loaded?)'
		if (stat) stat.textContent = ''
	} catch (e) {
		summary.textContent = e?.message || String(e)
	}
}

export async function refreshDecklinkPanel(modal) {
	const summary = modal.querySelector('#decklink-summary')
	const stat = modal.querySelector('#decklink-status-line')
	if (!summary) return
	summary.textContent = 'Loading…'
	try {
		const r = await api.get('/api/system/decklink')
		const rows = []
		const devs = Array.isArray(r?.devices) ? r.devices : []
		if (!devs.length) rows.push('No DeckLink devices discovered yet (ffmpeg + recent Caspar log).')
		for (const d of devs) {
			let line = `#${d.index} ${d.label}`
			if (d.externalRef != null && String(d.externalRef).length)
				line += `\tCaspar externalRef=${d.externalRef}`
			rows.push(line)
		}
		summary.textContent = rows.join('\n')
		if (stat) stat.textContent = ''
	} catch (e) {
		summary.textContent = e?.message || String(e)
	}
}

export function openMediaMountDestructiveConfirm(onDecision) {
	const ov = document.createElement('div')
	ov.className = 'modal-overlay'
	ov.setAttribute('data-media-mount-confirm', '')
	ov.innerHTML = `
			<div class="modal-content settings-modal" style="max-width:28rem">
				<div class="modal-header"><h2>Mount partition</h2></div>
				<div class="modal-body settings-body">
					<p class="settings-note">This will <strong>permanently delete</strong> all files currently under <code>/home/casparcg/highascg/media/drive</code> on this host, then mount the selected partition at that path. Anything that only lived in that folder (not on the disk you select) will be gone.</p>
					<div class="settings-group checkbox">
						<label><input type="checkbox" id="media-mount-ack-delete" /> I understand existing files in that folder will be deleted</label>
					</div>
				</div>
				<div class="modal-footer">
					<button type="button" class="btn btn--secondary" data-media-mount-cancel>Cancel</button>
					<button type="button" class="btn btn--primary" data-media-mount-run>Mount and save UUID</button>
				</div>
			</div>`
	document.body.appendChild(ov)
	const cleanup = () => {
		try {
			ov.remove()
		} catch {}
	}
	ov.querySelector('[data-media-mount-cancel]')?.addEventListener('click', () => {
		cleanup()
		onDecision(false)
	})
	ov.addEventListener('click', ev => {
		if (ev.target === ov) {
			cleanup()
			onDecision(false)
		}
	})
	ov.querySelector('[data-media-mount-run]')?.addEventListener('click', () => {
		const chk = ov.querySelector('#media-mount-ack-delete')
		if (!(chk && chk.checked)) {
			window.alert('Check the acknowledgement box first.')
			return
		}
		cleanup()
		onDecision(true)
	})
}

/** Media (USB) tab: refresh, dry-run, partition select, destructive mount apply. */
export function wireMediaUsbMountListeners(modal) {
	modal.querySelector('#media-mount-refresh-btn')?.addEventListener('click', () => void refreshMediaMountPanel(modal))
	modal.querySelector('#exfat-sync-refresh-btn')?.addEventListener('click', () => void refreshExfatSyncPanel(modal))
	modal.querySelector('#exfat-sync-dryrun-btn')?.addEventListener('click', async () => {
		const line = modal.querySelector('#exfat-sync-status-line')
		if (line) line.textContent = 'Dry-run…'
		try {
			const res = await api.post('/api/system/exfat-sync/run', { dryRun: true })
			const err = Array.isArray(res?.errors) ? res.errors.join('; ') : ''
			if (line) {
				line.textContent = `Dry-run: would update ${res?.copied ?? 0} file(s), skip ${res?.skipped ?? 0}. ${err || (res?.ok ? 'ok' : 'see errors')}`
			}
		} catch (e) {
			if (line) line.textContent = e?.message || String(e)
		}
	})
	modal.querySelector('#media-mount-part-select')?.addEventListener('change', e => {
		const applyBtn = modal.querySelector('#media-mount-apply-btn')
		if (applyBtn) applyBtn.disabled = !(e.target && e.target.value)
	})
	modal.querySelector('#media-mount-apply-btn')?.addEventListener('click', () => {
		const uuid = modal.querySelector('#media-mount-part-select')?.value
		if (!uuid) return
		openMediaMountDestructiveConfirm(async ok => {
			if (!ok) return
			const st = modal.querySelector('#media-mount-status-line')
			if (st) st.textContent = 'Mounting…'
			try {
				const res = await api.post('/api/system/media-mount', { uuid, confirm: 'DELETE_MEDIA' })
				if (st)
					st.textContent =
						res?.source ?
							`Mounted ${res.source}. UUID saved (${res.uuid}). Use Refresh in Sources → Media if clips do not appear.`
						:	'Mounted. UUID saved.'
				await settingsState.load()
				await refreshMediaMountPanel(modal)
			} catch (e) {
				if (st) st.textContent = e?.message || String(e)
			}
		})
	})
}

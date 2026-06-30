/**
 * Settings modal: exFAT sync table, system operator display, DeckLink summaries.
 */
import { api } from '../lib/api-client.js'
import { resolveApiUrl } from '../lib/api-origin.js'

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
	const operatorDisplay = modal.querySelector('#system-hw-operator-display')
	if (!operatorDisplay) return
	operatorDisplay.textContent = 'Loading operator display…'
	try {
		const od = await api.get('/api/system/operator-display').catch(() => null)
		const bits = [od?.summary || 'Operator display unknown.']
		if (Array.isArray(od?.interactiveAllowance) && od.interactiveAllowance.length) {
			bits.push(`Interactive Caspar heads (also allowed when confining): ${od.interactiveAllowance.join(', ')}.`)
		}
		if (od?.confineActive) bits.push('Pointer confine: active.')
		else if (od?.confineDesired) bits.push('Pointer confine: enabled on operator GPU port (Device View).')
		operatorDisplay.textContent = bits.join(' ')
	} catch (e) {
		operatorDisplay.textContent = e?.message || String(e)
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

/** Media (USB) tab: exFAT sync refresh and dry-run. */
export function wireMediaUsbMountListeners(modal) {
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
}

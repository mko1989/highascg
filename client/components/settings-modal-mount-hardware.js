/**
 * Settings modal: exFAT sync table, system operator display, DeckLink summaries.
 */
import { api } from '../lib/api-client.js'
import { resolveApiUrl } from '../lib/api-origin.js'
import { escapeHtml } from '../lib/dom-escape.js'

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

/**
 * Format bytes to human-readable size.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
	if (bytes == null) return '—'
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Render hardware summary section in the System pane.
 * @param {HTMLElement} container
 * @param {object} hw - hardware summary data
 */
function renderHardwareSummary(container, hw) {
	container.innerHTML = ''

	// CPU section
	const cpuDiv = document.createElement('div')
	cpuDiv.className = 'settings-group'
	cpuDiv.style.marginTop = '1rem'
	const cpuTitle = document.createElement('h4')
	cpuTitle.textContent = 'Processor'
	cpuTitle.style.margin = '0 0 0.5rem 0'
	cpuDiv.appendChild(cpuTitle)

	const cpuDl = document.createElement('dl')
	cpuDl.className = 'settings-kv'
	if (hw.cpu?.error) {
		const dt = document.createElement('dt')
		dt.textContent = 'Status'
		const dd = document.createElement('dd')
		dd.textContent = hw.cpu.error
		cpuDl.appendChild(dt)
		cpuDl.appendChild(dd)
	} else {
		const addRow = (label, value) => {
			const dt = document.createElement('dt')
			dt.textContent = label
			const dd = document.createElement('dd')
			dd.textContent = value || '—'
			cpuDl.appendChild(dt)
			cpuDl.appendChild(dd)
		}
		addRow('Model', hw.cpu?.modelName)
		addRow('Cores', hw.cpu?.cores)
		addRow('Load (1/5/15)', hw.cpu ? `${hw.cpu.load1.toFixed(1)}/${hw.cpu.load5.toFixed(1)}/${hw.cpu.load15.toFixed(1)}` : '—')
	}
	cpuDiv.appendChild(cpuDl)
	container.appendChild(cpuDiv)

	// Memory section
	const memDiv = document.createElement('div')
	memDiv.className = 'settings-group'
	memDiv.style.marginTop = '1rem'
	const memTitle = document.createElement('h4')
	memTitle.textContent = 'Memory'
	memTitle.style.margin = '0 0 0.5rem 0'
	memDiv.appendChild(memTitle)

	const memDl = document.createElement('dl')
	memDl.className = 'settings-kv'
	if (hw.memory?.error) {
		const dt = document.createElement('dt')
		dt.textContent = 'Status'
		const dd = document.createElement('dd')
		dd.textContent = hw.memory.error
		memDl.appendChild(dt)
		memDl.appendChild(dd)
	} else {
		const dt = document.createElement('dt')
		dt.textContent = 'Usage'
		const dd = document.createElement('dd')
		dd.textContent = `${formatBytes(hw.memory?.usedBytes)} / ${formatBytes(hw.memory?.totalBytes)}`
		memDl.appendChild(dt)
		memDl.appendChild(dd)
	}
	memDiv.appendChild(memDl)
	container.appendChild(memDiv)

	// Disks section
	if (Array.isArray(hw.disks) && hw.disks.length) {
		const diskDiv = document.createElement('div')
		diskDiv.className = 'settings-group'
		diskDiv.style.marginTop = '1rem'
		const diskTitle = document.createElement('h4')
		diskTitle.textContent = 'Storage Devices'
		diskTitle.style.margin = '0 0 0.5rem 0'
		diskDiv.appendChild(diskTitle)

		const diskTable = document.createElement('table')
		diskTable.className = 'settings-table'
		diskTable.style.width = '100%'
		diskTable.style.fontSize = '0.9rem'
		diskTable.style.borderCollapse = 'collapse'

		const thead = document.createElement('thead')
		const headerRow = document.createElement('tr')
		headerRow.style.borderBottom = '1px solid rgba(255,255,255,0.1)'
		const headers = ['Device', 'Size', 'Type', 'Mount Point']
		for (const h of headers) {
			const th = document.createElement('th')
			th.textContent = h
			th.style.textAlign = 'left'
			th.style.padding = '0.35rem'
			headerRow.appendChild(th)
		}
		thead.appendChild(headerRow)
		diskTable.appendChild(thead)

		const tbody = document.createElement('tbody')
		for (const disk of hw.disks) {
			if (disk.error) {
				const tr = document.createElement('tr')
				tr.style.borderBottom = '1px solid rgba(255,255,255,0.06)'
				const td = document.createElement('td')
				td.colSpan = 4
				td.textContent = disk.error
				td.style.padding = '0.35rem'
				tr.appendChild(td)
				tbody.appendChild(tr)
			} else {
				const tr = document.createElement('tr')
				tr.style.borderBottom = '1px solid rgba(255,255,255,0.06)'
				const cells = [disk.name, formatBytes(disk.size), disk.type || '—', disk.mountpoint || '(not mounted)']
				for (const cell of cells) {
					const td = document.createElement('td')
					td.textContent = cell
					td.style.padding = '0.35rem'
					tr.appendChild(td)
				}
				tbody.appendChild(tr)
			}
		}
		diskTable.appendChild(tbody)
		diskDiv.appendChild(diskTable)
		container.appendChild(diskDiv)
	}

	// GPU section
	const gpuDiv = document.createElement('div')
	gpuDiv.className = 'settings-group'
	gpuDiv.style.marginTop = '1rem'
	const gpuTitle = document.createElement('h4')
	gpuTitle.textContent = 'Graphics'
	gpuTitle.style.margin = '0 0 0.5rem 0'
	gpuDiv.appendChild(gpuTitle)

	const gpuDl = document.createElement('dl')
	gpuDl.className = 'settings-kv'
	if (hw.gpu?.nvidia?.error) {
		const dt = document.createElement('dt')
		dt.textContent = 'NVIDIA GPU'
		const dd = document.createElement('dd')
		dd.textContent = hw.gpu.nvidia.error
		gpuDl.appendChild(dt)
		gpuDl.appendChild(dd)
	} else if (hw.gpu?.nvidia) {
		const addRow = (label, value) => {
			const dt = document.createElement('dt')
			dt.textContent = label
			const dd = document.createElement('dd')
			dd.textContent = value || '—'
			gpuDl.appendChild(dt)
			gpuDl.appendChild(dd)
		}
		addRow('Name', hw.gpu.nvidia.name)
		addRow('Driver', hw.gpu.nvidia.driver)
		addRow('VRAM', hw.gpu.nvidia.vramMiB)
	}

	if (Array.isArray(hw.gpu?.displayPorts) && hw.gpu.displayPorts.length) {
		const dt = document.createElement('dt')
		dt.textContent = 'Display Ports'
		const dd = document.createElement('dd')
		const ports = hw.gpu.displayPorts.map((p) => `${p.type} (${p.name})${p.connected ? ' ✓' : ''}`).join(', ')
		dd.textContent = ports
		gpuDl.appendChild(dt)
		gpuDl.appendChild(dd)
	}

	gpuDiv.appendChild(gpuDl)
	container.appendChild(gpuDiv)

	// DeckLink section
	if (Array.isArray(hw.decklink?.devices) && hw.decklink.devices.length) {
		const dlDiv = document.createElement('div')
		dlDiv.className = 'settings-group'
		dlDiv.style.marginTop = '1rem'
		const dlTitle = document.createElement('h4')
		dlTitle.textContent = 'DeckLink Devices'
		dlTitle.style.margin = '0 0 0.5rem 0'
		dlDiv.appendChild(dlTitle)

		const dlList = document.createElement('ul')
		dlList.style.margin = '0'
		dlList.style.paddingLeft = '1.5rem'
		for (const dev of hw.decklink.devices) {
			const li = document.createElement('li')
			li.textContent = `#${dev.index} ${dev.label}`
			dlList.appendChild(li)
		}
		dlDiv.appendChild(dlList)
		container.appendChild(dlDiv)
	} else if (hw.decklink?.error) {
		const dlDiv = document.createElement('div')
		dlDiv.className = 'settings-group'
		dlDiv.style.marginTop = '1rem'
		const dlTitle = document.createElement('h4')
		dlTitle.textContent = 'DeckLink'
		dlTitle.style.margin = '0 0 0.5rem 0'
		dlDiv.appendChild(dlTitle)
		const p = document.createElement('p')
		p.className = 'settings-note'
		p.textContent = hw.decklink.error
		dlDiv.appendChild(p)
		container.appendChild(dlDiv)
	}

	// Audio section
	if (hw.audio && !hw.audio.error) {
		const audioDiv = document.createElement('div')
		audioDiv.className = 'settings-group'
		audioDiv.style.marginTop = '1rem'
		const audioTitle = document.createElement('h4')
		audioTitle.textContent = 'Audio Devices'
		audioTitle.style.margin = '0 0 0.5rem 0'
		audioDiv.appendChild(audioTitle)

		const audioDl = document.createElement('dl')
		audioDl.className = 'settings-kv'
		const dt = document.createElement('dt')
		dt.textContent = 'Count'
		const dd = document.createElement('dd')
		dd.textContent = hw.audio.deviceCount || '0'
		audioDl.appendChild(dt)
		audioDl.appendChild(dd)

		if (Array.isArray(hw.audio.devices) && hw.audio.devices.length) {
			const dt2 = document.createElement('dt')
			dt2.textContent = 'Devices'
			const dd2 = document.createElement('dd')
			dd2.innerHTML = hw.audio.devices.map((d) => `<div>${escapeHtml(d.name)} (${d.type})</div>`).join('')
			audioDl.appendChild(dt2)
			audioDl.appendChild(dd2)
		}
		audioDiv.appendChild(audioDl)
		container.appendChild(audioDiv)
	}

	// Network section
	if (hw.network && !hw.network.error) {
		const netDiv = document.createElement('div')
		netDiv.className = 'settings-group'
		netDiv.style.marginTop = '1rem'
		const netTitle = document.createElement('h4')
		netTitle.textContent = 'Network'
		netTitle.style.margin = '0 0 0.5rem 0'
		netDiv.appendChild(netTitle)

		const netDl = document.createElement('dl')
		netDl.className = 'settings-kv'
		const dt = document.createElement('dt')
		dt.textContent = 'Hostname'
		const dd = document.createElement('dd')
		dd.textContent = hw.network.hostname || '—'
		netDl.appendChild(dt)
		netDl.appendChild(dd)

		if (Array.isArray(hw.network.interfaces) && hw.network.interfaces.length) {
			const dt2 = document.createElement('dt')
			dt2.textContent = 'Interfaces'
			const dd2 = document.createElement('dd')
			dd2.innerHTML = hw.network.interfaces
				.map((i) => `<div>${escapeHtml(i.name)} ${i.address ? `(${i.address})` : '(no IPv4)'}</div>`)
				.join('')
			netDl.appendChild(dt2)
			netDl.appendChild(dd2)
		}
		netDiv.appendChild(netDl)
		container.appendChild(netDiv)
	}

	// System info section
	if (hw.system && !hw.system.error) {
		const sysDiv = document.createElement('div')
		sysDiv.className = 'settings-group'
		sysDiv.style.marginTop = '1rem'
		const sysTitle = document.createElement('h4')
		sysTitle.textContent = 'System'
		sysTitle.style.margin = '0 0 0.5rem 0'
		sysDiv.appendChild(sysTitle)

		const sysDl = document.createElement('dl')
		sysDl.className = 'settings-kv'

		const addRow = (label, value) => {
			const dt = document.createElement('dt')
			dt.textContent = label
			const dd = document.createElement('dd')
			dd.textContent = value || '—'
			sysDl.appendChild(dt)
			sysDl.appendChild(dd)
		}

		addRow('OS', hw.system.osRelease)
		addRow('Kernel', hw.system.kernel)
		const uptimeDays = Math.floor(hw.system.uptimeSec / 86400)
		const uptimeHours = Math.floor((hw.system.uptimeSec % 86400) / 3600)
		const uptimeMins = Math.floor((hw.system.uptimeSec % 3600) / 60)
		const uptimeStr = `${uptimeDays}d ${uptimeHours}h ${uptimeMins}m`
		addRow('Uptime', uptimeStr)

		sysDiv.appendChild(sysDl)
		container.appendChild(sysDiv)
	}
}

export async function refreshSystemHardwarePanel(modal) {
	const operatorDisplay = modal.querySelector('#system-hw-operator-display')
	if (!operatorDisplay) return

	operatorDisplay.textContent = 'Loading…'

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

	// Fetch hardware summary
	try {
		const hw = await api.get('/api/system/hardware')
		const hwContainer = operatorDisplay.parentElement?.querySelector('#system-hw-summary-container')
		if (hwContainer) {
			renderHardwareSummary(hwContainer, hw)
		}
	} catch (e) {
		// Silently fail if hardware summary fetch fails; operator display is the critical part
		console.warn('[settings-modal] hardware summary fetch failed:', e?.message)
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

		// Update install button state based on vendor availability
		const installBtn = modal.querySelector('#decklink-install-btn')
		if (installBtn) {
			installBtn.disabled = !r?.vendorAvailable
			installBtn.title = r?.vendorAvailable ? 'Install DeckLink from USB' : 'No vendor files available'
		}
	} catch (e) {
		summary.textContent = e?.message || String(e)
	}
}

/** Wire up DeckLink install button listener. */
export function wireDecklinkInstallListener(modal) {
	const installBtn = modal.querySelector('#decklink-install-btn')
	const resultLine = modal.querySelector('#decklink-install-result')
	if (!installBtn) return

	installBtn.addEventListener('click', async () => {
		const password = prompt('Enter nuclear password to confirm DeckLink install:')
		if (password === null) return // User cancelled

		installBtn.disabled = true
		if (resultLine) resultLine.textContent = 'Installing…'

		try {
			const res = await api.post('/api/system/decklink/install', { password })
			if (res?.ok) {
				const msg = res.reason ? `${res.action}: ${res.reason}` : res.action
				if (resultLine) resultLine.textContent = msg
			} else {
				const errMsg = res?.error || 'Unknown error'
				if (resultLine) resultLine.textContent = `Error: ${errMsg}`
			}
		} catch (e) {
			const msg = e?.message || String(e)
			if (resultLine) resultLine.textContent = `Error: ${msg}`
		} finally {
			installBtn.disabled = false
			// Refresh the panel after install attempt
			await refreshDecklinkPanel(modal)
		}
	})
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

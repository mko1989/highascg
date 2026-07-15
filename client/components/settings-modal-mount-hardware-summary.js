/**
 * Settings modal: hardware summary section rendering (System pane).
 * Extracted from settings-modal-mount-hardware.js (WO-221 Phase A mechanical split).
 */
import { escapeHtml } from '../lib/dom-escape.js'

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
export function renderHardwareSummary(container, hw) {
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

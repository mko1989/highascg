/**
 * Settings modal: exFAT sync table, system operator display, DeckLink summaries.
 */
import { api } from '../lib/api-client.js'
import { resolveApiUrl } from '../lib/api-origin.js'
import { settingsState } from '../lib/settings-state.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { renderHardwareSummary } from './settings-modal-mount-hardware-summary.js'

let systemTimePasswordRequired = false // WO-193 fix: prompt only when the nuclear gate is active

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
			installBtn.title = r?.vendorAvailable
				? 'Install the staged Desktop Video package'
				: 'No Desktop Video package found — put the Blackmagic tar.gz in Downloads on this machine, or upload it here'
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
		/* WO-428 follow-up: only ask for the nuclear password when the gate is actually ON —
		 * the server's checkNuclearPassword passes without one when nuclearRequirePassword is
		 * false, so prompting an owner who never set a password was pure confusion (WO-193
		 * established the same rule for system-time). */
		const ui = settingsState.getSettings()?.ui || {}
		const gateOn = ui.nuclearRequirePassword === true || ui.nuclearRequirePassword === 'true'
		let password = ''
		if (gateOn) {
			password = prompt('Enter nuclear password to confirm DeckLink install:')
			if (password === null) return // User cancelled
		} else if (!window.confirm('Install/update the DeckLink driver now? Capture may restart.')) {
			return
		}

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

/**
 * Refresh system time display with current clock and NTP state.
 * Starts a local clock ticker to show live time updates.
 */
export async function refreshSystemTimePanel(modal) {
	const clockLine = modal.querySelector('#system-time-clock')
	const ntpCheckbox = modal.querySelector('#system-time-ntp-toggle')
	const dateInput = modal.querySelector('#system-time-date-input')
	const timeInput = modal.querySelector('#system-time-time-input')

	if (!clockLine) return

	clockLine.textContent = 'Loading…'

	try {
		const r = await api.get('/api/system/time')
		systemTimePasswordRequired = r?.passwordRequired === true
		if (!r?.ok) {
			clockLine.textContent = `Error: ${r?.error || 'Unknown error'}`
			return
		}

		// Parse the time string: "Tue 2026-07-14 10:27:20 UTC"
		const timeStr = r.now || ''
		const parts = timeStr.split(' ')
		const dateStr = parts[1] || ''
		const timeStr2 = parts[2] || ''

		// Update form fields with current values
		if (dateInput && dateStr) dateInput.value = dateStr
		if (timeInput && timeStr2) timeInput.value = timeStr2

		// Update NTP checkbox
		if (ntpCheckbox) ntpCheckbox.checked = r.ntp === true

		// Parse to get a base timestamp for local clock
		const baseTime = new Date(`${dateStr}T${timeStr2}Z`)
		const baseMs = baseTime.getTime()
		const startMs = Date.now()

		// Create a live clock display with local offset
		const updateClock = () => {
			const elapsed = Date.now() - startMs
			const currentTime = new Date(baseMs + elapsed)
			const datepart = currentTime.toISOString().split('T')[0]
			const timepart = currentTime.toISOString().split('T')[1].slice(0, 8)
			const tzStr = r.timezone || 'UTC'
			const syncStr = r.synchronized ? 'sync' : 'unsynced'
			clockLine.textContent = `${datepart} ${timepart} ${tzStr} (${syncStr})`
		}

		updateClock()
		const tickInterval = setInterval(updateClock, 200)

		// Store interval ID on element for cleanup if needed
		clockLine._tickInterval = tickInterval
	} catch (e) {
		clockLine.textContent = e?.message || String(e)
	}
}

/**
 * Wire up system time control listeners (NTP toggle, Set button).
 */
export function wireSystemTimeListeners(modal) {
	const setBtn = modal.querySelector('#system-time-set-btn')
	const ntpCheckbox = modal.querySelector('#system-time-ntp-toggle')
	const dateInput = modal.querySelector('#system-time-date-input')
	const timeInput = modal.querySelector('#system-time-time-input')
	const resultLine = modal.querySelector('#system-time-result')

	if (!setBtn) return

	// Disable Set button when NTP is on
	if (ntpCheckbox) {
		const updateSetBtnState = () => {
			setBtn.disabled = ntpCheckbox.checked
			setBtn.title = ntpCheckbox.checked ? 'Disable NTP to set manual time' : 'Set system time'
		}
		updateSetBtnState()
		ntpCheckbox.addEventListener('change', async () => {
			let password = ''
			if (systemTimePasswordRequired) {
				const enteredNtp = prompt('Enter nuclear password to confirm NTP toggle:')
				if (enteredNtp === null) return
				password = enteredNtp
			}
			if (password === null) {
				ntpCheckbox.checked = !ntpCheckbox.checked
				return
			}

			try {
				const res = await api.post('/api/system/time', {
					password,
					ntp: ntpCheckbox.checked,
				})
				if (res?.ok) {
					if (resultLine) resultLine.textContent = `NTP: ${res.ntp ? 'enabled' : 'disabled'}`
				} else {
					const errMsg = res?.error || 'Unknown error'
					if (resultLine) resultLine.textContent = `Error: ${errMsg}`
					ntpCheckbox.checked = !ntpCheckbox.checked
				}
			} catch (e) {
				const msg = e?.message || String(e)
				if (resultLine) resultLine.textContent = `Error: ${msg}`
				ntpCheckbox.checked = !ntpCheckbox.checked
			} finally {
				// Refresh after toggle
				await refreshSystemTimePanel(modal)
			}
		})
	}

	// Set button listener
	setBtn.addEventListener('click', async () => {
		if (!dateInput || !timeInput) {
			if (resultLine) resultLine.textContent = 'Error: Date/time inputs not found'
			return
		}

		const date = dateInput.value?.trim()
		let time = timeInput.value?.trim()

		if (!date || !time) {
			if (resultLine) resultLine.textContent = 'Error: Date and time are required'
			return
		}

		/* 24h text field (the native type="time" input capped hours at 12 in 12h locales).
		 * Accept H:MM, HH:MM or HH:MM:SS; normalize to HH:MM:SS. */
		const tm = time.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/)
		if (!tm) {
			if (resultLine) resultLine.textContent = 'Error: time must be HH:MM[:SS] (24h, 00-23 hours)'
			return
		}
		time = `${tm[1].padStart(2, '0')}:${tm[2]}:${tm[3] ?? '00'}`

		const confirmed = confirm(
			'Warning: changing system time while recording or streaming can disturb timestamps. Continue?',
		)
		if (!confirmed) return

		let password = ''
		if (systemTimePasswordRequired) {
			const entered = prompt('Enter nuclear password to confirm time setting:')
			if (entered === null) return
			password = entered
		}

		setBtn.disabled = true
		if (resultLine) resultLine.textContent = 'Setting time…'

		try {
			const res = await api.post('/api/system/time', {
				password,
				set: `${date} ${time}`,
			})
			if (res?.ok) {
				if (resultLine) resultLine.textContent = `Time set: ${res.now || date}`
			} else {
				const errMsg = res?.error || 'Unknown error'
				if (resultLine) resultLine.textContent = `Error: ${errMsg}`
			}
		} catch (e) {
			const msg = e?.message || String(e)
			if (resultLine) resultLine.textContent = `Error: ${msg}`
		} finally {
			setBtn.disabled = false
			// Refresh the panel after setting time
			await refreshSystemTimePanel(modal)
		}
	})
}

/** WO-427: browser upload of the Blackmagic Desktop Video package into the local vendor dir
 * (`vendor/decklink/` under the repo) — the install script scans it first, so no USB stick is
 * needed. Upload only stages; installing stays behind the password-gated Install button. */
export function wireDecklinkUploadListener(modal) {
	const btn = modal.querySelector('#decklink-upload-btn')
	const input = modal.querySelector('#decklink-upload-input')
	const resultLine = modal.querySelector('#decklink-install-result')
	if (!btn || !input) return
	btn.addEventListener('click', async () => {
		const file = input.files && input.files[0]
		if (!file) {
			if (resultLine) resultLine.textContent = 'Choose the Blackmagic_Desktop_Video_Linux_*.tar.gz first.'
			return
		}
		btn.disabled = true
		if (resultLine) resultLine.textContent = `Uploading ${file.name} (${Math.round(file.size / 1e6)} MB)…`
		try {
			const fd = new FormData()
			fd.append('file', file, file.name)
			const res = await fetch(resolveApiUrl('/api/system/decklink/upload'), { method: 'POST', body: fd })
			const data = await res.json().catch(() => ({}))
			if (res.ok && data?.ok) {
				if (resultLine) resultLine.textContent = `Uploaded ${data.savedAs} — now press Install driver.`
			} else {
				if (resultLine) resultLine.textContent = `Upload failed: ${data?.error || `HTTP ${res.status}`}`
			}
		} catch (e) {
			if (resultLine) resultLine.textContent = `Upload failed: ${e?.message || e}`
		} finally {
			btn.disabled = false
			await refreshDecklinkPanel(modal)
		}
	})
}

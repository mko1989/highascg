/**
 * System Settings — manages OS-level hardware mapping (monitors, X11 layout).
 * @see 11_WO_BOOT_ORCHESTRATOR_AND_OS_SETUP.md Phase 4
 */

import { api } from '../lib/api-client.js'
import { getVariableStore } from '../lib/variable-state.js'
import { ws } from '../app.js'

export async function mountSystemSettings(container) {
	container.innerHTML = `
		<div class="system-settings-loading">Loading hardware info...</div>
	`

	try {
		const hw = await api.get('/api/hardware/displays')
		const cfg = await api.get('/api/settings')
		const displays = hw.displays || []

		container.innerHTML = `
			<p class="settings-note">Map physical monitor outputs to your CasparCG screens. "Apply OS Changes" will execute xrandr and restart the display manager (nodm).</p>
			
			<div class="settings-group">
				<label>Detected Displays (Hardware)</label>
				<div class="hw-pill-box">
					${displays.length ? displays.map(d => `<span class="hw-pill">${d}</span>`).join('') : '<span class="hw-pill status-warn">None detected</span>'}
				</div>
			</div>

			<div class="settings-group">
				<label>Number of Main Screens</label>
				<input type="number" id="sys-screen-count" min="1" max="4" value="${cfg.screen_count || 1}">
			</div>

			<div id="sys-mapping-container"></div>

			<div class="settings-actions">
				<button class="btn btn--danger" id="sys-apply-os">Apply OS / X11 Changes</button>
				<p class="settings-note small">⚠️ Warning: Applying OS changes will restart the display server and cause flickering or temporary disconnection.</p>
			</div>

			<div class="settings-group diagnostics-panel">
				<div class="settings-popover-title">Server Health &amp; Diagnostics</div>
				<div class="diag-row"><strong>Server Uptime:</strong> <span id="diag-uptime">—</span></div>
				<div class="diag-row"><strong>Memory (RSS):</strong> <span id="diag-memory">—</span></div>
				<div class="diag-row"><strong>Caspar Status:</strong> <span id="diag-caspar">—</span></div>
			</div>
		`

		const mappingContainer = container.querySelector('#sys-mapping-container')
		const renderMapping = () => {
			const count = parseInt(container.querySelector('#sys-screen-count').value, 10) || 1
			let html = ''
			for (let i = 1; i <= count; i++) {
				const current = cfg[`screen_${i}_system_id`] || ''
				html += `
					<div class="settings-group">
						<label>Screen ${i} Mapping</label>
						<select class="sys-map-select" data-screen="${i}">
							<option value="">Auto / Default</option>
							${displays.map(d => `<option value="${d}" ${d === current ? 'selected' : ''}>${d}</option>`).join('')}
						</select>
					</div>
				`
			}
			mappingContainer.innerHTML = html
		}

		renderMapping()
		container.querySelector('#sys-screen-count').onchange = renderMapping

		// We need to provide a way to get the settings from this component
		container.getSystemSettings = () => {
			const data = {
				screen_count: parseInt(container.querySelector('#sys-screen-count').value, 10)
			}
			container.querySelectorAll('.sys-map-select').forEach(sel => {
				const screenIdx = sel.dataset.screen
				data[`screen_${screenIdx}_system_id`] = sel.value
			})
			return data
		}

		const btnApply = container.querySelector('#sys-apply-os')
		btnApply.onclick = async () => {
			if (!confirm('Are you sure you want to apply X11 layout changes and restart the display manager? Screens will flicker.')) return
			
			const oldText = btnApply.textContent
			btnApply.disabled = true
			btnApply.textContent = 'Applying...'
			try {
				const res = await api.post('/api/settings/apply-os', {})
				if (res.ok) {
					alert('OS changes applied. Display manager restart triggered.\n' + (res.dmRestarted ? 'Success' : 'Restart failed (check server logs)'))
				} else {
					alert('Error: ' + (res.error || 'Unknown error'))
				}
			} catch (e) {
				alert('Failed to apply OS changes: ' + e.message)
			} finally {
				btnApply.disabled = false
				btnApply.textContent = oldText
			}
		}

		// Real-time diagnostics loop
		const vars = getVariableStore(ws)
		const uptimeEl = container.querySelector('#diag-uptime')
		const memEl = container.querySelector('#diag-memory')
		const casparEl = container.querySelector('#diag-caspar')

		const unsub = vars.subscribe((all) => {
			if (uptimeEl) uptimeEl.textContent = all.app_uptime || 'N/A'
			if (memEl) {
				const bytes = parseInt(all.app_memory_rss, 10)
				memEl.textContent = !isNaN(bytes) ? `${Math.round(bytes / 1024 / 1024)} MB` : 'N/A'
			}
			if (casparEl) {
				const conn = all.caspar_connected === 'true'
				casparEl.textContent = conn ? 'Connected' : 'Disconnected'
				casparEl.style.color = conn ? 'var(--accent-green)' : 'var(--accent-red)'
				casparEl.style.fontWeight = 'bold'
			}
		})

		// Clean up when container is removed
		const _destroy = container.destroy || (() => {})
		container.destroy = () => {
			unsub()
			_destroy()
		}

	} catch (e) {
		container.innerHTML = `<div class="status-error">Failed to load system info: ${e.message}</div>`
	}
}

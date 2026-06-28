/**
 * Settings → Diagnostics — support bundle + server logs entry (WO-67).
 */

import { getApiBase } from '../lib/api-client.js'
import { downloadSupportBundleFromApi } from '../lib/logs-modal-shared.js'
import { showLogsModal } from './logs-modal.js'

/**
 * @param {HTMLElement} modal
 */
export function wireDiagnosticsPanel(modal) {
	const bundleBtn = modal.querySelector('#settings-diagnostics-bundle')
	const logsBtn = modal.querySelector('#settings-diagnostics-logs')
	const statusEl = modal.querySelector('#settings-diagnostics-status')

	bundleBtn?.addEventListener('click', async () => {
		if (bundleBtn instanceof HTMLButtonElement) bundleBtn.disabled = true
		if (statusEl) statusEl.textContent = 'Building support bundle…'
		try {
			await downloadSupportBundleFromApi(getApiBase())
			if (statusEl) statusEl.textContent = 'Support bundle downloaded.'
		} catch (e) {
			const msg = e?.message || String(e)
			if (statusEl) statusEl.textContent = msg
		} finally {
			if (bundleBtn instanceof HTMLButtonElement) bundleBtn.disabled = false
		}
	})

	logsBtn?.addEventListener('click', () => {
		showLogsModal()
	})
}

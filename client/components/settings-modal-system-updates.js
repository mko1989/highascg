/**
 * Settings → Updates tab (WO-66): build stamp, GitHub release check, apply.
 */
import { api } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'

let pollTimer = null

export function wireSystemUpdatesPanel(modal, { getNuclearPassword }) {
	modal.querySelector('#system-updates-refresh')?.addEventListener('click', () => void refreshSystemUpdatesPanel(modal))
	modal.querySelector('#system-updates-check')?.addEventListener('click', () => void refreshSystemUpdatesPanel(modal, { force: true }))
	modal.querySelector('#system-updates-apply')?.addEventListener('click', () => void applySystemUpdate(modal, { getNuclearPassword }))
}

export async function refreshSystemUpdatesPanel(modal, opts = {}) {
	const stampEl = modal.querySelector('#system-updates-stamp')
	const volEl = modal.querySelector('#system-updates-volumes')
	const checkEl = modal.querySelector('#system-updates-check-line')
	const applyBtn = modal.querySelector('#system-updates-apply')
	const logEl = modal.querySelector('#system-updates-log')
	if (!stampEl) return

	if (checkEl) checkEl.textContent = 'Loading…'
	try {
		const [ver, chk] = await Promise.all([
			api.get('/api/system/version'),
			api.get(`/api/system/update/check${opts.force ? '?force=1' : ''}`),
		])

		const running = ver?.buildStamp || ver?.packageVersion || '(unknown)'
		stampEl.textContent = running

		const volBits = []
		if (ver?.volumes?.usb?.mounted) {
			volBits.push(`USB drop: ${ver.volumes.usb.dropStamp || '—'} (applied ${ver.volumes.usb.appliedStamp || '—'})`)
		} else volBits.push('USB exFAT: not mounted')
		if (ver?.volumes?.bridge?.mounted) {
			volBits.push(`Bridge drop: ${ver.volumes.bridge.dropStamp || '—'}`)
		} else volBits.push('Bridge: not mounted')
		if (ver?.retainDrop) volBits.push('retain mode')
		if (volEl) volEl.textContent = volBits.join(' · ')

		if (checkEl) {
			if (chk?.error) {
				checkEl.textContent = `GitHub check failed: ${chk.error}`
			} else if (!chk?.latest) {
				checkEl.textContent = 'No highascg-server_*.tar.gz asset on latest release.'
			} else {
				const avail = chk.updateAvailable ? ' — update available' : ' — up to date'
				checkEl.innerHTML = `Latest: <code>${escapeHtml(chk.latest)}</code>${avail}${chk.cached ? ' (cached)' : ''} · <a href="${escapeHtml(chk.releaseUrl || '#')}" target="_blank" rel="noopener">GitHub release</a>`
			}
		}

		if (applyBtn) {
			applyBtn.disabled = !chk?.updateAvailable || !!chk?.error
		}

		const st = await api.get('/api/system/update/status').catch(() => null)
		if (st?.active || (st?.done && st?.log?.length)) {
			if (logEl) {
				logEl.textContent = [`Phase: ${st.phase || '?'}`, ...(st.log || [])].join('\n')
			}
			if (st.active) startApplyPoll(modal)
		}
	} catch (e) {
		if (checkEl) checkEl.textContent = e?.message || String(e)
	}
}

function startApplyPoll(modal) {
	stopApplyPoll()
	pollTimer = setInterval(() => void pollApplyStatus(modal), 1500)
}

function stopApplyPoll() {
	if (pollTimer) {
		clearInterval(pollTimer)
		pollTimer = null
	}
}

async function pollApplyStatus(modal) {
	const logEl = modal.querySelector('#system-updates-log')
	const applyBtn = modal.querySelector('#system-updates-apply')
	try {
		const st = await api.get('/api/system/update/status')
		if (logEl) {
			const lines = [`Phase: ${st.phase || '?'}`, ...(st.log || [])]
			if (st.error) lines.push(`ERROR: ${st.error}`)
			if (st.runningStamp) lines.push(`Running stamp: ${st.runningStamp}`)
			logEl.textContent = lines.join('\n')
		}
		if (!st.active) {
			stopApplyPoll()
			if (applyBtn) applyBtn.disabled = false
			if (st.ok) await refreshSystemUpdatesPanel(modal, { force: true })
		}
	} catch (e) {
		if (logEl) logEl.textContent = e?.message || String(e)
		stopApplyPoll()
	}
}

async function applySystemUpdate(modal, { getNuclearPassword }) {
	const applyBtn = modal.querySelector('#system-updates-apply')
	const logEl = modal.querySelector('#system-updates-log')
	if (
		!window.confirm(
			'Install the latest server release? HighAsCG will stop briefly, apply the update, stage drop-update/ on USB/bridge if mounted, then restart.',
		)
	) {
		return
	}
	if (applyBtn) applyBtn.disabled = true
	if (logEl) logEl.textContent = 'Starting update…'
	try {
		await api.post('/api/system/update/apply', {
			confirm: true,
			password: typeof getNuclearPassword === 'function' ? getNuclearPassword() : '',
		})
		startApplyPoll(modal)
	} catch (e) {
		if (logEl) logEl.textContent = e?.message || String(e)
		if (applyBtn) applyBtn.disabled = false
	}
}

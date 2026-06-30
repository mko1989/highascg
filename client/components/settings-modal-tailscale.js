/**
 * Settings → Tailscale (WO-91).
 */

import { api } from '../lib/api-client.js'
import { getNuclearPasswordFromModal } from '../lib/settings-nuclear-shared.js'

/**
 * @param {HTMLElement} modal
 */
export function wireTailscalePanel(modal) {
	const statusEl = modal.querySelector('#tailscale-status-line')
	const authUrlEl = modal.querySelector('#tailscale-auth-url')
	const authLink = modal.querySelector('#tailscale-auth-link')
	const ipv4El = modal.querySelector('#tailscale-ipv4')
	const hostnameEl = modal.querySelector('#tailscale-hostname')
	const daemonEl = modal.querySelector('#tailscale-daemon')
	const enabledCb = modal.querySelector('#tailscale-enabled')
	const autoLoginCb = modal.querySelector('#tailscale-auto-login')
	const acceptRoutesCb = modal.querySelector('#tailscale-accept-routes')
	const operatorAssistCb = modal.querySelector('#tailscale-operator-assist')
	const hostnameInput = modal.querySelector('#tailscale-hostname-input')
	const loginBtn = modal.querySelector('#tailscale-login')
	const operatorBtn = modal.querySelector('#tailscale-login-operator')
	const logoutBtn = modal.querySelector('#tailscale-logout')
	const copyBtn = modal.querySelector('#tailscale-copy-url')
	const savePrefsBtn = modal.querySelector('#tailscale-save-prefs')
	const adminLink = modal.querySelector('#tailscale-admin-link')

	/** @type {ReturnType<typeof setInterval> | null} */
	let pollTimer = null

	const getPassword = () => getNuclearPasswordFromModal(modal)

	async function apiGet(path) {
		return api.get(path)
	}

	async function apiPost(path, body = {}) {
		const payload = { ...body }
		const pw = getPassword()
		if (pw) payload.password = pw
		return api.post(path, payload)
	}

	function setStatus(msg) {
		if (statusEl) statusEl.textContent = msg || ''
	}

	function renderStatus(st) {
		if (!st) return
		if (ipv4El) ipv4El.textContent = st.ipv4 || '—'
		if (hostnameEl) hostnameEl.textContent = st.dnsName || st.hostname || '—'
		if (daemonEl) {
			const unit = st.daemon?.unit ? ` (${st.daemon.unit})` : ''
			daemonEl.textContent = `${st.daemon?.state || 'unknown'}${unit}`
		}
		if (enabledCb) enabledCb.checked = st.config?.enabled !== false
		if (autoLoginCb) autoLoginCb.checked = st.config?.autoLoginOnBoot === true
		if (acceptRoutesCb) acceptRoutesCb.checked = st.config?.acceptRoutes === true
		if (operatorAssistCb) operatorAssistCb.checked = st.config?.operatorLoginAssist !== false
		if (hostnameInput && document.activeElement !== hostnameInput) {
			hostnameInput.value = String(st.config?.hostname || '')
		}
		const authUrl = String(st.authUrl || '').trim()
		if (authUrlEl) {
			authUrlEl.textContent = authUrl || (st.connected ? '— (already connected)' : '—')
		}
		if (authLink) {
			authLink.href = authUrl || '#'
			authLink.style.display = authUrl ? '' : 'none'
		}
		if (copyBtn) {
			copyBtn.disabled = !authUrl
			copyBtn.title = authUrl ? 'Copy login URL to clipboard' : 'No login URL while connected'
		}
		if (adminLink) adminLink.href = st.adminUrl || 'https://login.tailscale.com/admin/machines'
		const summary = st.connected
			? `Connected (${st.backendState || 'Running'})`
			: st.needsLogin
				? `Login required (${st.backendState || 'NeedsLogin'})`
				: st.installed
					? `Not connected (${st.backendState || 'unknown'})`
					: 'Tailscale CLI not installed'
		setStatus(summary)
	}

	function stopPoll() {
		if (pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
	}

	function startPoll(untilMs = 120000) {
		stopPoll()
		const end = Date.now() + untilMs
		pollTimer = setInterval(async () => {
			try {
				const st = await apiGet('/api/network/tailscale/status')
				renderStatus(st)
				if (st.connected || Date.now() >= end) stopPoll()
			} catch {
				/* ignore poll errors */
			}
		}, 3000)
	}

	async function refresh() {
		try {
			const st = await apiGet('/api/network/tailscale/status')
			renderStatus(st)
		} catch (e) {
			setStatus(e?.message || String(e))
		}
	}

	enabledCb?.addEventListener('change', async () => {
		try {
			setStatus('Updating Tailscale service…')
			await apiPost('/api/network/tailscale/enable', { enabled: enabledCb.checked })
			await refresh()
		} catch (e) {
			setStatus(e?.message || String(e))
			await refresh()
		}
	})

	loginBtn?.addEventListener('click', async () => {
		try {
			setStatus('Starting Tailscale login…')
			const res = await apiPost('/api/network/tailscale/login')
			renderStatus(res.status || res)
			startPoll()
		} catch (e) {
			setStatus(e?.message || String(e))
		}
	})

	operatorBtn?.addEventListener('click', async () => {
		try {
			setStatus('Opening on operator monitor…')
			const res = await apiPost('/api/network/tailscale/login-operator-ui')
			renderStatus(res.status || res)
			if (res.authUrl) startPoll()
			if (res.spawned) {
				setStatus(res.note || (res.connected ? 'Opened Tailscale admin console on the operator monitor.' : 'Browser launched on :0 — complete login on the operator monitor.'))
			} else if (res.connected) {
				setStatus(res.note || 'Already connected to Tailscale.')
			} else {
				setStatus(res.note || 'Done.')
			}
		} catch (e) {
			setStatus(e?.message || String(e))
		}
	})

	logoutBtn?.addEventListener('click', async () => {
		if (!window.confirm('Log out of Tailscale on this machine?')) return
		try {
			setStatus('Logging out…')
			await apiPost('/api/network/tailscale/logout')
			await refresh()
		} catch (e) {
			setStatus(e?.message || String(e))
		}
	})

	copyBtn?.addEventListener('click', async () => {
		const url = String(authUrlEl?.textContent || '').trim()
		if (!url || url === '—' || url.startsWith('— (')) {
			setStatus('No login URL — already connected or login not started yet.')
			return
		}
		try {
			await navigator.clipboard.writeText(url)
			setStatus('Auth URL copied.')
		} catch {
			setStatus('Could not copy URL.')
		}
	})

	savePrefsBtn?.addEventListener('click', async () => {
		try {
			setStatus('Saving preferences…')
			await apiPost('/api/network/tailscale/prefs', {
				autoLoginOnBoot: !!autoLoginCb?.checked,
				acceptRoutes: !!acceptRoutesCb?.checked,
				operatorLoginAssist: operatorAssistCb?.checked !== false,
				hostname: hostnameInput?.value || '',
			})
			await refresh()
			setStatus('Preferences saved.')
		} catch (e) {
			setStatus(e?.message || String(e))
		}
	})

	modal.addEventListener('settings-tab-activated', (e) => {
		if (e.detail?.tab === 'tailscale') void refresh()
		else stopPoll()
	})

	void refresh()
}

/**
 * Server logs modal — HighAsCG in-memory buffer + Caspar log file tail.
 * Opened from the connection eye in the header.
 */

import { api } from '../lib/api-client.js'

const POLL_MS = 2000

/**
 * @param {HTMLElement} modal
 * @param {boolean} highOn
 * @param {boolean} casparOn
 */
function setToggleStyles(modal, highOn, casparOn) {
	const h = modal.querySelector('#logs-toggle-highascg')
	const c = modal.querySelector('#logs-toggle-caspar')
	if (h) {
		h.classList.toggle('logs-modal__toggle--on', highOn)
		h.setAttribute('aria-pressed', highOn ? 'true' : 'false')
	}
	if (c) {
		c.classList.toggle('logs-modal__toggle--on', casparOn)
		c.setAttribute('aria-pressed', casparOn ? 'true' : 'false')
	}
}

/**
 * Toggle: open on first click, close if already open.
 */
export function showLogsModal() {
	const existing = document.getElementById('logs-modal')
	if (existing) {
		existing.remove()
		return
	}

	let highOn = true
	let casparOn = true
	let paused = false
	let pollTimer = null

	const modal = document.createElement('div')
	modal.id = 'logs-modal'
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content logs-modal" role="dialog" aria-labelledby="logs-modal-title">
			<div class="modal-header">
				<h2 id="logs-modal-title">Server logs</h2>
				<button type="button" class="modal-close" id="logs-modal-close" aria-label="Close">&times;</button>
			</div>
			<div class="modal-body logs-modal__body">
				<p class="settings-note logs-modal__hint">Enable one or both sources below. <strong>HighAsCG</strong> = this Node process (in-memory buffer). <strong>CasparCG</strong> = log file on the Caspar host (default <code id="logs-caspar-path-hint">/opt/casparcg/log/caspar_YYYY-MM-DD.log</code>). Override with <code>CASPAR_LOG_PATH</code>. If you see HTTP 404, redeploy HighAsCG (needs <code>/api/logs</code>).</p>
				<div class="logs-modal__toolbar">
					<button type="button" class="btn btn--secondary logs-modal__toggle logs-modal__toggle--on" id="logs-toggle-highascg" aria-pressed="true">HighAsCG</button>
					<button type="button" class="btn btn--secondary logs-modal__toggle logs-modal__toggle--on" id="logs-toggle-caspar" aria-pressed="true">CasparCG</button>
					<label class="logs-modal__pause"><input type="checkbox" id="logs-pause" /> Pause updates</label>
					<button type="button" class="btn btn--secondary" id="logs-copy">Copy</button>
					<button type="button" class="btn btn--secondary" id="logs-clear-high">Clear HighAsCG buffer</button>
				</div>
				<pre class="logs-modal__pre" id="logs-pre"></pre>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const pre = modal.querySelector('#logs-pre')
	const pathHint = modal.querySelector('#logs-caspar-path-hint')
	const pauseInp = modal.querySelector('#logs-pause')

	function stopPoll() {
		if (pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
	}

	function schedulePoll() {
		stopPoll()
		pollTimer = setInterval(() => {
			if (!paused) void loadLogs()
		}, POLL_MS)
	}

	async function loadLogs() {
		if (!pre) return
		const params = new URLSearchParams()
		params.set('lines', '900')
		if (!highOn) params.set('highascg', '0')
		if (!casparOn) params.set('caspar', '0')
		try {
			const data = await api.get('/api/logs?' + params.toString())
			if (pathHint && data.casparPath) pathHint.textContent = data.casparPath

			const wasAtBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 48

			const parts = []
			if (highOn) {
				parts.push('── HighAsCG (this process) ──')
				if (data.highascg && data.highascg.length) parts.push(...data.highascg)
				else parts.push('(no lines yet — logging appears as the server runs)')
			}
			if (casparOn) {
				parts.push('')
				parts.push('── CasparCG (server log file) ──')
				if (data.caspar && data.caspar.length) parts.push(...data.caspar)
				else parts.push('(no lines or file missing)')
			}
			if (!highOn && !casparOn) {
				parts.length = 0
				parts.push('(enable at least one log source above)')
			}
			pre.textContent = parts.join('\n')

			if (wasAtBottom && !paused) pre.scrollTop = pre.scrollHeight
		} catch (e) {
			pre.textContent = 'Failed to load logs: ' + (e?.message || String(e))
		}
	}

	modal.querySelector('#logs-toggle-highascg')?.addEventListener('click', () => {
		highOn = !highOn
		setToggleStyles(modal, highOn, casparOn)
		void loadLogs()
	})
	modal.querySelector('#logs-toggle-caspar')?.addEventListener('click', () => {
		casparOn = !casparOn
		setToggleStyles(modal, highOn, casparOn)
		void loadLogs()
	})

	pauseInp?.addEventListener('change', () => {
		paused = !!pauseInp.checked
	})

	modal.querySelector('#logs-copy')?.addEventListener('click', async () => {
		const t = pre?.textContent || ''
		try {
			await navigator.clipboard.writeText(t)
		} catch {
			const ta = document.createElement('textarea')
			ta.value = t
			document.body.appendChild(ta)
			ta.select()
			document.execCommand('copy')
			ta.remove()
		}
	})

	modal.querySelector('#logs-clear-high')?.addEventListener('click', async () => {
		try {
			await api.post('/api/logs/clear', { target: 'highascg' })
			void loadLogs()
		} catch (e) {
			alert('Clear failed: ' + (e?.message || e))
		}
	})

	function close() {
		stopPoll()
		document.removeEventListener('keydown', onKey)
		modal.remove()
	}
	function onKey(e) {
		if (e.key === 'Escape') close()
	}
	document.addEventListener('keydown', onKey)

	modal.querySelector('#logs-modal-close')?.addEventListener('click', close)
	modal.addEventListener('click', (e) => {
		if (e.target === modal) close()
	})

	setToggleStyles(modal, highOn, casparOn)
	void loadLogs()
	schedulePoll()
}

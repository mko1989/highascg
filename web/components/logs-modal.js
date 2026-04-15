/**
 * Server logs modal — HighAsCG in-memory buffer + Caspar log file tail.
 * Opened from the connection eye in the header.
 * HighAsCG lines are pushed instantly via WebSocket (`log_line` events);
 * Caspar log is polled every 2 s (file tail, not WS).
 */

import { api } from '../lib/api-client.js'
import { ws } from '../app.js'

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
	let unsubWs = null

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
				<p class="settings-note logs-modal__hint">Enable one or both sources. <strong>HighAsCG</strong> = this Node process (AMCP commands + internal events, streamed live). <strong>CasparCG</strong> = log file on the Caspar host (default <code id="logs-caspar-path-hint">/opt/casparcg/log/caspar_YYYY-MM-DD.log</code>). Override with <code>CASPAR_LOG_PATH</code>.</p>
				<div class="logs-modal__toolbar">
					<button type="button" class="btn btn--secondary logs-modal__toggle logs-modal__toggle--on" id="logs-toggle-highascg" aria-pressed="true">HighAsCG</button>
					<button type="button" class="btn btn--secondary logs-modal__toggle logs-modal__toggle--on" id="logs-toggle-caspar" aria-pressed="true">CasparCG</button>
					<label class="logs-modal__pause"><input type="checkbox" id="logs-pause" /> Pause</label>
					<button type="button" class="btn btn--secondary" id="logs-copy">Copy</button>
					<button type="button" class="btn btn--secondary" id="logs-clear-high">Clear HighAsCG</button>
				</div>
				<div class="logs-modal__panes">
					<div class="logs-modal__pane" id="logs-pane-highascg">
						<div class="logs-modal__pane-header">
							HighAsCG
							<span class="logs-modal__live-badge" id="logs-live-badge">● LIVE</span>
						</div>
						<pre class="logs-modal__pre" id="logs-pre-highascg"></pre>
					</div>
					<div class="logs-modal__pane" id="logs-pane-caspar">
						<div class="logs-modal__pane-header">CasparCG</div>
						<pre class="logs-modal__pre" id="logs-pre-caspar"></pre>
					</div>
				</div>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const preHigh = modal.querySelector('#logs-pre-highascg')
	const preCaspar = modal.querySelector('#logs-pre-caspar')
	const pathHint = modal.querySelector('#logs-caspar-path-hint')
	const pauseInp = modal.querySelector('#logs-pause')
	const liveBadge = modal.querySelector('#logs-live-badge')
	const paneHigh = modal.querySelector('#logs-pane-highascg')
	const paneCaspar = modal.querySelector('#logs-pane-caspar')

	function syncPaneVisibility() {
		if (paneHigh) paneHigh.hidden = !highOn
		if (paneCaspar) paneCaspar.hidden = !casparOn
	}

	function isAtBottom(el) {
		return el ? el.scrollHeight - el.scrollTop - el.clientHeight < 48 : false
	}

	function scrollToBottom(el) {
		if (el) el.scrollTop = el.scrollHeight
	}

	// --- WebSocket live push (HighAsCG lines) ---

	function setupWsLivePush() {
		if (unsubWs) {
			unsubWs()
			unsubWs = null
		}
		if (!highOn) return
		unsubWs = ws.on('log_line', (line) => {
			if (paused || !preHigh || !highOn) return
			const atBottom = isAtBottom(preHigh)
			// Append the new line (trim leading newlines from blank first state)
			if (preHigh.textContent === '' || preHigh.textContent === '(loading…)') {
				preHigh.textContent = line
			} else {
				preHigh.textContent += '\n' + line
			}
			// Trim to ~2000 lines so the DOM doesn't grow unboundedly
			const text = preHigh.textContent
			const lines = text.split('\n')
			if (lines.length > 2000) {
				preHigh.textContent = lines.slice(-2000).join('\n')
			}
			if (atBottom) scrollToBottom(preHigh)
		})
		if (liveBadge) liveBadge.hidden = false
	}

	function teardownWsLivePush() {
		if (unsubWs) {
			unsubWs()
			unsubWs = null
		}
		if (liveBadge) liveBadge.hidden = true
	}

	// --- HTTP polling (initial load + Caspar tail) ---

	function stopPoll() {
		if (pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
	}

	function schedulePoll() {
		stopPoll()
		if (!casparOn) return
		pollTimer = setInterval(() => {
			if (!paused) void loadCasparLog()
		}, POLL_MS)
	}

	async function loadInitialHighas() {
		if (!preHigh || !highOn) return
		preHigh.textContent = '(loading…)'
		try {
			const data = await api.get('/api/logs?lines=500&caspar=0')
			if (preHigh.textContent === '(loading…)') {
				preHigh.textContent = (data.highascg && data.highascg.length)
					? data.highascg.join('\n')
					: '(no lines yet)'
			}
			scrollToBottom(preHigh)
		} catch (e) {
			if (preHigh.textContent === '(loading…)') {
				preHigh.textContent = 'Failed to load: ' + (e?.message || String(e))
			}
		}
	}

	async function loadCasparLog() {
		if (!preCaspar || !casparOn) return
		try {
			const data = await api.get('/api/logs?lines=500&highascg=0')
			if (pathHint && data.casparPath) pathHint.textContent = data.casparPath
			const atBottom = isAtBottom(preCaspar)
			preCaspar.textContent = (data.caspar && data.caspar.length)
				? data.caspar.join('\n')
				: '(no lines or file missing)'
			if (atBottom && !paused) scrollToBottom(preCaspar)
		} catch (e) {
			preCaspar.textContent = 'Failed to load: ' + (e?.message || String(e))
		}
	}

	// --- Event listeners ---

	modal.querySelector('#logs-toggle-highascg')?.addEventListener('click', () => {
		highOn = !highOn
		setToggleStyles(modal, highOn, casparOn)
		syncPaneVisibility()
		if (highOn) {
			setupWsLivePush()
			void loadInitialHighas()
		} else {
			teardownWsLivePush()
		}
	})

	modal.querySelector('#logs-toggle-caspar')?.addEventListener('click', () => {
		casparOn = !casparOn
		setToggleStyles(modal, highOn, casparOn)
		syncPaneVisibility()
		if (casparOn) {
			void loadCasparLog()
			schedulePoll()
		} else {
			stopPoll()
		}
	})

	pauseInp?.addEventListener('change', () => {
		paused = !!pauseInp.checked
	})

	modal.querySelector('#logs-copy')?.addEventListener('click', async () => {
		const parts = []
		if (highOn && preHigh) {
			parts.push('── HighAsCG ──')
			parts.push(preHigh.textContent)
		}
		if (casparOn && preCaspar) {
			parts.push('── CasparCG ──')
			parts.push(preCaspar.textContent)
		}
		const t = parts.join('\n')
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
			if (preHigh) preHigh.textContent = ''
		} catch (e) {
			alert('Clear failed: ' + (e?.message || e))
		}
	})

	function close() {
		stopPoll()
		teardownWsLivePush()
		modal.remove()
	}

	modal.querySelector('#logs-modal-close')?.addEventListener('click', close)

	// --- Init ---
	setToggleStyles(modal, highOn, casparOn)
	syncPaneVisibility()
	setupWsLivePush()
	void loadInitialHighas()
	void loadCasparLog()
	schedulePoll()
}

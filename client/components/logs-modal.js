/**
 * Server logs modal — HighAsCG in-memory buffer + Caspar log file tail.
 * Opened from the connection eye in the header.
 * HighAsCG lines are pushed instantly via WebSocket (`log_line` events);
 * Caspar log is polled every 2 s (file tail, not WS).
 */

import { api, getApiBase } from '../lib/api-client.js'
import { getAppWs } from '../lib/app-runtime.js'
import { settingsState } from '../lib/settings-state.js'
import {
	attachLogsCategoryFilter,
	buildLogsQuery,
	DEFAULT_CATEGORIES,
	DEFAULT_LEVELS,
	LOG_FILTER_ICON,
	matchesFilter,
	recordFromWsPayload,
} from './logs-modal-filter.js'
import {
	applyLogsPaneVisibility,
	downloadSupportBundleFromApi,
	parseMarkdownBasic,
	setLogsToggleStyles,
} from '../lib/logs-modal-shared.js'
import shortcutsMd from '../../shortcuts.md?raw'

/** @type {string} Module-level storage for last active tab (per session) */
let lastActiveTab = 'logs'

const POLL_MS = 2000

/**
 * @param {HTMLElement} modal
 * @param {boolean} highOn
 * @param {boolean} casparOn
 */
function setToggleStyles(modal, highOn, casparOn) {
	setLogsToggleStyles(modal, highOn, casparOn)
}

/** Close function of the currently open modal — the toggle-close path must run the SAME
 * teardown as the ✕ button; a bare `existing.remove()` here leaked the 2 s poll interval,
 * the `log_line` WS subscription and the filter cleanup on every eye-click close. */
let activeModalClose = null

/**
 * Toggle: open on first click, close if already open.
 */
export function showLogsModal() {
	const existing = document.getElementById('logs-modal')
	if (existing) {
		if (activeModalClose) activeModalClose()
		else existing.remove()
		return
	}

	let highOn = true
	let casparOn = true
	let paused = false
	let pollTimer = null
	let unsubWs = null
	let filterReloadTimer = null
	/** @type {Set<string>} */
	let activeCategories = new Set(DEFAULT_CATEGORIES)
	/** @type {Set<string>} */
	let activeLevels = new Set(DEFAULT_LEVELS)
	let categoryFilterCleanup = null

	const modal = document.createElement('div')
	modal.id = 'logs-modal'
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content logs-modal" role="dialog" aria-labelledby="logs-modal-title">
			<div class="modal-header">
				<h2 id="logs-modal-title" style="display:none;">Server logs</h2>
				<div class="logs-modal__tabs">
					<button type="button" class="logs-modal__tab logs-modal__tab--active" data-tab="logs">System Logs</button>
					<button type="button" class="logs-modal__tab" data-tab="shortcuts">Shortcuts</button>
				</div>
				<button type="button" class="modal-close" id="logs-modal-close" aria-label="Close">&times;</button>
			</div>
			<div class="modal-body logs-modal__body" id="logs-tab-logs">
				<p class="settings-note logs-modal__hint">Enable one or both sources. <strong>HighAsCG</strong> = this Node process (AMCP commands + internal events, streamed live). <strong>CasparCG</strong> = log file on the Caspar host (default <code id="logs-caspar-path-hint">/home/casparcg/highascg/log/caspar_YYYY-MM-DD.log</code>). Override with <code>CASPAR_LOG_PATH</code>.</p>
				<div class="logs-modal__toolbar">
					<button type="button" class="btn btn--secondary logs-modal__toggle logs-modal__toggle--on" id="logs-toggle-highascg" aria-pressed="true">HighAsCG</button>
					<button type="button" class="btn btn--secondary logs-modal__toggle logs-modal__toggle--on" id="logs-toggle-caspar" aria-pressed="true">CasparCG</button>
					<div class="logs-modal__cat-drop" id="logs-category-drop">
						<button
							type="button"
							class="btn btn--secondary logs-modal__filter-btn"
							id="logs-category-toggle"
							aria-expanded="false"
							aria-haspopup="listbox"
							aria-controls="logs-category-menu"
							aria-label="Filter log categories"
							title="Filter categories"
						>${LOG_FILTER_ICON}</button>
						<div class="logs-modal__cat-menu" id="logs-category-menu" hidden role="listbox" aria-multiselectable="true">
							<label class="logs-modal__cat-item logs-modal__cat-item--all">
								<input type="checkbox" id="logs-category-all" />
								<span id="logs-category-all-label">Enable all</span>
							</label>
							<div class="logs-modal__cat-menu-list" id="logs-category-list"></div>
						</div>
					</div>
					<label class="logs-modal__pause"><input type="checkbox" id="logs-pause" /> Pause</label>
					<button type="button" class="btn btn--secondary" id="logs-copy">Copy</button>
					<button type="button" class="btn btn--secondary" id="logs-clear-high">Clear HighAsCG</button>
					<button type="button" class="btn btn--secondary" id="logs-support-bundle">Support bundle</button>
				</div>
				<div class="logs-modal__filters" id="logs-filters">
					<div class="logs-modal__filters-row">
						<span class="logs-modal__filters-label">Level</span>
						<label class="logs-modal__level"><input type="checkbox" data-level="info" checked /> info</label>
						<label class="logs-modal__level"><input type="checkbox" data-level="warn" checked /> warn</label>
						<label class="logs-modal__level"><input type="checkbox" data-level="error" checked /> error</label>
						<label class="logs-modal__level"><input type="checkbox" data-level="debug" /> debug</label>
					</div>
				</div>
				<div class="logs-modal__panes" id="logs-panes">
					<p class="logs-modal__panes-empty" id="logs-panes-empty" hidden>Enable HighAsCG or CasparCG above to view logs.</p>
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
						<input type="text" class="logs-modal__amcp-input" id="logs-amcp-cmd" autocomplete="off" spellcheck="false" aria-label="Raw AMCP command" />
					</div>
				</div>
			</div>
			<div class="modal-body logs-modal__body logs-modal__shortcuts" id="logs-tab-shortcuts" hidden>
				${parseMarkdownBasic(shortcutsMd)}
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
	const panesEl = modal.querySelector('#logs-panes')
	const panesEmpty = modal.querySelector('#logs-panes-empty')
	const amcpInput = modal.querySelector('#logs-amcp-cmd')
	const categoryDrop = modal.querySelector('#logs-category-drop')
	const filtersEl = modal.querySelector('#logs-filters')
	const tabLogs = modal.querySelector('#logs-tab-logs')
	const tabShortcuts = modal.querySelector('#logs-tab-shortcuts')

	modal.querySelectorAll('.logs-modal__tab').forEach(btn => {
		btn.addEventListener('click', () => {
			modal.querySelectorAll('.logs-modal__tab').forEach(b => b.classList.remove('logs-modal__tab--active'))
			btn.classList.add('logs-modal__tab--active')
			const tabName = btn.dataset.tab
			lastActiveTab = tabName
			if (tabName === 'logs') {
				tabLogs.hidden = false
				tabShortcuts.hidden = true
				if (highOn && !paused) scrollToBottom(preHigh)
				if (casparOn && !paused) scrollToBottom(preCaspar)
			} else {
				tabLogs.hidden = true
				tabShortcuts.hidden = false
			}
		})
	})

	function casparAmcpTargetLabel() {
		const c = settingsState.getSettings()?.caspar || {}
		const host = String(c.host || '127.0.0.1').trim() || '127.0.0.1'
		const port = Math.max(1, parseInt(String(c.port ?? 5250), 10) || 5250)
		return `${host}:${port}`
	}

	if (amcpInput) {
		amcpInput.placeholder = `AMCP → ${casparAmcpTargetLabel()}`
		amcpInput.addEventListener('keydown', (e) => {
			if (e.key !== 'Enter') return
			e.preventDefault()
			void sendRawAmcpCommand()
		})
	}

	async function sendRawAmcpCommand() {
		if (!amcpInput || !preCaspar) return
		const cmd = amcpInput.value.trim()
		if (!cmd) return
		amcpInput.disabled = true
		const stamp = new Date().toISOString().slice(11, 19)
		const prefix = preCaspar.textContent && !/^\(/.test(preCaspar.textContent.trim())
			? preCaspar.textContent + '\n'
			: ''
		preCaspar.textContent = `${prefix}>> [${stamp}] ${cmd}`
		try {
			const res = await api.post('/api/raw', { cmd })
			let reply = ''
			if (res != null && res !== '') {
				reply = typeof res === 'string' ? res : JSON.stringify(res)
				reply = reply.trim()
			}
			if (reply) preCaspar.textContent += `\n<< ${reply.replace(/\r\n/g, '\n')}`
			amcpInput.value = ''
		} catch (err) {
			preCaspar.textContent += `\n!! ${err?.message || String(err)}`
		} finally {
			amcpInput.disabled = false
			amcpInput.focus()
			scrollToBottom(preCaspar)
		}
	}

	function syncPaneVisibility() {
		applyLogsPaneVisibility({
			paneHigh,
			paneCaspar,
			panesEmpty,
			panesEl,
			filtersEl,
			categoryDropEl: categoryDrop,
			highOn,
			casparOn,
		})
	}

	function isAtBottom(el) {
		return el ? el.scrollHeight - el.scrollTop - el.clientHeight < 48 : false
	}

	function scrollToBottom(el) {
		if (el) el.scrollTop = el.scrollHeight
	}

	function appendHighLine(line) {
		if (!preHigh || !line) return
		const atBottom = isAtBottom(preHigh)
		if (preHigh.textContent === '' || preHigh.textContent === '(loading…)') {
			preHigh.textContent = line
		} else {
			preHigh.textContent += '\n' + line
		}
		const text = preHigh.textContent
		const lines = text.split('\n')
		if (lines.length > 2000) preHigh.textContent = lines.slice(-2000).join('\n')
		if (atBottom) scrollToBottom(preHigh)
	}

	function setupWsLivePush() {
		if (unsubWs) {
			unsubWs()
			unsubWs = null
		}
		if (!highOn) return
		const ws = getAppWs()
		if (!ws) return
		unsubWs = ws.on('log_line', (payload) => {
			if (paused || !preHigh || !highOn) return
			const record = recordFromWsPayload(payload)
			if (!matchesFilter(record, activeCategories, activeLevels)) return
			appendHighLine(record?.line || String(payload))
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
		if (!activeCategories.size) {
			preHigh.textContent = '(no categories selected — open filter and choose categories)'
			return
		}
		preHigh.textContent = '(loading…)'
		try {
			const data = await api.get(buildLogsQuery(activeCategories, activeLevels, 500))
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

	function readLevelsFromUi() {
		/** @type {Set<string>} */
		const next = new Set()
		modal.querySelectorAll('.logs-modal__level input[data-level]').forEach((inp) => {
			if (inp.checked) {
				const level = inp.getAttribute('data-level')
				if (level) next.add(level)
			}
		})
		if (!next.size) next.add('error')
		activeLevels = next
	}

	function scheduleFilterReload() {
		if (filterReloadTimer) clearTimeout(filterReloadTimer)
		filterReloadTimer = setTimeout(() => {
			filterReloadTimer = null
			if (highOn) void loadInitialHighas()
		}, 150)
	}

	async function downloadSupportBundle() {
		const btn = modal.querySelector('#logs-support-bundle')
		if (btn) btn.disabled = true
		try {
			await downloadSupportBundleFromApi(getApiBase())
		} catch (e) {
			alert('Support bundle failed: ' + (e?.message || e))
		} finally {
			if (btn) btn.disabled = false
		}
	}

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

	modal.querySelectorAll('.logs-modal__level input[data-level]').forEach((inp) => {
		inp.addEventListener('change', () => {
			readLevelsFromUi()
			scheduleFilterReload()
		})
	})

	modal.querySelector('#logs-copy')?.addEventListener('click', async () => {
		const parts = []
		if (highOn && activeCategories.size) {
			parts.push(`── HighAsCG (categories: ${[...activeCategories].join(', ')}; levels: ${[...activeLevels].join(', ')}) ──`)
		}
		if (highOn && preHigh) parts.push(preHigh.textContent)
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

	modal.querySelector('#logs-support-bundle')?.addEventListener('click', () => {
		void downloadSupportBundle()
	})

	function close() {
		stopPoll()
		teardownWsLivePush()
		if (filterReloadTimer) clearTimeout(filterReloadTimer)
		if (categoryFilterCleanup) categoryFilterCleanup()
		modal.remove()
		activeModalClose = null
	}
	activeModalClose = close

	modal.querySelector('#logs-modal-close')?.addEventListener('click', close)

	categoryFilterCleanup = attachLogsCategoryFilter(modal, {
		activeCategories,
		onFilterChange: scheduleFilterReload,
	}).cleanup
	setToggleStyles(modal, highOn, casparOn)
	syncPaneVisibility()
	setupWsLivePush()
	void loadInitialHighas()
	void loadCasparLog()
	schedulePoll()

	// Activate the last-active tab
	const savedTabBtn = modal.querySelector(`[data-tab="${lastActiveTab}"]`)
	if (savedTabBtn) {
		modal.querySelectorAll('.logs-modal__tab').forEach(b => b.classList.remove('logs-modal__tab--active'))
		savedTabBtn.classList.add('logs-modal__tab--active')
		if (lastActiveTab === 'logs') {
			tabLogs.hidden = false
			tabShortcuts.hidden = true
		} else {
			tabLogs.hidden = true
			tabShortcuts.hidden = false
		}
	}
}

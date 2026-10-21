/**
 * LED wall test card — modal for grid parameters (template: led_grid_test.html).
 */

import { escapeHtml } from '../lib/dom-escape.js'
import { attachMathInput } from '../lib/math-input.js'
import { api } from '../lib/api-client.js'

/** Web modal defaults — the same as the node's (src/engine/led-test-card-control.js DEFAULTS). */
const DEFAULTS = Object.freeze({
	cols: 20,
	rows: 10,
	panelWidth: 192,
	panelHeight: 108,
	centerLabel: 'HighAsCG',
	showCenterCharacter: true,
	showPanelLabels: true,
	showSpecLine: true,
	showCircle: true,
	showCross: true,
	gridByChannel: {},
	channelsEnabled: {},
	pattern: 'grid-white',
	charCount: 3,
	builderSpeed: 3,
})

/** WO-629: the node owns these settings (GET/POST /api/led-test-card/settings); this is the last copy read. */
let cached = { ...DEFAULTS }

/** Re-read the settings from the node (header init, before the modal opens). */
export async function syncLedTestSettings() {
	const r = await api.get('/api/led-test-card/settings')
	if (r?.settings && typeof r.settings === 'object') cached = { ...DEFAULTS, ...r.settings }
	return r
}

function loadGridByChannel() {
	return { ...(cached.gridByChannel || {}) }
}

function loadChannelsEnabled() {
	return { ...(cached.channelsEnabled || {}) }
}

/**
 * @returns {{ cols: number, rows: number, panelWidth: number, panelHeight: number, centerLabel: string, showCenterCharacter: boolean, showPanelLabels: boolean, showSpecLine: boolean, showCircle: boolean, showCross: boolean, gridByChannel: Record<string, boolean>, channelsEnabled: Record<string, boolean>, pattern: string, charCount: number, builderSpeed: number }}
 */
export function getLedTestSettings() {
	return { ...cached, gridByChannel: loadGridByChannel(), channelsEnabled: loadChannelsEnabled() }
}

/**
 * Store in the node, which normalises the values and re-applies the card while it is up.
 * @param {ReturnType<typeof getLedTestSettings>} s
 */
export async function saveLedTestSettings(s) {
	cached = { ...cached, ...s }
	try {
		const r = await api.post('/api/led-test-card/settings', s)
		if (r?.settings && typeof r.settings === 'object') cached = { ...DEFAULTS, ...r.settings }
		return r
	} catch (e) {
		console.warn('LED test card: settings not saved —', e?.message || e)
		return null
	}
}

/**
 * @param {(event?: { type?: string, channel?: number, enabled?: boolean }) => void} [onApplied]
 * @param {import('../lib/state-store.js').StateStore} [stateStore]
 */
export function showLedTestModal(onApplied, stateStore) {
	const existing = document.getElementById('led-test-modal')
	if (existing) return

	const s = getLedTestSettings()
	const st = typeof stateStore?.getState === 'function' ? stateStore.getState() : {}
	const serverChannels = st?.configComparison?.serverChannels
	const channelsSorted = Array.isArray(serverChannels)
		? [...serverChannels].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
		: []

	function consumerHint(c) {
		const parts = []
		if (c.hasScreen) parts.push('Screen')
		if (c.hasDecklinkOutput) parts.push('DeckLink')
		return parts.length ? parts.join(' · ') : 'no screen / DeckLink'
	}

	const gridRows =
		channelsSorted.length > 0
			? channelsSorted
					.map(
						(c) =>
							`<label class="led-test-modal__grid-ch"><input type="checkbox" data-led-grid-ch="${c.index}" /> Full LED grid · ch ${c.index} <span class="led-test-modal__muted">${escapeHtml(consumerHint(c))}</span> <span class="led-test-modal__muted">${escapeHtml(c.videoMode || '')}</span></label>`
					)
					.join('')
			: '<p class="led-test-modal__muted">Connect to Caspar to list channels from INFO CONFIG.</p>'

	const showMap = loadChannelsEnabled(st)
	const showRows =
		channelsSorted.length > 0
			? channelsSorted
					.map(
						(c) =>
							`<label class="led-test-modal__grid-ch"><input type="checkbox" data-led-show-ch="${c.index}" /> Show test card · ch ${c.index} <span class="led-test-modal__muted">${escapeHtml(consumerHint(c))}</span> <span class="led-test-modal__muted">${escapeHtml(c.videoMode || '')}</span></label>`
					)
					.join('')
			: '<p class="led-test-modal__muted">Connect to Caspar to list channels from INFO CONFIG.</p>'

	const modal = document.createElement('div')
	modal.id = 'led-test-modal'
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content led-test-modal">
			<div class="modal-header">
				<h2>LED test card</h2>
				<button type="button" class="modal-close" id="led-test-close" aria-label="Close">&times;</button>
			</div>
			<div class="modal-body led-test-modal__body">
				<p class="led-test-modal__hint">Template <code>led_test_pattern</code> on layer <strong>999</strong>. Default view is <strong>screens</strong> (logo, Caspar resolution from INFO CONFIG, LAN IPs, circle + cross). Enable <strong>Full LED grid</strong> per Caspar channel when aligning a physical LED wall (including DeckLink-only outputs).</p>
				<div class="led-test-modal__section">
					<div class="led-test-modal__section-title">Enable test card (screens/pattern) on channel</div>
					<div class="led-test-modal__grid-ch-wrap">${showRows}</div>
				</div>
				<div class="led-test-modal__section">
					<div class="led-test-modal__section-title">Pattern & Overlays</div>
					<div class="led-test-modal__full">
						Pattern
						<select id="led-test-pattern" class="input-select">
							<option value="grid-white">Grid (White)</option>
							<option value="smpte-bars">SMPTE Color Bars</option>
							<option value="gradient-h">Gradient Horizontal</option>
							<option value="gradient-v">Gradient Vertical</option>
							<option value="checkerboard">Checkerboard</option>
							<option value="bouncing-element">Bouncing Character</option>
							<option value="led-builder">Animated: Bunny builds the wall</option>
							<option value="animated-radar">Animated: Radar Sweep</option>
							<option value="animated-stripes">Animated: Scrolling Stripes</option>
							<option value="animated-pulse">Animated: Expanding Pulse</option>
							<option value="animated-noise">Animated: TV Static</option>
							<option value="solid-red">Solid Red</option>
							<option value="solid-green">Solid Green</option>
							<option value="solid-blue">Solid Blue</option>
							<option value="solid-white">Solid White</option>
							<option value="solid-black">Solid Black</option>
						</select>
					</div>
					<div class="led-test-modal__checks led-test-modal__checks--inline">
						<label><input type="checkbox" id="led-test-circle" /> Circle</label>
						<label><input type="checkbox" id="led-test-cross" /> Crosshair</label>
					</div>
					<div class="led-test-modal__full" id="led-test-char-wrap" hidden>
						<label><span id="led-test-char-label">Bouncing HighAsCG characters</span> <input type="number" id="led-test-char-count" min="1" max="48" step="1" /></label>
					</div>
					<div class="led-test-modal__full" id="led-test-builder-speed-wrap" hidden>
						<label>Builder speed (1 slow – 10 fast) <input type="number" id="led-test-builder-speed" min="1" max="10" step="1" /></label>
					</div>
				</div>
				<div class="led-test-modal__section">
					<div class="led-test-modal__section-title">Full LED grid (per channel)</div>
					<div class="led-test-modal__grid-ch-wrap">${gridRows}</div>
				</div>
				<div class="led-test-modal__section">
					<div class="led-test-modal__section-title">Grid layout (when grid is on for that channel)</div>
					<div class="led-test-modal__grid">
						<label>Columns <input type="number" id="led-test-cols" min="1" max="256" step="1" /></label>
						<label>Rows <input type="number" id="led-test-rows" min="1" max="256" step="1" /></label>
						<label>Panel width (px) <input type="number" id="led-test-pw" min="1" max="16384" step="1" /></label>
						<label>Panel height (px) <input type="number" id="led-test-ph" min="1" max="16384" step="1" /></label>
					</div>
				</div>
				<label class="led-test-modal__full">Title (under character, grid mode) / brand (screens mode) <input type="text" id="led-test-label" /></label>
				<div class="led-test-modal__checks">
					<label><input type="checkbox" id="led-test-center-char" /> Show center character (graphic + title)</label>
					<label><input type="checkbox" id="led-test-panel-idx" /> Panel R×C labels (grid mode)</label>
					<label><input type="checkbox" id="led-test-spec" /> Resolution line (footer, grid mode)</label>
				</div>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const cols = modal.querySelector('#led-test-cols')
	const rows = modal.querySelector('#led-test-rows')
	const pw = modal.querySelector('#led-test-pw')
	const ph = modal.querySelector('#led-test-ph')
	const label = modal.querySelector('#led-test-label')
	const centerChar = modal.querySelector('#led-test-center-char')
	const panelIdx = modal.querySelector('#led-test-panel-idx')
	const spec = modal.querySelector('#led-test-spec')
	const circleCb = modal.querySelector('#led-test-circle')
	const crossCb = modal.querySelector('#led-test-cross')
	const patternSel = modal.querySelector('#led-test-pattern')
	const charWrap = modal.querySelector('#led-test-char-wrap')
	const charCountInp = modal.querySelector('#led-test-char-count')
	const charLabel = modal.querySelector('#led-test-char-label')
	const builderSpeedWrap = modal.querySelector('#led-test-builder-speed-wrap')
	const builderSpeedInp = modal.querySelector('#led-test-builder-speed')
	const builderOpt = patternSel.querySelector('option[value="led-builder"]')

	cols.value = String(s.cols)
	rows.value = String(s.rows)
	pw.value = String(s.panelWidth)
	ph.value = String(s.panelHeight)
	label.value = s.centerLabel
	centerChar.checked = s.showCenterCharacter !== false
	panelIdx.checked = s.showPanelLabels
	spec.checked = s.showSpecLine
	circleCb.checked = s.showCircle !== false
	crossCb.checked = s.showCross !== false
	patternSel.value = s.pattern || 'grid-white'
	charCountInp.value = String(s.charCount ?? 3)
	builderSpeedInp.value = String(s.builderSpeed ?? 3)

	function syncBouncingCharUi() {
		const builder = patternSel.value === 'led-builder'
		charWrap.hidden = !builder && patternSel.value !== 'bouncing-element'
		builderSpeedWrap.hidden = !builder
		charLabel.textContent = builder ? 'Builder bunnies' : 'Bouncing HighAsCG characters'
	}

	/* WO-588: the builder fills LED panels, so it is only offered while some channel has Full LED grid on. */
	function syncBuilderAvailability() {
		const anyGrid = Object.values(collectSettings().gridByChannel).some((v) => v === true)
		builderOpt.disabled = !anyGrid
		builderOpt.textContent = anyGrid ? 'Animated: Bunny builds the wall' : 'Animated: Bunny builds the wall (needs Full LED grid)'
		if (!anyGrid && patternSel.value === 'led-builder') {
			patternSel.value = 'grid-white'
			syncBouncingCharUi()
			saveLedTestSettings(collectSettings())
		}
	}

	patternSel.addEventListener('change', () => {
		syncBouncingCharUi()
		persistAndApply()
	})

	const gridMap = { ...s.gridByChannel }
	modal.querySelectorAll('[data-led-grid-ch]').forEach((inp) => {
		const ch = inp.getAttribute('data-led-grid-ch')
		if (ch != null) inp.checked = gridMap[ch] === true
	})
	syncBuilderAvailability()
	syncBouncingCharUi()

	modal.querySelectorAll('[data-led-show-ch]').forEach((inp) => {
		const ch = inp.getAttribute('data-led-show-ch')
		if (ch != null) inp.checked = showMap[ch] === true
	})

	function close() {
		if (settingsApplyTimer || labelDebounce) void saveLedTestSettings(collectSettings()) // flush a pending edit
		clearTimeout(settingsApplyTimer)
		clearTimeout(labelDebounce)
		modal.remove()
	}

	function collectSettings() {
		const nextGrid = { ...loadGridByChannel() }
		modal.querySelectorAll('[data-led-grid-ch]').forEach((inp) => {
			const ch = inp.getAttribute('data-led-grid-ch')
			if (ch != null) {
				if (inp.checked) nextGrid[ch] = true
				else delete nextGrid[ch]
			}
		})
		const nextShow = {}
		modal.querySelectorAll('[data-led-show-ch]').forEach((inp) => {
			const ch = inp.getAttribute('data-led-show-ch')
			if (ch != null) nextShow[ch] = inp.checked
		})
		return {
			cols: Math.max(1, parseInt(cols.value, 10) || 1),
			rows: Math.max(1, parseInt(rows.value, 10) || 1),
			panelWidth: Math.max(1, parseInt(pw.value, 10) || 1),
			panelHeight: Math.max(1, parseInt(ph.value, 10) || 1),
			centerLabel: (label.value || '').trim() || 'HighAsCG',
			showCenterCharacter: centerChar.checked,
			showPanelLabels: panelIdx.checked,
			showSpecLine: spec.checked,
			showCircle: circleCb.checked,
			showCross: crossCb.checked,
			gridByChannel: nextGrid,
			channelsEnabled: nextShow,
			pattern: patternSel.value,
			charCount: Math.max(1, Math.min(48, parseInt(charCountInp.value, 10) || 1)),
			builderSpeed: Math.max(1, Math.min(10, parseInt(builderSpeedInp.value, 10) || 3)),
		}
	}

	/* WO-629: a channel switch goes to POST /api/led-test-card/channel (the node remembers it); other edits are saved
	 * 400 ms after the last change and the node re-applies the card itself while it is up. */
	function persistAndApply(event) {
		if (event?.type === 'channel') {
			cached = { ...cached, channelsEnabled: collectSettings().channelsEnabled }
			if (typeof onApplied === 'function') onApplied(event)
			return
		}
		scheduleSettingsApply()
	}

	let settingsApplyTimer = null
	function scheduleSettingsApply() {
		clearTimeout(settingsApplyTimer)
		settingsApplyTimer = setTimeout(() => {
			settingsApplyTimer = null
			void saveLedTestSettings(collectSettings()).then(() => {
				if (typeof onApplied === 'function') onApplied()
			})
		}, 400)
	}

	let labelDebounce = null
	function persistAndApplyDebounced() {
		clearTimeout(labelDebounce)
		labelDebounce = setTimeout(() => {
			labelDebounce = null
			persistAndApply()
		}, 300)
	}

	for (const el of [cols, rows, pw, ph, charCountInp, builderSpeedInp]) {
		el.addEventListener('change', () => persistAndApply())
		attachMathInput(el, { decimals: 0 })
	}
	label.addEventListener('input', persistAndApplyDebounced)
	label.addEventListener('change', () => persistAndApply())

	for (const el of [centerChar, panelIdx, spec, circleCb, crossCb]) {
		el.addEventListener('change', () => persistAndApply())
	}

	modal.querySelectorAll('[data-led-grid-ch]').forEach((inp) => {
		inp.addEventListener('change', () => {
			syncBuilderAvailability()
			persistAndApply()
		})
	})

	modal.querySelectorAll('[data-led-show-ch]').forEach((inp) => {
		inp.addEventListener('change', () => {
			const ch = parseInt(inp.getAttribute('data-led-show-ch') || '', 10)
			persistAndApply(
				Number.isFinite(ch) && ch > 0 ? { type: 'channel', channel: ch, enabled: inp.checked } : undefined,
			)
		})
	})

	modal.querySelector('#led-test-close').addEventListener('click', close)
	modal.addEventListener('click', (e) => {
		if (e.target === modal) close()
	})
}

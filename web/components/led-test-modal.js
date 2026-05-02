/**
 * LED wall test card — modal for grid parameters (template: led_grid_test.html).
 */

const LS = {
	cols: 'highascg_led_test_cols',
	rows: 'highascg_led_test_rows',
	pw: 'highascg_led_test_pw',
	ph: 'highascg_led_test_ph',
	label: 'highascg_led_test_label',
	centerChar: 'highascg_led_test_center_char',
	labelOn: 'highascg_led_test_label_on',
	specOn: 'highascg_led_test_spec_on',
	circle: 'highascg_led_test_show_circle',
	cross: 'highascg_led_test_show_cross',
	gridByCh: 'highascg_led_test_grid_by_ch',
	pattern: 'highascg_led_test_pattern',
}

function loadGridByChannel() {
	try {
		const raw = localStorage.getItem(LS.gridByCh)
		if (!raw) return {}
		const o = JSON.parse(raw)
		return o && typeof o === 'object' ? o : {}
	} catch {
		return {}
	}
}

/**
 * @returns {{ cols: number, rows: number, panelWidth: number, panelHeight: number, centerLabel: string, showCenterCharacter: boolean, showPanelLabels: boolean, showSpecLine: boolean, showCircle: boolean, showCross: boolean, gridByChannel: Record<string, boolean> }}
 */
export function getLedTestSettings() {
	return {
		cols: Math.max(1, parseInt(localStorage.getItem(LS.cols) || '20', 10) || 20),
		rows: Math.max(1, parseInt(localStorage.getItem(LS.rows) || '10', 10) || 10),
		panelWidth: Math.max(1, parseInt(localStorage.getItem(LS.pw) || '192', 10) || 192),
		panelHeight: Math.max(1, parseInt(localStorage.getItem(LS.ph) || '108', 10) || 108),
		centerLabel: localStorage.getItem(LS.label) || 'HighAsCG',
		showCenterCharacter: localStorage.getItem(LS.centerChar) !== 'false',
		showPanelLabels: localStorage.getItem(LS.labelOn) !== 'false',
		showSpecLine: localStorage.getItem(LS.specOn) !== 'false',
		showCircle: localStorage.getItem(LS.circle) !== 'false',
		showCross: localStorage.getItem(LS.cross) !== 'false',
		gridByChannel: loadGridByChannel(),
		pattern: localStorage.getItem(LS.pattern) || 'grid-white',
	}
}

/**
 * @param {ReturnType<typeof getLedTestSettings>} s
 */
export function saveLedTestSettings(s) {
	localStorage.setItem(LS.cols, String(s.cols))
	localStorage.setItem(LS.rows, String(s.rows))
	localStorage.setItem(LS.pw, String(s.panelWidth))
	localStorage.setItem(LS.ph, String(s.panelHeight))
	localStorage.setItem(LS.label, s.centerLabel || 'HighAsCG')
	localStorage.setItem(LS.centerChar, s.showCenterCharacter !== false ? 'true' : 'false')
	localStorage.setItem(LS.labelOn, s.showPanelLabels ? 'true' : 'false')
	localStorage.setItem(LS.specOn, s.showSpecLine ? 'true' : 'false')
	localStorage.setItem(LS.circle, s.showCircle !== false ? 'true' : 'false')
	localStorage.setItem(LS.cross, s.showCross !== false ? 'true' : 'false')
	if (s.gridByChannel && typeof s.gridByChannel === 'object') {
		localStorage.setItem(LS.gridByCh, JSON.stringify(s.gridByChannel))
	}
	localStorage.setItem(LS.pattern, s.pattern || 'grid-white')
}

/**
 * @param {number} channel
 */
export function getLedTestShowGridForChannel(channel) {
	const m = loadGridByChannel()
	return m[String(channel)] === true
}

/**
 * @param {() => void} [onApplied]
 * @param {import('../lib/state-store.js').StateStore} [stateStore]
 */
export function showLedTestModal(onApplied, stateStore) {
	const existing = document.getElementById('led-test-modal')
	if (existing) return

	const s = getLedTestSettings()
	const st = typeof stateStore?.getState === 'function' ? stateStore.getState() : {}
	const serverChannels = st?.configComparison?.serverChannels
	const screenChannels = Array.isArray(serverChannels) ? serverChannels.filter((c) => c.hasScreen) : []

	const gridRows =
		screenChannels.length > 0
			? screenChannels
					.map(
						(c) =>
							`<label class="led-test-modal__grid-ch"><input type="checkbox" data-led-grid-ch="${c.index}" /> Full LED grid · ch ${c.index} <span class="led-test-modal__muted">${escapeHtml(c.videoMode || '')}</span></label>`
					)
					.join('')
			: '<p class="led-test-modal__muted">Connect to Caspar to list screen channels from INFO CONFIG.</p>'

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
				<p class="led-test-modal__hint">Template <code>led_grid_test</code> on layer <strong>999</strong>. Default view is <strong>screens</strong> (logo, Caspar resolution from INFO CONFIG, LAN IPs, circle + cross). Enable <strong>Full LED grid</strong> per output channel only when aligning a physical LED wall.</p>
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
				<div class="led-test-modal__actions">
					<button type="button" class="btn btn--secondary" id="led-test-cancel">Cancel</button>
					<button type="button" class="btn" id="led-test-save">Save</button>
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

	const gridMap = { ...s.gridByChannel }
	modal.querySelectorAll('[data-led-grid-ch]').forEach((inp) => {
		const ch = inp.getAttribute('data-led-grid-ch')
		if (ch != null) inp.checked = gridMap[ch] === true
	})

	function close() {
		modal.remove()
	}

	function save() {
		const nextGrid = { ...loadGridByChannel() }
		modal.querySelectorAll('[data-led-grid-ch]').forEach((inp) => {
			const ch = inp.getAttribute('data-led-grid-ch')
			if (ch != null) {
				if (inp.checked) nextGrid[ch] = true
				else delete nextGrid[ch]
			}
		})
		const next = {
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
			pattern: patternSel.value,
		}
		saveLedTestSettings(next)
		close()
		if (typeof onApplied === 'function') onApplied()
	}

	modal.querySelector('#led-test-close').addEventListener('click', close)
	modal.querySelector('#led-test-cancel').addEventListener('click', close)
	modal.querySelector('#led-test-save').addEventListener('click', save)
	modal.addEventListener('click', (e) => {
		if (e.target === modal) close()
	})
}

function escapeHtml(s) {
	return String(s || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

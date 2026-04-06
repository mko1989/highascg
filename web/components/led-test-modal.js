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
}

/**
 * @returns {{ cols: number, rows: number, panelWidth: number, panelHeight: number, centerLabel: string, showCenterCharacter: boolean, showPanelLabels: boolean, showSpecLine: boolean }}
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
}

/**
 * @param {() => void} [onApplied] — after Save (settings persisted)
 */
export function showLedTestModal(onApplied) {
	const existing = document.getElementById('led-test-modal')
	if (existing) return

	const s = getLedTestSettings()
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
				<p class="led-test-modal__hint">Template <code>led_grid_test</code> on PGM layer 999 (above timeline layers 10+). Center uses the same eye blink as the app (<code>both_open.svg</code> …). Total size = columns×rows × panel size.</p>
				<div class="led-test-modal__grid">
					<label>Columns <input type="number" id="led-test-cols" min="1" max="256" step="1" /></label>
					<label>Rows <input type="number" id="led-test-rows" min="1" max="256" step="1" /></label>
					<label>Panel width (px) <input type="number" id="led-test-pw" min="1" max="16384" step="1" /></label>
					<label>Panel height (px) <input type="number" id="led-test-ph" min="1" max="16384" step="1" /></label>
				</div>
				<label class="led-test-modal__full">Center label (under eyes) <input type="text" id="led-test-label" /></label>
				<div class="led-test-modal__checks">
					<label><input type="checkbox" id="led-test-center-char" /> Show center character (eyes + label)</label>
					<label><input type="checkbox" id="led-test-panel-idx" /> Panel R×C labels</label>
					<label><input type="checkbox" id="led-test-spec" /> Resolution line</label>
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

	cols.value = String(s.cols)
	rows.value = String(s.rows)
	pw.value = String(s.panelWidth)
	ph.value = String(s.panelHeight)
	label.value = s.centerLabel
	centerChar.checked = s.showCenterCharacter !== false
	panelIdx.checked = s.showPanelLabels
	spec.checked = s.showSpecLine

	function close() {
		modal.remove()
	}

	function save() {
		const next = {
			cols: Math.max(1, parseInt(cols.value, 10) || 1),
			rows: Math.max(1, parseInt(rows.value, 10) || 1),
			panelWidth: Math.max(1, parseInt(pw.value, 10) || 1),
			panelHeight: Math.max(1, parseInt(ph.value, 10) || 1),
			centerLabel: (label.value || '').trim() || 'HighAsCG',
			showCenterCharacter: centerChar.checked,
			showPanelLabels: panelIdx.checked,
			showSpecLine: spec.checked,
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

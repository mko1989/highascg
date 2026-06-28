/**
 * CasparCG config editor — preview generated XML; one-shot Apply & restart (no saved override).
 */
import { getGeneratedCasparConfig, applyCasparConfig } from './device-view-actions.js'

/**
 * @param {{ onApplied?: () => void|Promise<void> }} [opts]
 */
export async function showCasparConfigModal(opts = {}) {
	if (document.getElementById('caspar-config-modal')) return

	const modal = document.createElement('div')
	modal.id = 'caspar-config-modal'
	modal.className = 'modal-overlay'

	modal.innerHTML = `
		<div class="modal-shell caspar-config-modal">
			<div class="modal-header">
				<div class="modal-header__title">
					<h2>Caspar config</h2>
					<p class="caspar-config-modal__subtitle">Generated proposal from Device View — advanced / dev only</p>
				</div>
				<button type="button" class="modal-close" id="caspar-config-close" aria-label="Close">×</button>
			</div>
			<div class="modal-body caspar-config-modal__body">
				<p class="caspar-config-modal__hint">Preview matches what <strong>Apply Caspar config</strong> would write. Close without applying leaves the server unchanged.</p>
				<div class="caspar-config-modal__toolbar">
					<button type="button" class="btn btn--secondary" id="caspar-config-edit" title="Enable editing">✏️ Edit</button>
					<button type="button" class="btn btn--secondary" id="caspar-config-reset" title="Reload generated proposal" hidden>↻ Reset to proposal</button>
				</div>
				<div class="caspar-config-modal__editor-wrap">
					<textarea id="caspar-config-textarea" class="caspar-config-modal__textarea" spellcheck="false" readonly></textarea>
				</div>
				<div id="caspar-config-status" class="caspar-config-modal__status"></div>
			</div>
			<div class="caspar-config-modal__footer">
				<span id="caspar-config-mode-label" class="caspar-config-modal__mode-label">View only</span>
				<div class="caspar-config-modal__footer-right">
					<button type="button" class="btn btn--secondary" id="caspar-config-cancel">Close</button>
					<button type="button" class="btn btn--primary" id="caspar-config-apply" disabled title="Apply edited XML and restart Caspar">Apply &amp; restart</button>
				</div>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const textarea = modal.querySelector('#caspar-config-textarea')
	const statusEl = modal.querySelector('#caspar-config-status')
	const editBtn = modal.querySelector('#caspar-config-edit')
	const resetBtn = modal.querySelector('#caspar-config-reset')
	const applyBtn = modal.querySelector('#caspar-config-apply')
	const cancelBtn = modal.querySelector('#caspar-config-cancel')
	const closeBtn = modal.querySelector('#caspar-config-close')
	const modeLabel = modal.querySelector('#caspar-config-mode-label')

	let proposalXml = ''
	let editing = false

	function isDirty() {
		return editing && textarea.value !== proposalXml
	}

	function syncEditUi() {
		textarea.readOnly = !editing
		textarea.classList.toggle('caspar-config-modal__textarea--readonly', !editing)
		editBtn.hidden = editing
		resetBtn.hidden = !editing
		applyBtn.disabled = !editing
		modeLabel.textContent = editing ? (isDirty() ? 'Editing (unsaved)' : 'Editing') : 'View only'
	}

	async function loadProposal() {
		statusEl.textContent = 'Loading generated proposal…'
		statusEl.classList.remove('caspar-config-modal__status--error')
		try {
			proposalXml = await getGeneratedCasparConfig(false)
			textarea.value = proposalXml
			statusEl.textContent = ''
			syncEditUi()
		} catch (e) {
			statusEl.textContent = `Error: ${e?.message || e}`
			statusEl.classList.add('caspar-config-modal__status--error')
		}
	}

	function tryClose() {
		if (isDirty()) {
			if (!confirm('Discard your edits? Nothing will be applied to Caspar.')) return
		}
		modal.remove()
	}

	editBtn.onclick = () => {
		editing = true
		syncEditUi()
		textarea.focus()
	}

	resetBtn.onclick = () => {
		if (isDirty() && !confirm('Reset to the latest generated proposal? Your edits will be lost.')) return
		textarea.value = proposalXml
		statusEl.textContent = ''
		syncEditUi()
	}

	textarea.addEventListener('input', () => syncEditUi())

	cancelBtn.onclick = tryClose
	closeBtn.onclick = tryClose
	modal.addEventListener('click', (e) => {
		if (e.target === modal) tryClose()
	})
	document.addEventListener('keydown', function onKey(e) {
		if (e.key === 'Escape') {
			tryClose()
			document.removeEventListener('keydown', onKey)
		}
	})

	applyBtn.onclick = async () => {
		const val = textarea.value.trim()
		if (!val) {
			statusEl.textContent = 'Config cannot be empty.'
			statusEl.classList.add('caspar-config-modal__status--error')
			return
		}
		if (
			val !== proposalXml &&
			!confirm('Apply this XML to casparcg.config and restart Caspar? This does not change Device View wiring.')
		) {
			return
		}
		applyBtn.disabled = true
		statusEl.textContent = 'Applying and restarting Caspar…'
		statusEl.classList.remove('caspar-config-modal__status--error')
		try {
			const r = await applyCasparConfig({ xml: val })
			statusEl.textContent = r?.message || 'Applied.'
			if (typeof opts.onApplied === 'function') await opts.onApplied()
			setTimeout(() => modal.remove(), 600)
		} catch (e) {
			statusEl.textContent = `Apply failed: ${e?.message || e}`
			statusEl.classList.add('caspar-config-modal__status--error')
			applyBtn.disabled = false
		}
	}

	await loadProposal()
}

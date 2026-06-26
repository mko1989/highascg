/**
 * CasparCG Config Edit Modal.
 */
import { getGeneratedCasparConfig, saveCasparConfigOverride, getCasparConfigOverride } from './device-view-actions.js'

export async function showCasparConfigModal() {
	if (document.getElementById('caspar-config-modal')) return
	
	const modal = document.createElement('div')
	modal.id = 'caspar-config-modal'
	modal.className = 'modal-overlay'
	
	modal.innerHTML = `
		<div class="modal-shell caspar-config-modal">
			<div class="modal-header">
				<div class="modal-header__title">
					<h2>CasparCG Config</h2>
				</div>
				<div style="display:flex;gap:6px;align-items:center">
					<button type="button" class="btn btn--secondary" id="caspar-config-revert" title="Revert to generated config">↻ Revert</button>
					<button type="button" class="btn btn--primary" id="caspar-config-save" title="Save override">💾 Save</button>
					<button type="button" class="modal-close" id="caspar-config-close" aria-label="Close">×</button>
				</div>
			</div>
			<div class="modal-body caspar-config-modal__body">
				<div class="caspar-config-modal__editor-wrap">
					<textarea id="caspar-config-textarea" class="caspar-config-modal__textarea" spellcheck="false"></textarea>
				</div>
				<div id="caspar-config-status" class="caspar-config-modal__status"></div>
			</div>
		</div>
	`
	document.body.appendChild(modal)
	
	const textarea = modal.querySelector('#caspar-config-textarea')
	const statusEl = modal.querySelector('#caspar-config-status')
	const saveBtn = modal.querySelector('#caspar-config-save')
	const revertBtn = modal.querySelector('#caspar-config-revert')
	const closeBtn = modal.querySelector('#caspar-config-close')
	
	let originalGenerated = ''
	
	async function load() {
		statusEl.textContent = 'Loading...'
		try {
			const [resOverride, resGenerated] = await Promise.all([
				getCasparConfigOverride(),
				getGeneratedCasparConfig(false)
			])
			originalGenerated = resGenerated
			textarea.value = resOverride.override || resGenerated
			statusEl.textContent = resOverride.override ? 'Manual override active' : ''
			statusEl.classList.toggle('caspar-config-modal__status--override', !!resOverride.override)
		} catch (e) {
			statusEl.textContent = 'Error: ' + e.message
		}
	}
	
	const close = () => modal.remove()
	
	closeBtn.onclick = close
	modal.addEventListener('click', (e) => { if (e.target === modal) close() })
	document.addEventListener('keydown', function onKey(e) {
		if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey) }
	})
	
	saveBtn.onclick = async () => {
		const val = textarea.value.trim()
		if (!val) { statusEl.textContent = 'Config cannot be empty.'; return }
		saveBtn.disabled = true
		statusEl.textContent = 'Saving...'
		try {
			await saveCasparConfigOverride(val)
			statusEl.textContent = 'Override saved.'
			statusEl.classList.add('caspar-config-modal__status--override')
			setTimeout(close, 800)
		} catch (e) {
			statusEl.textContent = 'Save failed: ' + e.message
			saveBtn.disabled = false
		}
	}
	
	revertBtn.onclick = async () => {
		if (!confirm('Revert to generated config? This will delete your manual edits.')) return
		textarea.value = originalGenerated
		statusEl.textContent = 'Reverting...'
		try {
			await saveCasparConfigOverride('')
			statusEl.textContent = 'Using generated config.'
			statusEl.classList.remove('caspar-config-modal__status--override')
			setTimeout(close, 800)
		} catch (e) {
			statusEl.textContent = 'Revert failed: ' + e.message
		}
	}
	
	void load()
}

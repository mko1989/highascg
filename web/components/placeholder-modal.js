/**
 * Modal: Add or edit a placeholder media asset.
 */

import { PLACEHOLDER_TEMPLATES } from '../lib/placeholder-state.js'

export function showPlaceholderModal(options = {}) {
	const existing = document.getElementById('placeholder-modal')
	if (existing) {
		existing.remove()
		return
	}

	const modal = document.createElement('div')
	modal.id = 'placeholder-modal'
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content placeholder-modal" role="dialog" aria-labelledby="placeholder-modal-title">
			<div class="modal-header">
				<h2 id="placeholder-modal-title">Add Placeholder</h2>
				<button type="button" class="modal-close" id="placeholder-close" aria-label="Close">&times;</button>
			</div>
			<div class="modal-body">
				<div class="settings-group">
					<label>Label</label>
					<input type="text" id="ph-label" placeholder="e.g. PLC_PGM1_GRID" style="width:100%" />
				</div>
				<div class="settings-group">
					<label>Template</label>
					<select id="ph-template" style="width:100%">
						${PLACEHOLDER_TEMPLATES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}
					</select>
					<p class="settings-note" id="ph-template-desc" style="margin-top:4px"></p>
				</div>
				<div class="settings-group">
					<label>Resolution</label>
					<select id="ph-resolution" style="width:100%">
						<option value="1080p5000">1080p50</option>
						<option value="1080p6000">1080p60</option>
						<option value="2160p5000">4K 50p</option>
						<option value="2160p6000">4K 60p</option>
						<option value="720p5000">720p50</option>
					</select>
				</div>
				<div class="settings-group" id="ph-color-group" style="display:none">
					<label>Fill Color</label>
					<input type="color" id="ph-color" value="#3b82f6" style="width:100%;height:38px;padding:2px" />
				</div>
				<div class="settings-group" style="display:none">
					<label>Duration (seconds)</label>
					<input type="number" id="ph-duration" min="1" max="3600" value="60" style="width:100%" />
				</div>
				<div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:1rem">
					<button type="button" class="btn btn--secondary" id="ph-cancel">Cancel</button>
					<button type="button" class="btn btn--primary" id="ph-save">Save Placeholder</button>
				</div>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const templateSel = modal.querySelector('#ph-template')
	const descEl = modal.querySelector('#ph-template-desc')
	const colorGrp = modal.querySelector('#ph-color-group')
	const updateDesc = () => {
		const tid = templateSel.value
		const t = PLACEHOLDER_TEMPLATES.find(x => x.id === tid)
		if (descEl) descEl.textContent = t ? t.description : ''
		if (colorGrp) colorGrp.style.display = tid === 'solid' ? 'block' : 'none'
	}
	templateSel.addEventListener('change', updateDesc)
	updateDesc()

	function close() {
		document.removeEventListener('keydown', onKey)
		modal.remove()
	}
	function onKey(e) {
		if (e.key === 'Escape') close()
	}
	document.addEventListener('keydown', onKey)

	modal.querySelector('#placeholder-close').onclick = close
	modal.querySelector('#ph-cancel').onclick = close
	modal.querySelector('#ph-save').onclick = () => {
		const label = modal.querySelector('#ph-label').value.trim()
		const template = templateSel.value
		const resolution = modal.querySelector('#ph-resolution').value
		const durationSec = parseInt(modal.querySelector('#ph-duration').value, 10) || 60
		const color = modal.querySelector('#ph-color').value
		
		const newItem = window.placeholderState.add({
			label,
			template,
			resolution,
			durationMs: durationSec * 1000,
			value: template === 'solid' ? color : undefined
		})
		
		if (options.onAdded) options.onAdded(newItem)
		close()
	}
}

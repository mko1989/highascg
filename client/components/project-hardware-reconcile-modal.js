/**
 * Hardware reconcile modal when project routing does not match the live machine.
 */
import { openLoadDeviceSnapshotModal } from './device-view-snapshot-modals.js'
import { setHardwarePolicy } from '../lib/project-hardware-policy.js'
import { escapeHtml } from '../lib/dom-escape.js'

/**
 * @typedef {'apply_saved' | 'keep_live' | 'device_view' | 'load_snapshot' | 'cancel'} ReconcileChoice
 */

/**
 * @param {{
 *   project: object,
 *   report: { severity: string, items: Array<{ section: string, message: string, severity: string }>, sameMachine: boolean },
 *   liveCtx?: object|null,
 *   showToast?: (msg: string, type?: string) => void,
 * }} opts
 * @returns {Promise<ReconcileChoice>}
 */
export function showProjectHardwareReconcileModal(opts) {
	return new Promise((resolve) => {
		if (document.getElementById('project-hardware-reconcile-modal')) {
			resolve('cancel')
			return
		}

		const { project, report, showToast } = opts
		const projectName = project?.name || 'This project'
		const defaultApply = report.sameMachine

		const modal = document.createElement('div')
		modal.id = 'project-hardware-reconcile-modal'
		modal.className = 'modal-overlay hardware-reconcile-modal-overlay'
		modal.innerHTML = `
			<div class="modal-content hardware-reconcile-modal">
				<div class="modal-header">
					<h2>Hardware does not match this project</h2>
					<button type="button" class="modal-close" id="hw-reconcile-close" aria-label="Close">&times;</button>
				</div>
				<div class="modal-body">
					<p class="hardware-reconcile-modal__lead">
						<strong>${escapeHtml(projectName)}</strong> includes Device View cabling, screen destinations, and Caspar screen settings.
						${report.sameMachine ? 'The active hardware configuration on this machine differs from what was saved.' : 'This machine differs from what was saved.'}
					</p>
					<ul class="hardware-reconcile-modal__diff" id="hw-reconcile-diff"></ul>
					<label class="hardware-reconcile-modal__remember">
						<input type="checkbox" id="hw-reconcile-remember" />
						Remember my choice for future loads
					</label>
					<select id="hw-reconcile-policy" class="hardware-reconcile-modal__policy" hidden>
						<option value="ask">Ask every time</option>
						<option value="apply_saved">Always apply project hardware</option>
						<option value="keep_live">Always keep live hardware (looks only)</option>
					</select>
					<p class="hardware-reconcile-modal__footer-note">
						After applying project hardware: verify Device View, OS layout, Caspar config, and restart Caspar if prompted.
					</p>
				</div>
				<div class="modal-footer hardware-reconcile-modal__actions">
					<button type="button" class="btn btn--secondary" id="hw-reconcile-device-view">Open Device View</button>
					<button type="button" class="btn btn--secondary" id="hw-reconcile-snapshot">Load device snapshot…</button>
					<button type="button" class="btn btn--secondary" id="hw-reconcile-keep"${defaultApply ? '' : ' data-primary="1"'}">Keep live hardware</button>
					<button type="button" class="btn btn--primary" id="hw-reconcile-apply"${defaultApply ? ' data-primary="1"' : ''}>Apply project hardware</button>
				</div>
			</div>
		`
		document.body.appendChild(modal)

		const diffEl = modal.querySelector('#hw-reconcile-diff')
		const items = report.items?.length
			? report.items
			: [{ section: 'Hardware', message: 'Saved routing differs from the live machine.', severity: 'soft' }]
		for (const it of items.slice(0, 12)) {
			const li = document.createElement('li')
			li.className = `hardware-reconcile-modal__diff-item hardware-reconcile-modal__diff-item--${it.severity}`
			li.innerHTML = `<strong>${escapeHtml(it.section)}</strong> — ${escapeHtml(it.message)}`
			diffEl?.appendChild(li)
		}
		if (items.length > 12) {
			const more = document.createElement('li')
			more.className = 'hardware-reconcile-modal__diff-item hardware-reconcile-modal__diff-item--soft'
			more.textContent = `…and ${items.length - 12} more difference(s).`
			diffEl?.appendChild(more)
		}

		const rememberEl = modal.querySelector('#hw-reconcile-remember')
		const policyEl = modal.querySelector('#hw-reconcile-policy')
		rememberEl?.addEventListener('change', () => {
			if (policyEl) policyEl.hidden = !rememberEl.checked
		})

		const close = (choice) => {
			if (rememberEl?.checked) {
				const explicit = policyEl?.value
				if (explicit === 'apply_saved' || explicit === 'keep_live' || explicit === 'ask') {
					setHardwarePolicy(explicit)
				} else if (choice === 'apply_saved' || choice === 'keep_live') {
					setHardwarePolicy(choice)
				}
			}
			modal.remove()
			resolve(choice)
		}

		modal.querySelector('#hw-reconcile-close')?.addEventListener('click', () => close('cancel'))
		modal.querySelector('#hw-reconcile-keep')?.addEventListener('click', () => close('keep_live'))
		modal.querySelector('#hw-reconcile-apply')?.addEventListener('click', () => close('apply_saved'))
		modal.querySelector('#hw-reconcile-device-view')?.addEventListener('click', () => close('device_view'))
		modal.querySelector('#hw-reconcile-snapshot')?.addEventListener('click', () => {
			close('load_snapshot')
			openLoadDeviceSnapshotModal({
				onApplied: () => showToast?.('Device snapshot applied. Re-load the project if needed.', 'success'),
				onStatus: (msg, ok) => showToast?.(msg, ok ? 'success' : 'error'),
			})
		})
		modal.addEventListener('click', (e) => {
			if (e.target === modal) close('cancel')
		})
	})
}

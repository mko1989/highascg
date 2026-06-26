/**
 * Sync Modal: Handles reconciliation and pushing offline drafts to live CasparCG.
 */

'use strict'

import { api } from '../lib/api-client.js'

export async function showSyncModal() {
	const id = 'sync-modal'
	if (document.getElementById(id)) return

	const modal = document.createElement('div')
	modal.id = id
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content sync-modal">
			<div class="modal-header">
				<h2>Sync Project to Live Server</h2>
				<button class="modal-close" id="sync-close">&times;</button>
			</div>
			<div class="modal-body">
				<div id="sync-loading" class="sync-loading">
					<span class="spinner"></span> Analyzing assets and server state…
				</div>
				<div id="sync-report" class="sync-report" style="display:none">
					<p class="sync-report__msg"></p>
					<div class="sync-reconcile-lists">
						<div class="sync-list sync-list--missing">
							<h3>Missing Media</h3>
							<ul id="sync-missing-media"></ul>
						</div>
						<div class="sync-list sync-list--missing">
							<h3>Missing Templates</h3>
							<ul id="sync-missing-templates"></ul>
						</div>
					</div>
					<div class="sync-list">
						<h3>Active Assets in Draft</h3>
						<ul id="sync-used-assets"></ul>
					</div>
				</div>
				<div id="sync-error" class="sync-error" style="display:none"></div>
			</div>
			<div class="modal-footer">
				<button class="btn btn--secondary" id="sync-cancel">Cancel</button>
				<button class="btn btn--primary" id="sync-commit" disabled>Commit & Apply to Live</button>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const close = () => modal.remove()
	modal.querySelector('#sync-close').onclick = close
	modal.querySelector('#sync-cancel').onclick = close
	const commitBtn = modal.querySelector('#sync-commit')
	const reportEl = modal.querySelector('#sync-report')
	const loadingEl = modal.querySelector('#sync-loading')
	const errorEl = modal.querySelector('#sync-error')

	try {
		const res = await api.post('/api/project/reconcile')
		loadingEl.style.display = 'none'
		
		if (!res.ok) {
			errorEl.textContent = res.error || 'Reconciliation failed'
			errorEl.style.display = 'block'
			return
		}

		const r = res.reconciliation
		reportEl.style.display = 'block'
		
		const msgEl = reportEl.querySelector('.sync-report__msg')
		if (r.isClean) {
			msgEl.innerHTML = '<span class="status-badge status-badge--success">Ready</span> All assets found on server. Ready to take live.'
			msgEl.className = 'sync-report__msg sync-report__msg--ok'
		} else {
			msgEl.innerHTML = '<span class="status-badge status-badge--warn">Warning</span> Some assets used in your draft are missing on the production server.'
			msgEl.className = 'sync-report__msg sync-report__msg--warn'
		}

		const fill = (id, items) => {
			const ul = modal.querySelector('#' + id)
			ul.innerHTML = items.length ? '' : '<li>None</li>'
			items.forEach(i => {
				const li = document.createElement('li')
				li.textContent = i
				ul.appendChild(li)
			})
		}

		fill('sync-missing-media', r.missingMedia)
		fill('sync-missing-templates', r.missingTemplates)
		
		const used = [...r.usedMedia, ...r.usedTemplates]
		fill('sync-used-assets', used)

		commitBtn.disabled = false
		commitBtn.onclick = async () => {
			commitBtn.disabled = true
			commitBtn.textContent = 'Applying…'
			try {
				const syncRes = await api.post('/api/project/sync')
				if (syncRes.ok) {
					alert('Sync complete! All channels aligned to draft.')
					close()
				} else {
					alert('Sync partially failed. Check server logs.')
					close()
				}
			} catch (err) {
				alert('Sync Error: ' + err.message)
				commitBtn.disabled = false
				commitBtn.textContent = 'Commit & Apply to Live'
			}
		}

	} catch (err) {
		loadingEl.style.display = 'none'
		errorEl.textContent = 'Failed to communicate with server: ' + err.message
		errorEl.style.display = 'block'
	}
}

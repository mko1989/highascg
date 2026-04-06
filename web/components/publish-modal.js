/**
 * Publish Modal: Handles sequential media upload and configuration handoff
 * to a remote production server.
 * @see 15_WO_CLIENT_SERVER_SYNC.md Phase 3
 */

'use strict'

import { api } from '../lib/api-client.js'

const TARGET_STORAGE_KEY = 'highascg_publish_target'

/** 
 * UI Component for the Publish/Sync workflow.
 */
export async function showPublishModal() {
	const id = 'publish-modal'
	if (document.getElementById(id)) return

	const savedTarget = localStorage.getItem(TARGET_STORAGE_KEY) || ''

	const modal = document.createElement('div')
	modal.id = id
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content publish-modal">
			<div class="modal-header">
				<h2>Publish to Production Server</h2>
				<button class="modal-close" id="publish-close">&times;</button>
			</div>
			<div class="modal-body">
				<div id="publish-setup">
					<p class="publish-intro">Intelligent differential sync: only missing or modified media files will be uploaded.</p>
					<div class="settings-group">
						<label>Target Server Address (IP or Hostname)</label>
						<input type="text" id="publish-target" placeholder="e.g., 192.168.1.50:8080" value="${savedTarget}">
						<p class="settings-note">Ensure the production HighAsCG server is running and reachable.</p>
					</div>
					<div class="publish-warning">
						<p><strong>Note:</strong> This will overwrite the configuration, scenes, and media on the production server to match your local draft. The remote servers will restart automatically.</p>
					</div>
				</div>

				<div id="publish-progress" style="display:none">
					<div class="publish-step" id="step-bundle" data-status="pending">
						<div class="publish-step-title">
							<span class="status-icon">⚪</span> <span>Preparing project bundle…</span>
						</div>
					</div>
					<div class="publish-step" id="step-diff" data-status="pending">
						<div class="publish-step-title">
							<span class="status-icon">⚪</span> <span>Analyzing server assets (diffing)…</span>
						</div>
					</div>
					<div class="publish-step" id="step-upload" data-status="pending">
						<div class="publish-step-title">
							<span class="status-icon">⚪</span> <span>Syncing media (<span id="upload-count">0/0</span>)…</span>
						</div>
						<div class="progress-bar-wrap" style="margin: 8px 0 4px">
							<div class="progress-bar" id="upload-progress-bar" style="width: 0%"></div>
						</div>
						<div id="current-file" class="current-file-text"></div>
					</div>
					<div class="publish-step" id="step-apply" data-status="pending">
						<div class="publish-step-title">
							<span class="status-icon">⚪</span> <span>Applying configuration & restarting production server…</span>
						</div>
					</div>
				</div>

				<div id="publish-error" class="publish-error" style="display:none; color: #f87171; background: rgba(248, 113, 113, 0.1); padding: 12px; border-radius: 4px; border: 1px solid rgba(248, 113, 113, 0.3); margin-top: 1rem; font-size: 0.85rem;"></div>
			</div>
			<div class="modal-footer">
				<button class="btn btn--secondary" id="publish-cancel">Cancel</button>
				<button class="btn btn--primary" id="publish-start">Start Production Sync</button>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const close = () => modal.remove()
	modal.querySelector('#publish-close').onclick = close
	modal.querySelector('#publish-cancel').onclick = close
	const startBtn = modal.querySelector('#publish-start')
	const targetInput = modal.querySelector('#publish-target')
	const setupEl = modal.querySelector('#publish-setup')
	const progressEl = modal.querySelector('#publish-progress')
	const errorEl = modal.querySelector('#publish-error')

	startBtn.onclick = async () => {
		const targetBase = targetInput.value.trim()
		if (!targetBase) {
			alert('Please enter a target server address.')
			return
		}
		
		// Ensure protocol
		const target = targetBase.startsWith('http') ? targetBase : `http://${targetBase}`
		localStorage.setItem(TARGET_STORAGE_KEY, targetBase)

		startBtn.disabled = true
		startBtn.textContent = 'Publishing…'
		setupEl.style.display = 'none'
		progressEl.style.display = 'block'
		errorEl.style.display = 'none'

		try {
			await runPublishWorkflow(target, modal)
			startBtn.textContent = 'Success!'
			startBtn.classList.add('btn--success')
			setTimeout(close, 2000)
		} catch (err) {
			console.error('[Publish] Workflow error:', err)
			errorEl.textContent = `Publish failed: ${err.message}`
			errorEl.style.display = 'block'
			startBtn.disabled = false
			startBtn.textContent = 'Retry Sync'
		}
	}
}

/**
 * Sequential publishing logic: bundle -> diff -> upload media -> apply.
 */
async function runPublishWorkflow(targetUrl, modal) {
	const updateStep = (id, status, msg) => {
		const el = modal.querySelector(`#step-${id}`)
		if (!el) return
		el.dataset.status = status
		const iconEl = el.querySelector('.status-icon')
		const textEl = el.querySelector('span:not(.status-icon):not(#upload-count)')
		
		if (status === 'loading') {
			iconEl.textContent = '⏳'
			el.classList.add('is-loading')
		} else if (status === 'done') {
			iconEl.textContent = '✅'
			el.classList.remove('is-loading')
			el.classList.add('is-done')
		} else if (status === 'error') {
			iconEl.textContent = '❌'
			el.classList.remove('is-loading')
			el.classList.add('is-error')
		}
		if (msg) textEl.textContent = msg
	}

	// 1. Generate local bundle (JSON)
	updateStep('bundle', 'loading')
	
	// Prevent self-sync if target points to local
	const myOrigin = window.location.origin
	if (targetUrl.startsWith(myOrigin)) {
		throw new Error('Target address cannot be the local server itself.')
	}

	// Local server generation of the bundle
	const bundle = await api.get('/api/project/bundle')
	
	// Quick version handshake/compatibility check if remote has /api/settings
	try {
		const remoteMeta = await fetch(`${targetUrl}/api/settings`).then(r => r.json())
		// Basic check: we want them to be somewhat compatible. 
		// If remote doesn't even have /api/settings, it's too old or not HighAsCG.
	} catch (e) {
		throw new Error('Target server is not responding or not a compatible HighAsCG instance.')
	}

	updateStep('bundle', 'done')

	// 2. Diff against remote production server
	updateStep('diff', 'loading')
	const diffRes = await fetch(`${targetUrl}/api/project/diff`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ mediaManifest: bundle.mediaManifest })
	})
	if (!diffRes.ok) {
		const errJson = await diffRes.json().catch(() => ({}))
		throw new Error(errJson.error || `Remote diff failed (HTTP ${diffRes.status})`)
	}
	const diff = await diffRes.json()
	const requiredMedia = diff.requiredMedia || []
	updateStep('diff', 'done', `Reconciled: ${requiredMedia.length} files need sync`)

	// 3. Sequential Media Upload
	updateStep('upload', 'loading')
	const countTotal = requiredMedia.length
	const countEl = modal.querySelector('#upload-count')
	const barEl = modal.querySelector('#upload-progress-bar')
	const currentFileEl = modal.querySelector('#current-file')
	
	if (countTotal === 0) {
		updateStep('upload', 'done', 'Media is already up to date')
	} else {
		for (let i = 0; i < countTotal; i++) {
			const relPath = requiredMedia[i]
			countEl.textContent = `${i + 1}/${countTotal}`
			currentFileEl.textContent = relPath.length > 40 ? '…' + relPath.slice(-37) : relPath
			
			const progress = (i / countTotal) * 100
			barEl.style.width = `${progress}%`

			// Fetch original file bits from LOCAL server to pipe to REMOTE server.
			// Path is relative to CasparCG media folder.
			const localFileUrl = `${api.getApiBase()}/api/ingest/preview?id=${encodeURIComponent(relPath)}`
			const fileRes = await fetch(localFileUrl)
			if (!fileRes.ok) throw new Error(`Could not read local file: ${relPath}`)
			const blob = await fileRes.blob()

			// Upload to REMOTE
			const formData = new FormData()
			// We send the file plus a target path to ensure subfolders match
			formData.append('file', blob, relPath) 
			formData.append('path', pathDir(relPath)) // Folder segment

			const upRes = await fetch(`${targetUrl}/api/ingest/upload`, {
				method: 'POST',
				body: formData
			})
			if (!upRes.ok) {
				const upErr = await upRes.json().catch(() => ({}))
				throw new Error(`Upload failed for ${relPath}: ${upErr.error || upRes.statusText}`)
			}
		}
		barEl.style.width = '100%'
		currentFileEl.textContent = 'All assets uploaded'
		updateStep('upload', 'done', `Synced ${countTotal} media files`)
	}

	// 4. Remote Configuration Apply & Restart
	updateStep('apply', 'loading')
	// We're sending the exact same bundle we generated locally
	const applyRes = await fetch(`${targetUrl}/api/project/apply-bundle`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(bundle)
	})
	if (!applyRes.ok) {
		const applyErr = await applyRes.json().catch(() => ({}))
		throw new Error(`Remote application failed: ${applyErr.error || applyRes.statusText}`)
	}
	updateStep('apply', 'done', 'Remote production server synchronized and restarting.')
}

/** Utility to get folder part of a relative path */
function pathDir(p) {
	const parts = p.split(/[/\\]/)
	if (parts.length <= 1) return ''
	parts.pop()
	return parts.join('/')
}

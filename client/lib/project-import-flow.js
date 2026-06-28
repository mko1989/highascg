/**
 * Import project JSON with hardware reconcile (looks-only vs full hardware apply).
 */
import { api } from './api-client.js'
import {
	detectHardwareMismatch,
	fetchLiveHardwareContext,
	hasProjectHardwareConfig,
} from './project-hardware-mismatch.js'
import { applyProjectHardware } from './project-hardware-apply.js'
import { getHardwarePolicy } from './project-hardware-policy.js'
import { showProjectHardwareReconcileModal } from '../components/project-hardware-reconcile-modal.js'
import { runPostImportMediaReconcile } from './project-media-reconcile.js'
import {
	syncProjectMediaContextFromProject,
	refreshProjectMediaContext,
	formatProjectMediaUploadHint,
} from './project-media-context.js'

const BANNER_ID = 'highascg-hardware-keep-live-banner'

/**
 * @param {object} project
 * @param {{
 *   projectState: object,
 *   sceneState: object,
 *   timelineState: object,
 *   multiviewState: object,
 *   programOutputState?: object,
 *   showToast?: (msg: string, type?: string) => void,
 *   onNameSync?: (name: string) => void,
 *   onApplyServerProject?: () => Promise<void>,
 *   source?: string,
 *   stateStore?: { getState?: () => object },
 *   offline?: boolean,
 * }} deps
 * @returns {Promise<'full' | 'looks_only' | 'cancelled'>}
 */
export async function importProjectWithHardwareReconcile(project, deps) {
	if (!project || typeof project !== 'object') return 'cancelled'

	const importLooks = () => {
		const silent = deps.source === 'server-bootstrap' || deps.source === 'server-reconnect'
		deps.projectState.importProject(
			project,
			deps.sceneState,
			deps.timelineState,
			deps.multiviewState,
			deps.programOutputState,
			{ silent },
		)
		deps.onNameSync?.(deps.projectState.getProjectName())
		window.dispatchEvent(new Event('project-loaded'))
		syncProjectMediaContextFromProject(project)
		if (
			deps.source !== 'server-bootstrap' &&
			deps.source !== 'server-reconnect' &&
			deps.source !== 'load-modal'
		) {
			void refreshProjectMediaContext().then(() => {
				const hint = formatProjectMediaUploadHint()
				if (hint) deps.showToast?.(hint, 'info')
			})
		}
		void runPostImportMediaReconcile(project, {
			offline: deps.offline,
			stateStore: deps.stateStore,
			showToast: deps.showToast,
			source: deps.source,
		})
	}

	const hw = project.hardwareConfig
	if (!hasProjectHardwareConfig(hw)) {
		importLooks()
		hideKeepLiveBanner()
		return 'looks_only'
	}

	let liveCtx = null
	try {
		liveCtx = await fetchLiveHardwareContext()
	} catch {
		liveCtx = null
	}
	const report = detectHardwareMismatch(hw, liveCtx)
	const policy = getHardwarePolicy()

	const applyFull = async () => {
		if (typeof deps.onApplyServerProject === 'function') {
			await deps.onApplyServerProject()
		}
		importLooks()
		const { steps, warnings } = await applyProjectHardware(hw)
		hideKeepLiveBanner()
		const msg = steps.length ? steps.join(' · ') : 'Project hardware applied'
		deps.showToast?.(warnings.length ? `${msg} (${warnings[0]})` : msg, warnings.length ? 'info' : 'success')
		return /** @type {const} */ ('full')
	}

	const applyLooksOnly = (opts = {}) => {
		const { banner = true, toast = true } = opts
		importLooks()
		if (banner) showKeepLiveBanner()
		if (toast) deps.showToast?.('Looks loaded — routing unchanged. Verify Device View.', 'info')
		return /** @type {const} */ ('looks_only')
	}

	// Hardware already matches live — hydrate looks only, no banner/toast (normal refresh/boot).
	if (report.severity === 'none') {
		importLooks()
		hideKeepLiveBanner()
		return 'looks_only'
	}

	// Boot / reconnect: OS layout drift alone or being on the same machine should not block the UI (operator already on this machine).
	if (
		(deps.source === 'server-bootstrap' || deps.source === 'server-reconnect') &&
		(report.sameMachine ||
			(report.severity === 'soft' &&
				report.items.every((it) => it.section === 'OS display layout' || it.section === 'Caspar screen modes')))
	) {
		importLooks()
		hideKeepLiveBanner()
		return 'looks_only'
	}

	if (policy === 'apply_saved' && report.severity !== 'hard') {
		return applyFull()
	}
	if (policy === 'keep_live') {
		return applyLooksOnly()
	}

	const choice = await showProjectHardwareReconcileModal({
		project,
		report,
		liveCtx,
		showToast: deps.showToast,
	})
	if (choice === 'apply_saved') return applyFull()
	if (choice === 'keep_live') return applyLooksOnly()
	if (choice === 'device_view') {
		applyLooksOnly({ toast: false })
		window.highascgActivateWorkspaceTab?.('device-view')
		return 'looks_only'
	}
	if (choice === 'load_snapshot') {
		applyLooksOnly({ toast: false })
		return 'looks_only'
	}
	return 'cancelled'
}

export function showKeepLiveBanner() {
	let el = document.getElementById(BANNER_ID)
	if (!el) {
		el = document.createElement('div')
		el.id = BANNER_ID
		el.className = 'hardware-reconcile-banner'
		el.innerHTML =
			'<span class="hardware-reconcile-banner__text">Looks loaded with <strong>live hardware routing</strong> — verify cabling in Device View before air.</span>' +
			'<button type="button" class="hardware-reconcile-banner__link">Open Devices</button>' +
			'<button type="button" class="hardware-reconcile-banner__dismiss" aria-label="Dismiss">×</button>'
		document.body.appendChild(el)
		el.querySelector('.hardware-reconcile-banner__link')?.addEventListener('click', () => {
			window.highascgActivateWorkspaceTab?.('device-view')
		})
		el.querySelector('.hardware-reconcile-banner__dismiss')?.addEventListener('click', () => {
			el.remove()
		})
	}
}

export function hideKeepLiveBanner() {
	document.getElementById(BANNER_ID)?.remove()
}

/**
 * After explicit server save, remind operator that hardware is included when using POST /api/project/save.
 * @param {boolean} usedServerSave
 */
export function noteHardwareIncludedInSave(usedServerSave) {
	if (!usedServerSave) return
	// Tooltip/title on save button carries primary message; optional toast omitted to reduce noise.
}

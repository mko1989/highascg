/**
 * Small fixed toasts (bottom-right). Shared by header and Device View actions.
 */
import { UI_FONT_FAMILY } from './ui-font.js'

/**
 * @param {string} msg
 * @param {'info'|'success'|'error'|'warn'} [type]
 * @param {number} [durationMs]
 */
export function showAppToast(msg, type = 'info', durationMs) {
	let container = document.getElementById('app-toast-container')
	if (!container) {
		container = document.createElement('div')
		container.id = 'app-toast-container'
		container.style.cssText =
			'position:fixed;bottom:16px;right:16px;z-index:10000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none;'
		document.body.appendChild(container)
	}
	const toast = document.createElement('div')
	const bg =
		type === 'error'
			? '#b91c1c'
			: type === 'success'
				? '#15803d'
				: type === 'warn'
					? '#b45309'
					: '#1d4ed8'
	const ms = durationMs ?? (type === 'error' ? 6500 : 3800)
	toast.style.cssText = `padding:8px 14px;border-radius:6px;font-size:13px;font-family:${UI_FONT_FAMILY};max-width:340px;word-break:break-word;box-shadow:0 2px 10px rgba(0,0,0,.35);background:${bg};color:#fff;pointer-events:auto;`
	toast.textContent = msg
	toast.setAttribute('role', 'status')
	container.appendChild(toast)
	setTimeout(() => toast.remove(), ms)
}

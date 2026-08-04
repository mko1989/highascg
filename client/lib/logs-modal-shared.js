/**
 * Shared logs modal helpers — pane visibility, support bundle download (WO-67).
 */

/**
 * @param {HTMLElement} modal
 * @param {boolean} highOn
 * @param {boolean} casparOn
 */
export function setLogsToggleStyles(modal, highOn, casparOn) {
	const h = modal.querySelector('#logs-toggle-highascg')
	const c = modal.querySelector('#logs-toggle-caspar')
	if (h) {
		h.classList.toggle('logs-modal__toggle--on', highOn)
		h.setAttribute('aria-pressed', highOn ? 'true' : 'false')
	}
	if (c) {
		c.classList.toggle('logs-modal__toggle--on', casparOn)
		c.setAttribute('aria-pressed', casparOn ? 'true' : 'false')
	}
}

/**
 * @param {{
 *   paneHigh?: HTMLElement | null,
 *   paneCaspar?: HTMLElement | null,
 *   panesEmpty?: HTMLElement | null,
 *   panesEl?: HTMLElement | null,
 *   filtersEl?: HTMLElement | null,
 *   categoryDropEl?: HTMLElement | null,
 *   highOn: boolean,
 *   casparOn: boolean,
 * }} opts
 */
export function applyLogsPaneVisibility(opts) {
	const { paneHigh, paneCaspar, panesEmpty, panesEl, filtersEl, categoryDropEl, highOn, casparOn } = opts
	if (paneHigh) paneHigh.hidden = !highOn
	if (paneCaspar) paneCaspar.hidden = !casparOn
	if (panesEmpty) panesEmpty.hidden = highOn || casparOn
	if (panesEl) {
		const single = (highOn && !casparOn) || (!highOn && casparOn)
		panesEl.classList.toggle('logs-modal__panes--single', single)
	}
	if (filtersEl) filtersEl.hidden = !highOn
	if (categoryDropEl) categoryDropEl.hidden = !highOn
}

/**
 * @param {string} apiBase
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export async function fetchSupportBundle(apiBase, opts = {}) {
	const res = await fetch(`${apiBase}/api/support/bundle`, {
		credentials: 'same-origin',
		signal: opts.signal,
	})
	if (!res.ok) {
		let detail = res.statusText
		try {
			const j = await res.json()
			if (j?.error) detail = j.error
		} catch {
			/* ignore */
		}
		throw new Error(detail)
	}
	const blob = await res.blob()
	const cd = res.headers.get('Content-Disposition') || ''
	let filename = 'highascg-support.zip'
	const m = cd.match(/filename="([^"]+)"/)
	if (m) filename = m[1]
	return { blob, filename }
}

/**
 * @param {string} apiBase
 * @param {{ filename?: string }} [opts]
 */
export function triggerBlobDownload(blob, filename = 'highascg-support.zip') {
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = filename
	a.rel = 'noopener'
	document.body.appendChild(a)
	a.click()
	a.remove()
	URL.revokeObjectURL(url)
}

/**
 * @param {string} apiBase
 * @param {{ onError?: (err: unknown) => void }} [opts]
 */
export async function downloadSupportBundleFromApi(apiBase, _opts = {}) {
	const { blob, filename } = await fetchSupportBundle(apiBase)
	triggerBlobDownload(blob, filename)
}

/**
 * Minimal markdown → HTML for the shortcuts tab (headings, bold/italic/code, dash lists).
 * @param {string} md
 */
export function parseMarkdownBasic(md) {
	let html = md
		.replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/^### (.*$)/gim, '<h3>$1</h3>')
		.replace(/^## (.*$)/gim, '<h2>$1</h2>')
		.replace(/^# (.*$)/gim, '<h1>$1</h1>')
		.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
		.replace(/`(.*?)`/gim, '<code>$1</code>')
		.replace(/\*(.*?)\*/gim, '<em>$1</em>')

	let inList = false;
	const lines = html.split('\n');
	for(let i=0; i<lines.length; i++) {
		if(lines[i].match(/^- /)) {
			if(!inList) {
				lines[i] = '<ul>\n' + lines[i].replace(/^- (.*)$/, '<li>$1</li>');
				inList = true;
			} else {
				lines[i] = lines[i].replace(/^- (.*)$/, '<li>$1</li>');
			}
		} else {
			if(inList) {
				lines[i-1] += '\n</ul>';
				inList = false;
			}
			if (lines[i].trim() && !lines[i].match(/^<h/) && !lines[i].match(/^<ul>/) && !lines[i].match(/^<\/ul>/)) {
				lines[i] = '<p>' + lines[i] + '</p>';
			}
		}
	}
	if (inList) lines[lines.length-1] += '\n</ul>';
	return lines.join('\n');
}

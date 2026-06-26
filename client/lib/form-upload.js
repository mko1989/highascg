/**
 * POST multipart FormData with upload progress. The fetch API does not expose upload progress.
 * @param {string} url
 * @param {FormData} formData
 * @param {(loaded: number, total: number) => void} [onProgress] - total is 0 when length is unknown
 * @returns {Promise<Record<string, unknown>>}
 */
export function postFormDataWithProgress(url, formData, onProgress) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest()
		xhr.open('POST', url)
		xhr.upload.addEventListener('progress', (e) => {
			if (onProgress) onProgress(e.loaded, e.lengthComputable ? e.total : 0)
		})
		xhr.onload = () => {
			const ct = xhr.getResponseHeader('content-type') || ''
			const text = xhr.responseText
			if (!ct.includes('application/json')) {
				reject(
					new Error(
						text.startsWith('<')
							? `HTTP ${xhr.status}: server returned HTML (not JSON)`
							: `HTTP ${xhr.status}: ${text.slice(0, 120)}`
					)
				)
				return
			}
			let json
			try {
				json = JSON.parse(text)
			} catch {
				reject(new Error(`HTTP ${xhr.status}: invalid JSON`))
				return
			}
			if (xhr.status < 200 || xhr.status >= 300) {
				reject(new Error(json.error || xhr.statusText || 'Request failed'))
				return
			}
			resolve(json)
		}
		xhr.onerror = () => reject(new Error('Network error'))
		xhr.send(formData)
	})
}

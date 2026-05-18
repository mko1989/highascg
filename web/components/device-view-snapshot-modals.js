/**
 * WO-49 — Save / load device-wide snapshot JSON.
 */
import { api } from '../lib/api-client.js'
import { slugifyDeviceName, captureRearPanelVisual } from '../lib/device-snapshot-capture.js'

function downloadJson(filename, obj) {
	const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' })
	const a = document.createElement('a')
	a.href = URL.createObjectURL(blob)
	a.download = filename
	a.click()
	URL.revokeObjectURL(a.href)
}

function modalShell(title, bodyEl, actions) {
	const backdrop = document.createElement('div')
	backdrop.style.cssText =
		'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:20000;display:flex;align-items:center;justify-content:center;padding:16px;'
	const box = document.createElement('div')
	box.style.cssText =
		'background:#222;color:#eee;max-width:32rem;width:100%;padding:16px;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.5);font-size:13px;'
	const h = document.createElement('h3')
	h.style.cssText = 'margin:0 0 12px;font-size:15px;font-weight:600;'
	h.textContent = title
	const close = () => backdrop.remove()
	backdrop.onclick = (ev) => {
		if (ev.target === backdrop) close()
	}
	box.append(h, bodyEl, actions)
	backdrop.append(box)
	document.body.append(backdrop)
	return { backdrop, close }
}

/**
 * @param {{ getRearPanelEl: () => HTMLElement | null, onStatus?: (msg: string, ok?: boolean) => void }} opts
 */
export async function openSaveDeviceSnapshotModal(opts) {
	const nameInput = Object.assign(document.createElement('input'), {
		type: 'text',
		placeholder: 'e.g. OB truck Caspar 1',
		style: 'width:100%;box-sizing:border-box;padding:8px;margin:8px 0;background:#111;border:1px solid #444;color:#eee;border-radius:4px;',
	})
	const filePreview = Object.assign(document.createElement('div'), {
		style: 'opacity:.85;font-size:11px;margin-bottom:8px;',
	})
	const capNote = Object.assign(document.createElement('label'), {
		style: 'display:flex;align-items:center;gap:8px;margin:8px 0;cursor:pointer;',
	})
	const capChk = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true })
	capNote.append(capChk, document.createTextNode('Embed rear-panel image (PNG)'))
	const hint = Object.assign(document.createElement('p'), {
		textContent: 'Saves device graph, screen destinations, GPU layout & DeckLink-related screen settings.',
		style: 'opacity:.8;font-size:11px;margin:8px 0 0;line-height:1.35;',
	})
	function updFile() {
		const slug = slugifyDeviceName(nameInput.value)
		filePreview.textContent = `File: ${slug}.json`
	}
	nameInput.addEventListener('input', updFile)
	updFile()

	const actions = document.createElement('div')
	actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px;'
	const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'header-btn', textContent: 'Cancel' })
	const ok = Object.assign(document.createElement('button'), { type: 'button', className: 'header-btn device-view__apply-btn', textContent: 'Save…' })
	actions.append(cancel, ok)

	const body = document.createElement('div')
	body.append(nameInput, filePreview, capNote, hint)

	const { backdrop, close } = modalShell('Save device snapshot', body, actions)

	cancel.onclick = close
	ok.onclick = async () => {
		const deviceName = String(nameInput.value || '').trim()
		if (!deviceName) {
			opts.onStatus?.('Enter a device name.', false)
			return
		}
		const slug = slugifyDeviceName(deviceName)
		ok.disabled = true
		try {
			const built = await api.get('/api/device-snapshot/build')
			if (!built?.ok || built.kind !== 'highascg-device-snapshot') {
				throw new Error(built?.error || 'Server did not return a device snapshot envelope')
			}
			let visual = null
			if (capChk.checked) {
				visual = await captureRearPanelVisual(opts.getRearPanelEl?.() || null)
				if (!visual) opts.onStatus?.('Saved without image (capture failed).', false)
			}
			const doc = {
				kind: built.kind,
				version: built.version,
				deviceName,
				slug,
				createdAt: built.createdAt || new Date().toISOString(),
				...(built.appVersion ? { appVersion: built.appVersion } : {}),
				...(built.host ? { host: built.host } : {}),
				...(visual ? { visual } : {}),
				payload: built.payload,
			}
			downloadJson(`${slug}.json`, doc)
			opts.onStatus?.(`Saved ${slug}.json`, true)
			close()
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			opts.onStatus?.(`Save failed: ${msg}`, false)
		} finally {
			ok.disabled = false
		}
	}
}

/**
 * @param {{ onApplied: () => void, onStatus?: (msg: string, ok?: boolean) => void }} opts
 */
export function openLoadDeviceSnapshotModal(opts) {
	const fileInput = Object.assign(document.createElement('input'), {
		type: 'file',
		accept: 'application/json,.json',
		style: 'margin:8px 0;',
	})
	const modeSel = Object.assign(document.createElement('select'), { style: 'margin:8px 0;padding:6px;background:#111;color:#eee;border:1px solid #444;border-radius:4px;' })
	modeSel.innerHTML = '<option value="full">Full — graph + screens + GPU/DeckLink fields</option><option value="graphOnly">Device graph only</option>'

	const preview = Object.assign(document.createElement('pre'), {
		style:
			'max-height:10rem;overflow:auto;background:#111;padding:8px;border-radius:4px;font-size:10px;white-space:pre-wrap;margin:8px 0;',
		textContent: 'Choose a .json file to preview changes.',
	})

	let lastParsed = null

	const actions = document.createElement('div')
	actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px;flex-wrap:wrap;'
	const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'header-btn', textContent: 'Cancel' })
	const dryBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'header-btn', textContent: 'Preview' })
	const applyBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'header-btn device-view__apply-btn', textContent: 'Apply', disabled: true })
	actions.append(cancel, dryBtn, applyBtn)

	const body = document.createElement('div')
	body.append(
		Object.assign(document.createElement('p'), {
			textContent: 'Load a snapshot file created with “Save device snapshot”.',
			style: 'margin:0',
		}),
		fileInput,
		Object.assign(document.createElement('div'), { style: 'margin-top:4px', textContent: 'Apply mode:' }),
		modeSel,
		preview
	)

	const { close } = modalShell('Load device snapshot', body, actions)

	cancel.onclick = close

	fileInput.onchange = () => {
		lastParsed = null
		applyBtn.disabled = true
		preview.textContent = 'Reading…'
		const f = fileInput.files?.[0]
		if (!f) {
			preview.textContent = 'No file selected.'
			return
		}
		const reader = new FileReader()
		reader.onload = () => {
			try {
				lastParsed = JSON.parse(String(reader.result || '{}'))
				preview.textContent = 'Click Preview to validate and list changes.'
			} catch (e) {
				lastParsed = null
				preview.textContent = `Invalid JSON: ${e instanceof Error ? e.message : e}`
			}
		}
		reader.readAsText(f, 'utf-8')
	}

	dryBtn.onclick = async () => {
		if (!lastParsed) {
			opts.onStatus?.('Select a valid JSON file first.', false)
			return
		}
		const mode = modeSel.value === 'graphOnly' ? 'graphOnly' : 'full'
		preview.textContent = 'Checking…'
		dryBtn.disabled = true
		try {
			const r = await api.post('/api/device-snapshot/apply', {
				snapshot: lastParsed,
				mode,
				dryRun: true,
			})
			if (!r?.ok) throw new Error(r?.error || 'Validation failed')
			const lines = [`Mode: ${r.mode}`, `Sections: ${(r.sections || []).join(', ')}`, `Changed keys: ${(r.changedKeys || []).join(', ') || '(none)'}`, '', 'Click Apply to write to config.']
			preview.textContent = lines.join('\n')
			applyBtn.disabled = false
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			preview.textContent = `Error: ${msg}`
			applyBtn.disabled = true
		} finally {
			dryBtn.disabled = false
		}
	}

	applyBtn.onclick = async () => {
		if (!lastParsed) return
		const mode = modeSel.value === 'graphOnly' ? 'graphOnly' : 'full'
		if (!window.confirm(`Apply device snapshot (${mode})? This updates saved configuration.`)) return
		applyBtn.disabled = true
		try {
			const r = await api.post('/api/device-snapshot/apply', {
				snapshot: lastParsed,
				mode,
				dryRun: false,
			})
			if (!r?.ok) throw new Error(r?.error || 'Apply failed')
			opts.onStatus?.('Device snapshot applied.', true)
			document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
			opts.onApplied?.()
			close()
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			opts.onStatus?.(`Apply failed: ${msg}`, false)
		} finally {
			applyBtn.disabled = false
		}
	}
}

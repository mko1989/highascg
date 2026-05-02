/**
 * Rendering helpers for Saved Models, Meshes and Cameras in the Previs Inspector.
 */

const formatBytes = (n) => (!n || !isFinite(n)) ? '—' : (n < 1024) ? `${n} B` : (n < 1048576) ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`

export function renderSavedModels(container, opts, { ROW_CLASS, LABEL_CLASS, LABEL_ACTIVE_MOD, BTN_CLASS, BTN_GHOST_MOD, EMPTY_CLASS }) {
	container.replaceChildren(); const snap = opts.state.getSnapshot()
	if (!snap.models.length) { const e = document.createElement('div'); e.className = EMPTY_CLASS; e.textContent = 'No saved models.'; container.appendChild(e); return }
	for (const m of snap.models) {
		const row = document.createElement('div'); row.className = ROW_CLASS; const active = snap.activeModelId === m.id
		const lab = document.createElement('span'); lab.className = LABEL_CLASS + (active ? ` ${LABEL_ACTIVE_MOD}` : ''); lab.textContent = active ? `▶ ${m.name}` : m.name
		const load = Object.assign(document.createElement('button'), { type: 'button', className: BTN_CLASS, textContent: 'Load' })
		load.onclick = (e) => { e.stopPropagation(); opts.onLoadSavedModel(m.id) }
		const del = Object.assign(document.createElement('button'), { type: 'button', className: `${BTN_CLASS} ${BTN_GHOST_MOD}`, textContent: '✕' })
		del.onclick = (e) => { e.stopPropagation(); if (confirm(`Delete "${m.name}"?`)) opts.onDeleteSavedModel(m.id) }
		row.append(lab, load, del); container.appendChild(row)
	}
}

export function renderMeshList(container, opts, { ROW_CLASS, ROW_TAGGED_MOD, LABEL_CLASS, LABEL_ACTIVE_MOD, SELECT_CLASS, BTN_CLASS, EMPTY_CLASS }) {
	container.replaceChildren(); const meshes = opts.getMeshes?.() || []
	if (!meshes.length) { const e = document.createElement('div'); e.className = EMPTY_CLASS; e.textContent = 'Load a model to see meshes.'; container.appendChild(e); return }
	const sources = opts.getAvailableSources?.() || null
	for (const entry of meshes) {
		const tagged = !!(entry.isScreen || entry.sourceId); const row = document.createElement('div'); row.className = ROW_CLASS + (tagged ? ` ${ROW_TAGGED_MOD}` : '')
		const lab = document.createElement('span'); lab.className = LABEL_CLASS + (tagged ? ` ${LABEL_ACTIVE_MOD}` : '')
		lab.textContent = (entry.name || '(unnamed)') + (entry.sourceId && sources ? ` (${(sources.find(s => s.id === entry.sourceId) || {label: entry.sourceId}).label})` : entry.isScreen ? ' (screen)' : '')
		row.onclick = () => opts.onSelectMesh(entry.uuid)
		if (sources?.length && opts.onSetMeshSource) {
			const sel = Object.assign(document.createElement('select'), { className: SELECT_CLASS }); sel.append(Object.assign(document.createElement('option'), { value: '', textContent: '—' }))
			for (const s of sources) sel.append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }))
			sel.value = entry.sourceId || ''; sel.onclick = e => e.stopPropagation(); sel.onchange = e => { e.stopPropagation(); if (!sel.value) opts.onUntagMesh(entry.uuid); else opts.onSetMeshSource(entry.uuid, sel.value) }
			row.append(lab, sel)
		} else {
			const tag = Object.assign(document.createElement('button'), { type: 'button', className: BTN_CLASS, textContent: tagged ? 'Clear' : 'Set' })
			tag.onclick = e => { e.stopPropagation(); if (tagged) opts.onUntagMesh(entry.uuid); else opts.onTagMesh(entry.uuid) }
			row.append(lab, tag)
		}
		container.appendChild(row)
	}
}

export function renderCameraPresets(container, opts, { PRESET_ROW_CLASS, SAVE_ROW_CLASS, BTN_CLASS, BTN_GHOST_MOD, INPUT_CLASS, ROW_CLASS, LABEL_CLASS, EMPTY_CLASS }) {
	container.replaceChildren(); const activeId = opts.state.getSnapshot().activeModelId; const presets = activeId ? opts.state.getPresets(activeId) : []
	const bRow = document.createElement('div'); bRow.className = PRESET_ROW_CLASS
	for (const bp of [{id:'__builtin_front', name:'Front'}, {id:'__builtin_top', name:'Top'}, {id:'__builtin_iso', name:'ISO'}]) {
		const b = Object.assign(document.createElement('button'), { type: 'button', className: BTN_CLASS, textContent: bp.name })
		b.onclick = () => opts.onRecallPreset?.(bp.id); bRow.appendChild(b)
	}
	container.appendChild(bRow)
	const sRow = document.createElement('div'); sRow.className = SAVE_ROW_CLASS; const inp = Object.assign(document.createElement('input'), { type: 'text', className: INPUT_CLASS, placeholder: 'Preset name' })
	const save = Object.assign(document.createElement('button'), { type: 'button', className: BTN_CLASS, textContent: 'Save view', disabled: !activeId || !opts.onSavePreset })
	save.onclick = () => { if (!save.disabled) { opts.onSavePreset((inp.value || '').trim() || `View ${presets.length + 1}`); inp.value = '' } }
	sRow.append(inp, save); container.appendChild(sRow)
	if (!activeId) { const h = document.createElement('div'); h.className = EMPTY_CLASS; h.textContent = 'Load a model to save views.'; container.appendChild(h); return }
	for (const p of presets) {
		const row = document.createElement('div'); row.className = ROW_CLASS; row.append(Object.assign(document.createElement('span'), { className: LABEL_CLASS, textContent: p.name }))
		const go = Object.assign(document.createElement('button'), { type: 'button', className: BTN_CLASS, textContent: 'Go' }); go.onclick = e => { e.stopPropagation(); opts.onRecallPreset?.(p.id) }
		const del = Object.assign(document.createElement('button'), { type: 'button', className: `${BTN_CLASS} ${BTN_GHOST_MOD}`, textContent: '✕' }); del.onclick = e => { e.stopPropagation(); opts.onDeletePreset?.(p.id) }
		row.append(go, del); container.appendChild(row)
	}
}

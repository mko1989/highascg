/**
 * GPU Output controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { resolveGpuScreenNumber } from './device-view-inspector-gpu-resolve.js'
import { appendGpuLayoutEditorIfEditMode } from './device-view-inspector-gpu-layout-editor.js'
import { populateGpuVideoModelineSection } from './device-view-inspector-gpu-video-modeline.js'

export function renderGpuOutControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty, connectorCtx }) {
	const cs = currentSettings?.casparServer && typeof currentSettings.casparServer === 'object' ? currentSettings.casparServer : {}
	const screenN = resolveGpuScreenNumber(conn, lastPayload)
	const keyWindowed = `screen_${screenN}_windowed`
	const keyVsync = `screen_${screenN}_vsync`
	const keyBorderless = `screen_${screenN}_borderless`
	const keyEdid = `screen_${screenN}_edid_override`
	const keyStretch = `screen_${screenN}_stretch`
	const keyKeyOnly = `screen_${screenN}_key_only`
	const keyAlwaysOnTop = `screen_${screenN}_always_on_top`
	const keyInteractive = `screen_${screenN}_interactive`
	const keySbsKey = `screen_${screenN}_sbs_key`
	const keyColourSpace = `screen_${screenN}_colour_space`
	const keyForceLinear = `screen_${screenN}_force_linear_filter`
	const keyMipmaps = `screen_${screenN}_enable_mipmaps`
	const keyHighBitdepth = `screen_${screenN}_high_bitdepth`
	const keyName = `screen_${screenN}_name`
	const keyAspectRatio = `screen_${screenN}_aspect_ratio`
	const keyPosX = `screen_${screenN}_x`
	const keyPosY = `screen_${screenN}_y`
	const keyForceOsRes = `screen_${screenN}_force_os_resolution`
	const windowedOn = cs[keyWindowed] !== false && cs[keyWindowed] !== 'false'
	const vsyncOn = cs[keyVsync] !== false && cs[keyVsync] !== 'false'
	const borderlessOn = cs[keyBorderless] === true || cs[keyBorderless] === 'true'
	const edidOverride = String(cs[keyEdid] || conn?.caspar?.edidOverride || '')
	const stretchVal = String(cs[keyStretch] || 'none')
	const keyOnlyOn = cs[keyKeyOnly] === true || cs[keyKeyOnly] === 'true'
	const alwaysOnTopOn = cs[keyAlwaysOnTop] !== false && cs[keyAlwaysOnTop] !== 'false'
	const interactiveOn = cs[keyInteractive] === true || cs[keyInteractive] === 'true'
	const sbsKeyOn = cs[keySbsKey] === true || cs[keySbsKey] === 'true'
	const colourSpaceVal = String(cs[keyColourSpace] || 'RGB')
	const forceLinearOn = cs[keyForceLinear] !== false && cs[keyForceLinear] !== 'false'
	const mipmapsOn = cs[keyMipmaps] === true || cs[keyMipmaps] === 'true'
	const highBitdepthOn = cs[keyHighBitdepth] === true || cs[keyHighBitdepth] === 'true'
	const screenName = String(cs[keyName] || '')
	const aspectRatio = String(cs[keyAspectRatio] || '')
	const posXVal = cs[keyPosX] ?? 0
	const posYVal = cs[keyPosY] ?? 0
	const wrapCtl = Object.assign(document.createElement('div'), { style: 'display:flex; flex-direction:column; gap:4px; margin-top:8px' })

	const saveRef = {}
	const runSave = () => void saveRef.invoke?.()

	appendGpuLayoutEditorIfEditMode(wrapCtl, { load, lastPayload })

	const fullscreenCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', title: 'Run in fullscreen mode' })
	const fullscreenIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	fullscreenIn.checked = !windowedOn
	fullscreenCk.append(fullscreenIn, document.createTextNode('Fullscreen'))
	const windowedCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', title: 'Run in windowed mode' })
	const windowedIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	windowedIn.checked = !!windowedOn
	windowedCk.append(windowedIn, document.createTextNode('Windowed'))
	const borderCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', title: 'Show window border' })
	const borderIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	borderIn.checked = !borderlessOn
	borderCk.append(borderIn, document.createTextNode('Border'))
	const vsyncCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', title: 'Sync with monitor refresh rate' })
	const vsyncIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	vsyncIn.checked = !!vsyncOn
	vsyncCk.append(vsyncIn, document.createTextNode('V-sync'))

	// Advanced screen consumer controls
	const stretchSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	stretchSel.innerHTML = ['none', 'fill', 'uniform', 'uniform_to_fill'].map((v) => `<option value="${v}"${v === stretchVal ? ' selected' : ''}>${v}</option>`).join('')
	stretchSel.addEventListener('change', runSave)

	const mkCk = (label, checked, title) => {
		const ck = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', title })
		const inp = Object.assign(document.createElement('input'), { type: 'checkbox' })
		inp.checked = !!checked
		inp.addEventListener('change', runSave)
		ck.append(inp, document.createTextNode(label))
		return { ck, inp }
	}
	const { ck: keyOnlyCk, inp: keyOnlyIn } = mkCk('Key only', keyOnlyOn, 'Output only key channel')
	const { ck: aotCk, inp: aotIn } = mkCk('Always on top', alwaysOnTopOn, 'Keep window always on top')
	const { ck: interactiveCk, inp: interactiveIn } = mkCk('Interactive', interactiveOn, 'Allow mouse/keyboard interaction')
	const { ck: sbsKeyCk, inp: sbsKeyIn } = mkCk('SBS Key', sbsKeyOn, 'Side-by-side key')
	const { ck: forceLinearCk, inp: forceLinearIn } = mkCk('Force linear filter', forceLinearOn, 'Force linear filtering')
	const { ck: mipmapsCk, inp: mipmapsIn } = mkCk('Enable mipmaps', mipmapsOn, 'Enable mipmaps for scaling')
	const { ck: highBitdepthCk, inp: highBitdepthIn } = mkCk('High bitdepth', highBitdepthOn, 'Use high bitdepth')

	const colourSpaceSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	colourSpaceSel.innerHTML = ['RGB', 'datavideo-full', 'datavideo-limited'].map((v) => `<option value="${v}"${v === colourSpaceVal ? ' selected' : ''}>${v}</option>`).join('')
	colourSpaceSel.addEventListener('change', runSave)

	const nameIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'Screen name (optional)', value: screenName })
	nameIn.addEventListener('change', runSave)
	const arIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'e.g. 16:9 or 1.7778', value: aspectRatio })
	arIn.addEventListener('change', runSave)
	const posXIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'number', placeholder: 'X', value: String(posXVal) })
	posXIn.style.width = '50%'
	posXIn.addEventListener('change', runSave)
	const posYIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'number', placeholder: 'Y', value: String(posYVal) })
	posYIn.style.width = '50%'
	posYIn.addEventListener('change', runSave)

	const gpuUi = populateGpuVideoModelineSection(wrapCtl, {
		saveRef,
		conn,
		lastPayload,
		cs,
		currentSettings,
		screenN,
		statusEl,
		load,
	})

	const {
		inherited,
		modeSel,
		customWidthIn,
		customHeightIn,
		customFpsIn,
		overrideResIn,
		timingSel,
		buildOsOutputPatchForApply,
		keyMode,
		keyCustomWidth,
		keyCustomHeight,
		keyCustomFps,
		keySystemId,
		keyOsMode,
		keyOsBackend,
		keyOsRate,
		keyOsTimingSource,
		timingRow,
		displayModeSelect,
		autoFromEdidBtn,
		osBackendSel,
		scheduleModelinePreview,
		detectedDisplay,
		overrideResRow,
	} = gpuUi

	const buildAdvancedPatch = () => ({
		[keyStretch]: stretchSel.value,
		[keyKeyOnly]: !!keyOnlyIn.checked,
		[keyAlwaysOnTop]: !!aotIn.checked,
		[keyInteractive]: !!interactiveIn.checked,
		[keySbsKey]: !!sbsKeyIn.checked,
		[keyColourSpace]: colourSpaceSel.value,
		[keyForceLinear]: !!forceLinearIn.checked,
		[keyMipmaps]: !!mipmapsIn.checked,
		[keyHighBitdepth]: !!highBitdepthIn.checked,
		[keyName]: nameIn.value.trim(),
		[keyAspectRatio]: arIn.value.trim(),
		[keyPosX]: parseInt(posXIn.value, 10) || 0,
		[keyPosY]: parseInt(posYIn.value, 10) || 0,
	})

	async function saveCasparSettings() {
		const vOverride = !!overrideResIn.checked
		const ts = timingSel.value === 'gtf' ? 'gtf' : timingSel.value === 'cvt_r' ? 'cvt_r' : 'cvt'
		const patch = {
			casparServer: {
				[keyWindowed]: !!windowedIn.checked,
				[keyVsync]: !!vsyncIn.checked,
				[keyBorderless]: !borderIn.checked,
				[keyMode]: inherited ? inherited.mode : String(modeSel.value || '1080p5000').trim(),
				[keyCustomWidth]: inherited ? inherited.width : Math.max(64, parseInt(String(customWidthIn.value || 1920), 10) || 1920),
				[keyCustomHeight]: inherited ? inherited.height : Math.max(64, parseInt(String(customHeightIn.value || 1080), 10) || 1080),
				[keyCustomFps]: inherited ? inherited.fps : Math.max(1, parseFloat(String(customFpsIn.value || 50)) || 50),
				[keyForceOsRes]: vOverride,
				[keyOsTimingSource]: ts,
				...buildAdvancedPatch(),
			},
			[keyForceOsRes]: vOverride,
			[keyOsTimingSource]: ts,
			...(vOverride ? buildOsOutputPatchForApply() : {}),
		}
		await Actions.saveSettingsPatch(patch)
		setCasparRestartDirty(true)
		setStatus(statusEl, `Settings for Screen ${screenN} saved`, true)
	}
	saveRef.invoke = saveCasparSettings

	fullscreenIn.addEventListener('change', () => {
		windowedIn.checked = !fullscreenIn.checked
		saveCasparSettings()
	})
	windowedIn.addEventListener('change', () => {
		fullscreenIn.checked = !windowedIn.checked
		saveCasparSettings()
	})
	borderIn.addEventListener('change', saveCasparSettings)
	vsyncIn.addEventListener('change', saveCasparSettings)

	const edidIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		placeholder: 'EDID override (optional)',
		value: edidOverride,
	})
	const saveGpuBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: `Apply resolution to the screen (Screen ${screenN})` })
	saveGpuBtn.onclick = async () => {
		const edidText = String(edidIn.value || '').trim()
		const selectedMode = inherited ? inherited.mode : String(modeSel.value || '1080p5000').trim()
		const isCustom = selectedMode === 'custom'
		const customWidth = inherited ? inherited.width : Math.max(64, parseInt(String(customWidthIn.value || 1920), 10) || 1920)
		const customHeight = inherited ? inherited.height : Math.max(64, parseInt(String(customHeightIn.value || 1080), 10) || 1080)
		const customFps = inherited ? inherited.fps : Math.max(1, parseFloat(String(customFpsIn.value || 50)) || 50)
		const modeText = isCustom ? 'custom' : selectedMode
		const ts = timingSel.value === 'gtf' ? 'gtf' : timingSel.value === 'cvt_r' ? 'cvt_r' : 'cvt'
		const outputPatch = {
			...buildOsOutputPatchForApply(),
			[keyOsTimingSource]: ts,
			[keyForceOsRes]: !!overrideResIn.checked,
		}
		const casparSlice = {
			[keyWindowed]: !!windowedIn.checked,
			[keyVsync]: !!vsyncIn.checked,
			[keyBorderless]: !borderIn.checked,
			[keyEdid]: edidText,
			[keyMode]: modeText,
			[keyCustomWidth]: customWidth,
			[keyCustomHeight]: customHeight,
			[keyCustomFps]: customFps,
			[keyForceOsRes]: !!overrideResIn.checked,
			[keyOsTimingSource]: ts,
			...buildAdvancedPatch(),
		}
		const patch = {
			casparServer: casparSlice,
			[keyForceOsRes]: !!overrideResIn.checked,
			...outputPatch,
		}
		await Actions.saveSettingsPatch(patch)
		await Actions.applyOsSettings({ ...outputPatch, casparServer: casparSlice })
		await Actions.updateConnector(conn.id, { caspar: { edidOverride: edidText, mode: modeText } })
		setCasparRestartDirty(true)
		setStatus(statusEl, `Applied resolution to the screen (Screen ${screenN})`, true)
		await load()
	}

	const resetBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn device-view__destinations-reset',
		textContent: 'Reset all settings for this screen',
		title: 'Clears CasparCG mode, windowed/vsync toggles, and OS-level system ID / resolution for this screen index.',
	})
	resetBtn.style.marginTop = '1rem'
	resetBtn.style.opacity = '0.7'
	resetBtn.onclick = async () => {
		if (!confirm(`Are you sure you want to reset all settings for Screen ${screenN}?`)) return
		const patch = {
			casparServer: {
				[keyMode]: null, [keyWindowed]: null, [keyVsync]: null, [keyBorderless]: null,
				[keyCustomWidth]: null, [keyCustomHeight]: null, [keyCustomFps]: null, [keyEdid]: null,
				[keySystemId]: null, [keyOsMode]: null, [keyOsRate]: null, [keyOsBackend]: null,
				[keyOsTimingSource]: null,
				[keyStretch]: null, [keyKeyOnly]: null, [keyAlwaysOnTop]: null, [keyInteractive]: null,
				[keySbsKey]: null, [keyColourSpace]: null, [keyForceLinear]: null, [keyMipmaps]: null,
				[keyHighBitdepth]: null,
				[keyName]: null, [keyAspectRatio]: null, [keyPosX]: null, [keyPosY]: null,
				[keyForceOsRes]: null,
			},
		}
		await Actions.saveSettingsPatch(patch)
		await load()
		setStatus(statusEl, `Settings for Screen ${screenN} cleared`, true)
	}

	const posRow = Object.assign(document.createElement('div'), { style: 'display:flex;gap:6px' })
	posRow.append(posXIn, posYIn)

	const minimalToggleRow = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links', style: 'margin: 4px 0; gap: 4px' })
	const mkSmallCk = (ckWrap) => {
		ckWrap.style.fontSize = '10px'
		ckWrap.style.padding = '2px 6px'
		ckWrap.style.opacity = '0.85'
		return ckWrap
	}
	minimalToggleRow.append(
		mkSmallCk(fullscreenCk), mkSmallCk(windowedCk), mkSmallCk(borderCk), mkSmallCk(vsyncCk),
		mkSmallCk(keyOnlyCk), mkSmallCk(aotCk),
		mkSmallCk(interactiveCk), mkSmallCk(sbsKeyCk), mkSmallCk(forceLinearCk), mkSmallCk(mipmapsCk), mkSmallCk(highBitdepthCk),
	)

	wrapCtl.append(
		minimalToggleRow,
		Object.assign(document.createElement('div'), { className: 'device-view__inspector-label', textContent: 'Video Mode', style: 'font-size:10px; opacity:0.7; margin-top:8px' }),
		modeSel,
		(() => {
			const d = Object.assign(document.createElement('div'), { style: 'display:flex; gap:4px; margin-top:4px' })
			d.append(customWidthIn, customHeightIn, customFpsIn)
			return d
		})(),
		timingRow,
		saveGpuBtn,
	)

	// Advanced settings hidden by default
	const advancedToggles = Object.assign(document.createElement('div'), { style: 'display:none' })
	const osBackendWrap = Object.assign(document.createElement('div'), { style: 'display:flex; flex-direction:column; gap:4px; margin:4px 0' })
	osBackendWrap.append(
		Object.assign(document.createElement('div'), {
			className: 'device-view__inspector-label',
			textContent: 'OS apply backend',
			style: 'font-size:10px; opacity:0.7',
		}),
		osBackendSel,
	)

	advancedToggles.append(
		Object.assign(document.createElement('hr'), { className: 'device-view__hr' }),
		Object.assign(document.createElement('div'), { className: 'device-view__inspector-label', textContent: 'OS / X11 Settings (xrandr)', style: 'font-size:10px; opacity:0.7' }),
		Object.assign(document.createElement('div'), { className: 'device-view__row', style: 'margin: 4px 0', innerHTML: `<small style="font-size:10px; opacity:0.6">Physical: ${detectedDisplay ? `<strong>${detectedDisplay.name}</strong>` : '<em>None</em>'}</small>` }),
		overrideResRow,
		osBackendWrap,
		displayModeSelect,
		autoFromEdidBtn,
		Object.assign(document.createElement('hr'), { className: 'device-view__hr' }),
		Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'Stretch', style: 'font-size:10px;opacity:.7' }), stretchSel,
		Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'Colour Space', style: 'font-size:10px;opacity:.7' }), colourSpaceSel,
		nameIn, arIn, posRow,
		resetBtn,
	)

	const showAdvancedBtn = Object.assign(document.createElement('button'), {
		className: 'device-view__inspector-link-btn',
		textContent: 'Show advanced consumer settings...',
		style: 'font-size:10px; margin-top:8px; opacity:0.6',
	})
	showAdvancedBtn.onclick = () => {
		advancedToggles.style.display = advancedToggles.style.display === 'none' ? 'block' : 'none'
		showAdvancedBtn.textContent = advancedToggles.style.display === 'none' ? 'Show advanced consumer settings...' : 'Hide advanced consumer settings'
		if (advancedToggles.style.display === 'block') scheduleModelinePreview()
	}

	wrapCtl.append(showAdvancedBtn, advancedToggles)
	h.append(wrapCtl)
}

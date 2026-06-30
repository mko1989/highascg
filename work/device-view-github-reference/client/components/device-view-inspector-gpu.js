/**
 * GPU Output controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { resolveGpuPhysicalScreenIndex, resolveGpuScreenNumber, gpuOutputIsMultiviewBound } from './device-view-inspector-gpu-resolve.js'
import { appendGpuLayoutEditorIfEditMode } from './device-view-inspector-gpu-layout-editor.js'
import { populateGpuVideoModelineSection } from './device-view-inspector-gpu-video-modeline.js'
import {
	SCREEN_CONSUMER_DEFAULTS,
	screenConsumerFlagsFromCasparServer,
	screenConsumerDefaultsSettingsPatch,
	screenConsumerKeysUnset,
	screenConsumerSeedCasparPatch,
	shouldSeedScreenConsumerDefaults,
	multiviewAlwaysOnTopFromCasparServer,
	multiviewConsumerDefaultsSettingsPatch,
	shouldSeedMultiviewAlwaysOnTopDefault,
} from '../lib/screen-consumer-defaults.js'

export function renderGpuOutControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty, connectorCtx }) {
	const cs = currentSettings?.casparServer && typeof currentSettings.casparServer === 'object' ? currentSettings.casparServer : {}
	// Video mode follows Caspar graph binding; per-jack consumer/OS keys follow rear port order.
	const screenN = resolveGpuScreenNumber(conn, lastPayload)
	const portN = resolveGpuPhysicalScreenIndex(conn, lastPayload)
	const osScreenN = portN
	const isMultiviewOutput = gpuOutputIsMultiviewBound(conn, lastPayload)
	const keyWindowed = `screen_${portN}_windowed`
	const keyVsync = `screen_${portN}_vsync`
	const keyBorderless = `screen_${portN}_borderless`
	const keyEdid = `screen_${screenN}_edid_override`
	const keyStretch = `screen_${portN}_stretch`
	const keyKeyOnly = `screen_${portN}_key_only`
	const keyAlwaysOnTop = isMultiviewOutput ? 'multiview_always_on_top' : `screen_${portN}_always_on_top`
	const keyInteractive = `screen_${portN}_interactive`
	const keySbsKey = `screen_${portN}_sbs_key`
	const keyColourSpace = `screen_${portN}_colour_space`
	const keyForceLinear = `screen_${portN}_force_linear_filter`
	const keyMipmaps = `screen_${portN}_enable_mipmaps`
	const keyHighBitdepth = `screen_${portN}_high_bitdepth`
	const keyName = `screen_${portN}_name`
	const keyAspectRatio = `screen_${portN}_aspect_ratio`
	const keyPosX = `screen_${portN}_x`
	const keyPosY = `screen_${portN}_y`
	const consumerSeedPatch = screenConsumerSeedCasparPatch(cs, portN)
	const seedMultiviewAlwaysOnTop = isMultiviewOutput && shouldSeedMultiviewAlwaysOnTopDefault(cs)
	if (Object.keys(consumerSeedPatch).length > 0 || seedMultiviewAlwaysOnTop) {
		const patch = { casparServer: { ...consumerSeedPatch } }
		if (seedMultiviewAlwaysOnTop) Object.assign(patch.casparServer, multiviewConsumerDefaultsSettingsPatch().casparServer)
		void Actions.saveSettingsPatch(patch).then(() => load?.())
	}
	const csForFlags = Object.keys(consumerSeedPatch).length ? { ...cs, ...consumerSeedPatch } : cs
	const consumerFlags = screenConsumerKeysUnset(csForFlags, portN)
		? SCREEN_CONSUMER_DEFAULTS
		: screenConsumerFlagsFromCasparServer(csForFlags, portN)
	const { windowed: windowedOn, vsync: vsyncOn, borderless: borderlessOn } = consumerFlags
	const edidOverride = String(cs[keyEdid] || conn?.caspar?.edidOverride || '')
	const stretchVal = String(cs[keyStretch] || 'none')
	const keyOnlyOn = cs[keyKeyOnly] === true || cs[keyKeyOnly] === 'true'
	const alwaysOnTopOn = isMultiviewOutput
		? (seedMultiviewAlwaysOnTop ? false : multiviewAlwaysOnTopFromCasparServer(cs))
		: cs[keyAlwaysOnTop] !== false && cs[keyAlwaysOnTop] !== 'false'
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
	const osSaveRef = {}
	const runSave = () => void saveRef.invoke?.()

	appendGpuLayoutEditorIfEditMode(wrapCtl, { load, lastPayload, statusEl })

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
		osSaveRef,
		conn,
		lastPayload,
		cs,
		currentSettings,
		screenN,
		osScreenN,
		statusEl,
		load,
	})

	const {
		inherited,
		cableFeedNote,
		casparScreenNote,
		modeSel,
		customWidthIn,
		customHeightIn,
		customFpsIn,
		overrideResIn,
		timingSel,
		buildGlobalOsSettingsPatchForSave,
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
		systemResolutionBlock,
		osBackendSel,
		scheduleModelinePreview,
		detectedDisplay,
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
		const selectedMode = String(modeSel.value || '1080p5000').trim()
		const isCustom = selectedMode === 'custom'
		await Actions.saveSettingsPatch({
			casparServer: {
				[keyWindowed]: !!windowedIn.checked,
				[keyVsync]: !!vsyncIn.checked,
				[keyBorderless]: !borderIn.checked,
				[keyMode]: isCustom ? 'custom' : selectedMode,
				[keyCustomWidth]: Math.max(64, parseInt(String(customWidthIn.value || 1920), 10) || 1920),
				[keyCustomHeight]: Math.max(64, parseInt(String(customHeightIn.value || 1080), 10) || 1080),
				[keyCustomFps]: Math.max(1, parseFloat(String(customFpsIn.value || 50)) || 50),
				...buildAdvancedPatch(),
			},
		})
		setCasparRestartDirty(true)
		setStatus(statusEl, `GPU port ${portN} (Caspar screen ${screenN}) saved`, true)
	}

	async function saveGlobalOsSettings() {
		await Actions.saveSettingsPatch(buildGlobalOsSettingsPatchForSave())
		setCasparRestartDirty(true)
	}

	saveRef.invoke = saveCasparSettings
	osSaveRef.invoke = saveGlobalOsSettings

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
	edidIn.addEventListener('change', saveCasparSettings)

	const resetBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn device-view__destinations-reset',
		textContent: 'Reset all settings for this screen',
		title: 'Clears CasparCG mode, windowed/vsync toggles, and OS-level system ID / resolution for this screen index.',
	})
	resetBtn.style.marginTop = '1rem'
	resetBtn.style.opacity = '0.7'
	resetBtn.onclick = async () => {
		if (!confirm(`Are you sure you want to reset all settings for GPU port ${portN}?`)) return
		const patch = {
			casparServer: {
				[keyMode]: null,
				...screenConsumerDefaultsSettingsPatch(portN).casparServer,
				[keyCustomWidth]: null, [keyCustomHeight]: null, [keyCustomFps]: null, [keyEdid]: null,
				[keySystemId]: null, [keyOsMode]: null, [keyOsRate]: null, [keyOsBackend]: null,
				[keyOsTimingSource]: null,
				[keyStretch]: null, [keyKeyOnly]: null, [keyAlwaysOnTop]: null, [keyInteractive]: null,
				[keySbsKey]: null, [keyColourSpace]: null, [keyForceLinear]: null, [keyMipmaps]: null,
				[keyHighBitdepth]: null,
				[keyName]: null, [keyAspectRatio]: null, [keyPosX]: null, [keyPosY]: null,
			},
		}
		await Actions.saveSettingsPatch(patch)
		await load()
		setStatus(statusEl, `Settings for GPU port ${portN} cleared`, true)
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

	const videoModeHdr = Object.assign(document.createElement('div'), {
		className: 'device-view__inspector-label',
		textContent: 'Video Mode',
		style: 'font-size:10px; opacity:0.7; margin-top:8px',
	})

	wrapCtl.append(
		minimalToggleRow,
		videoModeHdr,
		...(casparScreenNote ? [casparScreenNote] : []),
		...(cableFeedNote ? [cableFeedNote] : []),
		modeSel,
		(() => {
			const d = Object.assign(document.createElement('div'), { style: 'display:flex; gap:4px; margin-top:4px' })
			d.append(customWidthIn, customHeightIn, customFpsIn)
			return d
		})(),
		systemResolutionBlock,
		timingRow,
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
		Object.assign(document.createElement('div'), { className: 'device-view__row', style: 'margin: 4px 0', innerHTML: `<small style="font-size:10px; opacity:0.6">Physical: ${detectedDisplay ? `<strong>${detectedDisplay.name}</strong>` : '<em>None</em>'}${portN !== screenN ? ` · rear port ${portN} · Caspar screen ${screenN}` : ` · port / Caspar screen ${portN}`}</small>` }),
		osBackendWrap,
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

import { connectorIdFromEvent, setStatus } from './device-view-ui-utils.js'
import { renderCableOverlay } from './device-view-cables.js'
import { CASPAR_HOST } from './device-view-helpers.js'
import { showCasparConfigModal } from './caspar-config-modal.js'
import { openSaveDeviceSnapshotModal, openLoadDeviceSnapshotModal } from './device-view-snapshot-modals.js'
import { resolveProjectFpsFromSettings, defaultVideoModeForProjectFps } from '../lib/project-fps.js'
import { listHostChannelDestinations } from '../lib/device-view-host-channels.js'
import {
	screenConsumerSeedSettingsPatch,
	shouldSeedScreenConsumerDefaults,
} from '../lib/screen-consumer-defaults.js'
import * as Actions from './device-view-actions.js'

export function attachDeviceViewEvents(ctx) {
	const { refs, state, wrap } = ctx
	const {
		refreshBtn,
		resetBtn,
		applyCasparBtn,
		editCasparBtn,
		saveSnapBtn,
		loadSnapBtn,
		clearCableBtn,
		messinessSlider,
		messinessVal,
		destAdd,
		destType,
		statusEl,
	} = refs

	messinessSlider.oninput = () => {
		messinessVal.textContent = messinessSlider.value
		ctx.updateUI()
	}

	window.addEventListener('highascg-device-view-update-payload', (ev) => {
		if (ev.detail?.graph) {
			state.lastPayload = { ...state.lastPayload, graph: ev.detail.graph }
			ctx.renderFromState()
		}
	})

	saveSnapBtn.onclick = () =>
		openSaveDeviceSnapshotModal({
			getRearPanelEl: () => wrap.querySelector('.device-view__backpanel--caspar'),
			onStatus: (msg, ok) => setStatus(statusEl, msg, !!ok),
		})
	loadSnapBtn.onclick = () =>
		openLoadDeviceSnapshotModal({
			onApplied: () => {
				void ctx.load()
			},
			onStatus: (msg, ok) => setStatus(statusEl, msg, !!ok),
		})
	refreshBtn.onclick = () => ctx.load({ forceRefresh: true })
	resetBtn.onclick = () => ctx.resetCabling()
	applyCasparBtn.onclick = () =>
		Actions.applyCasparConfig()
			.then((r) => {
				ctx.setCasparRestartDirty(false)
				setStatus(statusEl, r.message || 'Caspar config applied', true)
			})
			.catch((e) => setStatus(statusEl, e?.message || String(e), false))
	editCasparBtn.onclick = () =>
		showCasparConfigModal({
			onApplied: () => {
				ctx.setCasparRestartDirty(false)
				return ctx.load()
			},
		})
	window.onresize = () => renderCableOverlay(ctx.getCOCtx())
	clearCableBtn.onclick = () => {
		state.cableSourceId = null
		state.cablePointer = null
		ctx.updateUI()
		setStatus(statusEl, 'Cable mode cancelled', true)
	}
	destAdd.onclick = () => {
		const rawType = destType.value
		if (String(rawType || '').startsWith('host:')) {
			const hostId = rawType.slice(5)
			const host = listHostChannelDestinations(state.lastPayload).find((h) => String(h?.id || '') === hostId)
			if (!host) {
				setStatus(statusEl, 'Host channel no longer available — refresh and try again.', false)
				return
			}
			void Actions.addDestination({
				type: 'host_channel',
				id: host.id,
				label: host.label,
				hostRole: host.hostRole,
				casparChannel: host.casparChannel,
				inputSlot: host.inputSlot,
				sourceId: host.sourceId,
			}).then(() => ctx.load())
			return
		}
		const list = Array.isArray(state.lastPayload?.screenDestinations?.destinations)
			? state.lastPayload.screenDestinations.destinations
			: []
		const highest = Math.max(-1, ...list.map((d) => Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0)))
		const type = rawType
		const newMainIdx = type === 'multiview' ? 0 : highest + 1
		const newScreenN = type === 'multiview' ? 0 : newMainIdx + 1
		// WO-242: pixelmap screens default to a raster-exact custom video-mode server-side
		// (screen-destinations.js normalizeDestination) — don't force a standard project mode here.
		void Actions.addDestination({
			type,
			mainScreenIndex: newMainIdx,
			...(type === 'pixelmap'
				? {}
				: { videoMode: defaultVideoModeForProjectFps(resolveProjectFpsFromSettings(state.currentSettings)) }),
		}).then(async () => {
			// Pixel-map screens drive a wall over Art-Net, not a GPU/monitor output — skip the
			// screen-consumer seeding used for physical PGM/PGM-only screens.
			if (newScreenN >= 1 && type !== 'pixelmap' && state.currentSettings) {
				const cs =
					state.currentSettings.casparServer && typeof state.currentSettings.casparServer === 'object'
						? state.currentSettings.casparServer
						: {}
				if (shouldSeedScreenConsumerDefaults(cs, newScreenN)) {
					await Actions.saveSettingsPatch(
						screenConsumerSeedSettingsPatch(cs, newScreenN, state.currentSettings),
					)
				}
			}
			ctx.setCasparRestartDirty(true)
			ctx.load()
		})
	}
	let cableOverlayRafPending = false
	window.addEventListener('pointermove', (ev) => {
		if (state.cableSourceId) {
			const br = wrap.getBoundingClientRect()
			state.cablePointer = { x: ev.clientX - br.left, y: ev.clientY - br.top }
			if (cableOverlayRafPending) return
			cableOverlayRafPending = true
			requestAnimationFrame(() => {
				cableOverlayRafPending = false
				if (state.cableSourceId) renderCableOverlay(ctx.getCOCtx())
			})
		}
	})
	document.addEventListener('keydown', (ev) => {
		const isZ = ev.key?.toLowerCase() === 'z'
		const isUndo = isZ && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey
		if (isUndo) {
			ev.preventDefault()
			ev.stopPropagation()
			void ctx.undoLastCableAction()
			return
		}
		if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.selectedEdgeId) {
			const target = ev.target
			if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
			ev.preventDefault()
			ev.stopPropagation()
			void ctx.removeEdge(state.selectedEdgeId)
		}
	})
	document.addEventListener(
		'click',
		(ev) => {
			if (!state.cableSourceId || Date.now() < state.suppressDocCableClickUntil) return
			const targetId = connectorIdFromEvent(ev, wrap)
			if (targetId) {
				if (targetId !== state.cableSourceId) {
					ev.preventDefault()
					ev.stopPropagation()
					void ctx.tryAddCable(targetId)
				}
				return
			}
			state.cableSourceId = null
			state.cablePointer = null
			ctx.updateUI()
			setStatus(statusEl, 'Cable mode cancelled', true)
		},
		true,
	)
	document.addEventListener('highascg-settings-applied', () => ctx.load())
	window.addEventListener('highascg-device-view-reload', () => ctx.load())
	window.addEventListener('highascg-device-view-focus-connector', (ev) => {
		const cid = String(ev?.detail?.connectorId || '').trim()
		if (cid) ctx.focusConnectorById(cid)
	})
	window.addEventListener('highascg-device-view-focus-device', (ev) => {
		if (ev.detail?.deviceId) ctx.selectDevice(ev.detail.deviceId, state.lastPayload?.live)
	})
	window.addEventListener('highascg-device-view-focus-server', () => ctx.selectDevice(CASPAR_HOST, state.lastPayload?.live))
	window.addEventListener('highascg-caspar-restart-dirty', () => ctx.setCasparRestartDirty(true))
}

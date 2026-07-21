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
import { nextMainScreenIndex } from '../lib/screen-destination-index.js'
import { rafThrottle } from '../lib/raf-throttle.js'
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
				void ctx.load({ forceRefresh: true })
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
				return ctx.load({ forceRefresh: true })
			},
		})
	window.onresize = rafThrottle(() => renderCableOverlay(ctx.getCOCtx()))
	clearCableBtn.onclick = () => {
		const wasRegrab = !!state.cableRegrab
		ctx.clearCableGesture()
		ctx.updateUI()
		// WO-278: a held cable end was never unpatched on the server, so cancelling just redraws it.
		setStatus(statusEl, wasRegrab ? 'Cable re-grab cancelled — connection left as it was.' : 'Cable mode cancelled', true)
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
			}).then(() => ctx.load({ forceRefresh: true }))
			return
		}
		const list = Array.isArray(state.lastPayload?.screenDestinations?.destinations)
			? state.lastPayload.screenDestinations.destinations
			: []
		const type = rawType
		// Counts MAIN destinations only (see screen-destination-index.js). Counting the factory
		// operator_gui at index 0 made the first real screen land at index 1, and the generator
		// filled the gap with a phantom Screen 1 PGM+PRV pair.
		const newMainIdx = nextMainScreenIndex(list, type)
		const newScreenN = (type === 'multiview' || type === 'operator_gui') ? 0 : newMainIdx + 1
		// WO-242/WO-243: pixelmap and operator_gui screens default to a raster-exact custom video-mode
		// server-side (screen-destinations.js normalizeDestination) — don't force a standard project
		// mode here.
		void Actions.addDestination({
			type,
			mainScreenIndex: newMainIdx,
			...(type === 'pixelmap' || type === 'operator_gui'
				? {}
				: { videoMode: defaultVideoModeForProjectFps(resolveProjectFpsFromSettings(state.currentSettings)) }),
		}).then(async () => {
			// Pixel-map screens drive a wall over Art-Net, and operator_gui drives its own resolved
			// monitor — neither wants the sequential-screen-numbered GPU/monitor consumer seeding used
			// for physical PGM/PGM-only screens (newScreenN is already 0 for operator_gui above, but
			// keep the explicit type check here for the same honesty pixelmap's guard has).
			if (newScreenN >= 1 && type !== 'pixelmap' && type !== 'operator_gui' && state.currentSettings) {
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
			/* The destination was just created server-side, so this reload MUST refetch. A plain
			 * ctx.load() is served from the 5s payload cache, and on a hit the new destination is
			 * simply absent from the re-render — the operator sees nothing until they hit Refresh
			 * (which forces). That is the "does not always show up straight away" report: it only
			 * misses when a snapshot was fetched within the preceding 5 seconds. */
			ctx.load({ forceRefresh: true })
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
		// WO-278: Escape restores a held cable end (and cancels a plain armed cable). Nothing was
		// persisted during the gesture, so this is a pure client-side redraw.
		if (ev.key === 'Escape' && (state.cableSourceId || state.cableRegrab)) {
			const wasRegrab = !!state.cableRegrab
			ev.preventDefault()
			ctx.clearCableGesture()
			ctx.updateUI()
			setStatus(statusEl, wasRegrab ? 'Cable re-grab cancelled — connection left as it was.' : 'Cable mode cancelled', true)
			return
		}
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
			// Empty space. This is the app's existing cancel gesture, NOT its delete affordance
			// (that is select-the-cable + Delete, or the edge inspector's remove button), so a
			// held cable end is restored here rather than disconnected — WO-278.
			const wasRegrab = !!state.cableRegrab
			ctx.clearCableGesture()
			ctx.updateUI()
			setStatus(statusEl, wasRegrab ? 'Cable re-grab cancelled — connection left as it was.' : 'Cable mode cancelled', true)
		},
		true,
	)
	/* Both of these fire BECAUSE the config just changed — loading a project applies its hardware
	 * slice and then dispatches settings-applied. A plain ctx.load() consults the 5s payload cache
	 * and, on a hit, re-renders the pre-apply snapshot without fetching at all, so the freshly
	 * loaded Device View settings never appear. An explicit "this changed" signal must never be
	 * answered from cache. */
	document.addEventListener('highascg-settings-applied', () => ctx.load({ forceRefresh: true }))
	window.addEventListener('highascg-device-view-reload', () => ctx.load({ forceRefresh: true }))
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

/**
 * Device view orchestrator — thin wiring for WO-112 split modules.
 */
import { renderCableOverlay } from './device-view-cables.js'
import { getAppWs } from '../lib/app-runtime.js'
import { buildDeviceViewShell, registerViewMode } from './device-view-toolbar.js'
import { registerDeviceViewSelection } from './device-view-selection.js'
import { registerDeviceViewCable } from './device-view-cable.js'
import { registerDeviceViewRender } from './device-view-render.js'
import { attachDeviceViewEvents } from './device-view-events.js'

let mounted = false
let onTabActivated = null

export function onDeviceViewTabActivated() {
	onTabActivated?.()
}

export function initDeviceView(root) {
	if (!root || mounted) return
	mounted = true

	const refs = buildDeviceViewShell(root)
	const gHost = document.getElementById('panel-inspector-scroll') || document.getElementById('panel-inspector-body')
	if (gHost) refs.wrap.classList.add('device-view--external-inspector')

	const state = {
		lastPayload: null,
		selectedKey: null,
		selectedConnectorId: null,
		selectedEdgeId: null,
		selectedDestinationId: null,
		selectedDeviceId: null,
		cableSourceId: null,
		hoveredEdgeId: null,
		casparRestartDirty: false,
		cablePointer: null,
		// WO-278: set while an existing cable is held by one end. Purely client-side — the
		// original edge stays in the server graph until a valid target is committed.
		cableRegrab: null,
		suppressDocCableClickUntil: 0,
		currentSettings: null,
		streamingStatus: null,
		undoStack: [],
	}

	const ctx = { refs, state, wrap: refs.wrap, gHost }

	registerDeviceViewSelection(ctx)
	registerDeviceViewCable(ctx)
	registerDeviceViewRender(ctx)
	registerViewMode(ctx)
	attachDeviceViewEvents(ctx)

	ctx.syncSimpleWiringMode?.()
	ctx.syncMatrixMode?.()

	onTabActivated = () => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => renderCableOverlay(ctx.getCOCtx()))
		})
	}

	void ctx.load()
	getAppWs()?.send?.({ type: 'device_view_subscribe' })
}

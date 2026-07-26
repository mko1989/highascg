import { buildInspectorTable, roleLabel } from './device-view-ui-utils.js'
import { mountWebpageHostPageControls } from './inspector-webpage-host.js'
import { mountNdiHostSourceControls } from './inspector-ndi-host.js'
import { mountBrowserDisplayControls, mountBrowserDisplayInteractToggle } from './inspector-browser-display.js'
import { mountDecklinkHostSourceControls } from './inspector-decklink-host.js'
import {
	findExtraLiveSourceForHostDestination,
	decklinkSlotFromHostDestination,
	liveAudioSlotFromHostDestination,
	v4l2SlotFromHostDestination,
} from '../lib/device-view-host-channels.js'
import { removeDecklinkInputSlot } from '../lib/decklink-add-input.js'
import { removeExtraLiveHostSource } from '../lib/extra-live-source-remove.js'
import { removeLiveAudioInputSlot } from '../lib/live-audio-remove-input.js'
import { mountLiveAudioSlotControls } from './inspector-live-audio-input.js'
import { removeV4l2InputSlot } from '../lib/v4l2-remove-input.js'
import { markCasparRestartDirty } from '../lib/caspar-restart-hint.js'

/**
 * Render and handle host-channel / virtual destination inspector branch.
 * Returns true when handled.
 */
export function renderHostChannelDestinationInspector({
	host,
	d,
	mode,
	intent,
	mappedOutputEdges,
	connectorById,
	removeDestination,
	currentSettings,
	lastPayload,
	onWebpageHostApplied,
	onHostInputRemoved,
}) {
	if (!(mode === 'host_channel' || d?.virtual === true)) return false

	const role = d?.hostRole || intent?.hostRole
	const ch = d?.casparChannel ?? intent?.pgmChannel
	const inputEntry = (Array.isArray(lastPayload?.live?.caspar?.channelMap?.inputChannels)
		? lastPayload.live.caspar.channelMap.inputChannels
		: []
	).find((e) => Number(e?.channel) === Number(ch) && (e?.kind === role || !role))
	const extraLive = Array.isArray(lastPayload?.extraLiveSources) ? lastPayload.extraLiveSources : []
	const liveSource = findExtraLiveSourceForHostDestination(d, role, ch, extraLive)
	const rows = [
		{ label: 'Label', value: String(d?.label || d?.id || 'Host channel') },
		{ label: 'Type', value: roleLabel({ role }) },
		{ label: 'Caspar channel', value: String(ch ?? '-') },
	]
	if (inputEntry?.layer != null) rows.push({ label: 'Host layer', value: String(inputEntry.layer) })
	if (inputEntry?.route) rows.push({ label: 'Route', value: String(inputEntry.route) })
	if (liveSource?.sourceId) rows.push({ label: 'Source ID', value: String(liveSource.sourceId) })
	host.append(buildInspectorTable(rows))
	if (role === 'webpage_host' && liveSource) {
		mountWebpageHostPageControls(host, {
			source: liveSource,
			onApplied: (r) => {
				if (Array.isArray(r?.extraLiveSources)) {
					lastPayload.extraLiveSources = r.extraLiveSources
				}
				onWebpageHostApplied?.(r, liveSource)
			},
		})
	}
	if (role === 'ndi_host' && liveSource) {
		mountNdiHostSourceControls(host, {
			source: liveSource,
			onApplied: (r) => {
				if (Array.isArray(r?.extraLiveSources)) {
					lastPayload.extraLiveSources = r.extraLiveSources
				}
			},
		})
	}
	if (role === 'browser_display' && liveSource) {
		mountBrowserDisplayControls(host, {
			source: liveSource,
			onApplied: (r) => {
				if (Array.isArray(r?.extraLiveSources)) {
					lastPayload.extraLiveSources = r.extraLiveSources
				}
			},
		})
		mountBrowserDisplayInteractToggle(host, {
			source: liveSource,
			onApplied: (r) => {
				if (Array.isArray(r?.extraLiveSources)) {
					lastPayload.extraLiveSources = r.extraLiveSources
				}
			},
		})
	}
	if (role === 'decklink_input') {
		// Owner request 2026-07-26: dedicated DeckLink slots (no extraLiveSources entry →
		// liveSource null) must still get the device switcher — the server path stops the host
		// channel and PLAYs the newly selected DECKLINK device.
		const slot = decklinkSlotFromHostDestination(d) || liveSource?.decklinkSlot
		if (slot) {
			mountDecklinkHostSourceControls(host, {
				source: liveSource || null,
				slot,
				lastPayload,
				currentSettings,
				onApplied: (r) => {
					if (Array.isArray(r?.extraLiveSources)) {
						lastPayload.extraLiveSources = r.extraLiveSources
					}
				},
			})
		}
	}
	const note = document.createElement('p')
	note.className = 'device-view__note'
	note.textContent =
		role === 'webpage_host'
			? 'Persistent webpage host — Caspar plays HTML with LOOP on this channel. Drag route:// onto PGM or multiview for on-air; clearing the route does not destroy page state. Cable to Record or Stream to capture this bus.'
			: role === 'browser_display'
				? 'Browser source — real Firefox window running off-screen, captured via x11grab and relayed as MPEG-TS. Use the Inspector to edit URL/dimensions and toggle between background and operator monitor. Drag route:// onto PGM or multiview for on-air.'
				: role === 'ndi_host' || role === 'decklink_input'
					? ''
					: role === 'live_audio_input'
					? 'Dedicated live-audio input host channel. Cable to Record or Stream to capture that ALSA/USB input bus.'
					: role === 'v4l2_input'
						? 'Dedicated USB / V4L2 video host channel. FFmpeg bridge feeds MPEG-TS into Caspar; cable to Record or Stream to capture that input directly.'
						: role === 'inputs_host'
							? 'Dedicated inputs host bus — Caspar plays DeckLink / live audio here so layers can route:// it everywhere. Cable this to Record or Stream on the rear panel to capture that bus directly.'
							: role === 'streaming_channel'
								? 'Encode / streaming bus — RTMP and file record consumers attach here. Cable another destination (e.g. PGM) into Stream on the rear panel, or cable this host channel to Record to file from the encode bus.'
								: 'Auxiliary Caspar channel. Cable to Record or Stream outputs on the rear panel.'
	if (note.textContent) host.append(note)
	if (mappedOutputEdges.length) {
		const outputMapWrap = document.createElement('div')
		outputMapWrap.className = 'device-view__kv'
		const outputMapTitle = document.createElement('div')
		outputMapTitle.className = 'device-view__kv-row'
		outputMapTitle.innerHTML = '<span class="device-view__kv-key">Cabled to</span><span class="device-view__kv-val"></span>'
		outputMapWrap.appendChild(outputMapTitle)
		for (const edge of mappedOutputEdges) {
			const c = connectorById.get(String(edge?.sinkId || '')) || null
			const row = document.createElement('div')
			row.className = 'device-view__kv-row'
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = 'device-view__inspector-link-btn'
			btn.textContent = String(c?.label || edge?.sinkId || 'Output')
			btn.onclick = () => {
				window.dispatchEvent(new CustomEvent('highascg-device-view-focus-connector', {
					detail: { connectorId: edge.sinkId },
				}))
			}
			row.append(btn)
			outputMapWrap.appendChild(row)
		}
		host.append(outputMapWrap)
	}
	if (role === 'decklink_input') {
		const rmBtn = document.createElement('button')
		rmBtn.type = 'button'
		rmBtn.className = 'header-btn'
		rmBtn.style.marginTop = '10px'
		rmBtn.textContent = 'Remove DeckLink input'
		rmBtn.addEventListener('click', async () => {
			const slot = decklinkSlotFromHostDestination(d)
			if (!slot) return
			const label = String(d?.label || `DeckLink input ${slot}`)
			if (
				!confirm(
					`Remove "${label}"?\n\nStops SDI capture, removes the live source, clears cables from this host channel, and frees the DeckLink port.`,
				)
			) {
				return
			}
			rmBtn.disabled = true
			try {
				const r = await removeDecklinkInputSlot(null, {
					slot,
					connectorId: liveSource?.connectorId,
					liveSourceValue: liveSource?.value,
					destinationId: String(d?.id || ''),
				})
				if (typeof onHostInputRemoved === 'function') {
					await onHostInputRemoved(d, r)
				} else {
					await removeDestination(d.id)
				}
			} catch (e) {
				window.alert(e?.message || String(e))
				rmBtn.disabled = false
			}
		})
		host.append(rmBtn)
	} else if (role === 'ndi_host' && liveSource) {
		const rmBtn = document.createElement('button')
		rmBtn.type = 'button'
		rmBtn.className = 'header-btn'
		rmBtn.style.marginTop = '10px'
		rmBtn.textContent = 'Remove NDI source'
		rmBtn.addEventListener('click', async () => {
			const label = String(liveSource.label || liveSource.ndiName || 'NDI source')
			if (!confirm(`Remove "${label}" from Live sources?`)) return
			rmBtn.disabled = true
			try {
				await removeExtraLiveHostSource(liveSource)
				if (typeof onHostInputRemoved === 'function') {
					await onHostInputRemoved(d, { ok: true })
				} else {
					await removeDestination(d.id)
				}
			} catch (e) {
				window.alert(e?.message || String(e))
				rmBtn.disabled = false
			}
		})
		host.append(rmBtn)
	} else if (role === 'browser_display' && liveSource) {
		const rmBtn = document.createElement('button')
		rmBtn.type = 'button'
		rmBtn.className = 'header-btn'
		rmBtn.style.marginTop = '10px'
		rmBtn.textContent = 'Remove browser source'
		rmBtn.addEventListener('click', async () => {
			const label = String(liveSource.label || liveSource.url || 'Browser source')
			if (!confirm(`Remove "${label}" from Live sources?`)) return
			rmBtn.disabled = true
			try {
				await removeExtraLiveHostSource(liveSource, lastPayload?.hostOperatorFullscreen)
				if (typeof onHostInputRemoved === 'function') {
					await onHostInputRemoved(d, { ok: true })
				} else {
					await removeDestination(d.id)
				}
			} catch (e) {
				window.alert(e?.message || String(e))
				rmBtn.disabled = false
			}
		})
		host.append(rmBtn)
	} else if (role === 'webpage_host' && liveSource) {
		const rmBtn = document.createElement('button')
		rmBtn.type = 'button'
		rmBtn.className = 'header-btn'
		rmBtn.style.marginTop = '10px'
		rmBtn.textContent = 'Remove webpage source'
		rmBtn.addEventListener('click', async () => {
			const label = String(liveSource.label || liveSource.playArg || 'Webpage host')
			if (!confirm(`Remove "${label}" from Live sources?`)) return
			rmBtn.disabled = true
			try {
				await removeExtraLiveHostSource(liveSource, lastPayload?.hostOperatorFullscreen)
				if (typeof onHostInputRemoved === 'function') {
					await onHostInputRemoved(d, { ok: true })
				} else {
					await removeDestination(d.id)
				}
			} catch (e) {
				window.alert(e?.message || String(e))
				rmBtn.disabled = false
			}
		})
		host.append(rmBtn)
	} else if (role === 'live_audio_input') {
		const slot = liveAudioSlotFromHostDestination(d)
		if (slot != null) {
			// WO-336: full per-slot controls (device change, shader-FFT source, Start/Stop) live
			// HERE — the owner reaches inputs through the device view, not the mixer inspector.
			mountLiveAudioSlotControls(host, {
				slot,
				channel: ch ?? null,
				layer: inputEntry?.layer ?? null,
				route: inputEntry?.route || null,
			})
			const rmBtn = document.createElement('button')
			rmBtn.type = 'button'
			rmBtn.className = 'header-btn'
			rmBtn.style.marginTop = '10px'
			rmBtn.textContent = 'Remove live audio input'
			rmBtn.addEventListener('click', async () => {
				if (!confirm(`Remove live audio slot ${slot}?`)) return
				rmBtn.disabled = true
				try {
					const r = await removeLiveAudioInputSlot(null, slot)
					markCasparRestartDirty()
					if (typeof onHostInputRemoved === 'function') {
						await onHostInputRemoved(d, r)
					} else {
						await removeDestination(d.id)
					}
				} catch (e) {
					window.alert(e?.message || String(e))
					rmBtn.disabled = false
				}
			})
			host.append(rmBtn)
		}
	} else if (role === 'v4l2_input') {
		const slot = v4l2SlotFromHostDestination(d)
		if (slot != null) {
			const rmBtn = document.createElement('button')
			rmBtn.type = 'button'
			rmBtn.className = 'header-btn'
			rmBtn.style.marginTop = '10px'
			rmBtn.textContent = 'Remove USB video input'
			rmBtn.addEventListener('click', async () => {
				if (!confirm(`Remove USB video slot ${slot}?`)) return
				rmBtn.disabled = true
				try {
					const r = await removeV4l2InputSlot(null, slot)
					if (typeof onHostInputRemoved === 'function') {
						await onHostInputRemoved(d, r)
					} else {
						await removeDestination(d.id)
					}
				} catch (e) {
					window.alert(e?.message || String(e))
					rmBtn.disabled = false
				}
			})
			host.append(rmBtn)
		}
	}
	return true
}

/**
 * Port Bands Rendering for Device View.
 */
import { setStatus } from './device-view-ui-utils.js'
import { portAudioOutputId } from '../lib/program-audio-layouts.js'
import * as Actions from './device-view-actions.js'
import { saveVirtualCameraConfig, stopVirtualCamera } from '../lib/virtual-camera-state.js'
import { renderCasparBand } from './device-view-caspar-render.js'
import { renderCasparBandSimple } from './device-view-caspar-render-simple.js'
import { renderMappingsBand } from './device-view-mappings-render.js'
import { nextNumberedIndex } from '../lib/next-numbered-id.js'

function appendSegment(parent, title) {
	const sec = document.createElement('section')
	sec.className = 'device-view__segment'
	const body = document.createElement('div')
	body.className = 'device-view__segment-body'
	const t = String(title || '').trim()
	if (t) {
		const h = document.createElement('h2')
		h.className = 'device-view__segment-title'
		h.textContent = t
		sec.append(h, body)
	} else {
		sec.append(body)
	}
	parent.append(sec)
	return body
}

export function renderBands(mappingPanel, rearPanel, ctx, { currentSettings, statusEl, load, setCasparRestartDirty }) {
	mappingPanel.innerHTML = ''; rearPanel.innerHTML = ''; const live = ctx.live; if (!live) return
	const internalCtx = {
		...ctx,
		currentSettings,
		statusEl,
		load,
		setCasparRestartDirty,
		onAddStreamOutput: async () => {
			try {
				/* WO-474: no phantom str_1 — with zero outputs the first Add must create Str1, not Str2. */
				const cur = Array.isArray(currentSettings?.streamOutputs) ? currentSettings.streamOutputs : [];
				const idx = nextNumberedIndex(cur, 'str'); // WO-844: max+1, not length+1 (duplicate id after a removal)
				const next = [...cur, { id: `str_${idx}`, label: `Str${idx}`, enabled: true, type: 'rtmp', name: `Str${idx}`, quality: 'medium', rtmpServerUrl: '', streamKey: '', srtUrl: '' }];
				await Actions.saveSettingsPatch({ streamOutputs: next });
				setStatus(statusEl, `Added stream output Str${idx}`, true);
				/* WO-480: ctx.load() serves a 5s cache and skips the fetch entirely on a hit — right
				 * after a save that is always a hit, so the new band did not appear until the cache
				 * aged out. Every mutation here re-reads for real. */
				await load({ forceRefresh: true })
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onAddRecordOutput: async () => {
			try {
				/* WO-473: no phantom rec_1 — with zero outputs the first Add must create Rec1, not Rec2. */
				const cur = Array.isArray(currentSettings?.recordOutputs) ? currentSettings.recordOutputs : [];
				const idx = nextNumberedIndex(cur, 'rec');
				const next = [...cur, { id: `rec_${idx}`, label: `Rec${idx}`, enabled: true, name: `Rec${idx}`, source: 'program_1', crf: 26 }];
				await Actions.saveSettingsPatch({ recordOutputs: next });
				setStatus(statusEl, `Added record output Rec${idx}`, true);
				await load({ forceRefresh: true })
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onRemoveStreamOutput: async (id) => {
			try {
				const cur = Array.isArray(currentSettings?.streamOutputs) ? currentSettings.streamOutputs : []
				const next = cur.filter(s => String(s.id) !== String(id))
				await Actions.saveSettingsPatch({ streamOutputs: next })
				setStatus(statusEl, 'Stream output removed', true)
				await load({ forceRefresh: true })
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onRemoveRecordOutput: async (id) => {
			try {
				const cur = Array.isArray(currentSettings?.recordOutputs) ? currentSettings.recordOutputs : []
				const next = cur.filter(s => String(s.id) !== String(id))
				await Actions.saveSettingsPatch({ recordOutputs: next })
				setStatus(statusEl, 'Record output removed', true)
				await load({ forceRefresh: true })
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onAddAudioOutput: async () => {
			try {
				const cur = Array.isArray(currentSettings?.audioOutputs) ? currentSettings.audioOutputs : [];
				const idx = nextNumberedIndex(cur, 'audio');
				// WO-683: one PortAudio output per server — later ones start as System Audio (OAL).
				const type = portAudioOutputId(cur) ? 'system-audio' : 'portaudio';
				const next = [...cur, { id: `audio_${idx}`, label: `Audio ${idx}`, enabled: true, type, deviceName: '', channelLayout: 'stereo' }];
				await Actions.saveSettingsPatch({ audioOutputs: next });
				setStatus(statusEl, `Added audio output Audio ${idx}`, true);
				await load({ forceRefresh: true })
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onRemoveAudioOutput: async (id) => {
			try {
				const cur = Array.isArray(currentSettings?.audioOutputs) ? currentSettings.audioOutputs : []
				const next = cur.filter(s => String(s.id) !== String(id))
				await Actions.saveSettingsPatch({ audioOutputs: next })
				setStatus(statusEl, 'Audio output removed', true)
				await load({ forceRefresh: true })
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		onAddVirtualCamOutput: async () => {
			try {
				await saveVirtualCameraConfig(
					{
						showInDeviceView: true,
						label: 'Virtual cam',
						channel: 1,
						device: '/dev/video10',
						width: 1920,
						height: 1080,
						fps: 50,
						audioEnabled: true,
					},
					{ persist: true },
				)
				setStatus(statusEl, 'Virtual camera output added', true)
				await load({ forceRefresh: true })
			} catch (e) {
				setStatus(statusEl, e.message, false)
			}
		},
		onRemoveVirtualCamOutput: async (id) => {
			const cid = String(id || 'vcam_1').trim() || 'vcam_1'
			try {
				try {
					await stopVirtualCamera({ persist: false })
				} catch {
					/* best-effort */
				}
				await saveVirtualCameraConfig({ showInDeviceView: false, enabled: false }, { persist: true })
				const g = ctx.lastPayload?.graph ? JSON.parse(JSON.stringify(ctx.lastPayload.graph)) : null
				if (g) {
					g.edges = (Array.isArray(g.edges) ? g.edges : []).filter(
						(e) => String(e.sourceId) !== cid && String(e.sinkId) !== cid,
					)
					g.connectors = (Array.isArray(g.connectors) ? g.connectors : []).filter((c) => String(c?.id) !== cid)
					await Actions.saveDeviceGraph(g)
				}
				setStatus(statusEl, 'Virtual camera output removed', true)
				await load({ forceRefresh: true })
			} catch (e) {
				setStatus(statusEl, e.message, false)
			}
		},
		onAddMappingNode: async () => {
			try {
				await Actions.addMappingNode()
				setCasparRestartDirty?.(true)
				setStatus(statusEl, 'Added pixel mapping node', true)
				await load({ forceRefresh: true })
			} catch (e) { setStatus(statusEl, e.message, false) }
		},
		mappingPersist: async (work) => {
			try {
				const r = await work()
				if (!r?.ok) {
					setStatus(statusEl, r?.error || 'Mapping save failed', false)
					return
				}
				setCasparRestartDirty?.(true)
				setStatus(statusEl, 'Mapping updated', true)
				await load({ forceRefresh: true })
			} catch (e) {
				setStatus(statusEl, e?.message || String(e), false)
			}
		},
		onApplyGpuSettings: async () => {
			try {
				setStatus(statusEl, 'Applying GPU layout...', true)
				const res = await Actions.applyOsSettings()
				if (res?.ok) {
					const applied = !!res.layoutApplied
					const persisted = !!res.layoutPersisted
					const cmd = typeof res.xrandrCommand === 'string' && res.xrandrCommand.trim() ? res.xrandrCommand.trim() : ''
					if (applied && persisted) {
						setStatus(statusEl, cmd ? `Applied xrandr and persisted.\n${cmd}` : 'Applied xrandr layout and persisted reboot script', true)
					} else if (applied && !persisted) {
						setStatus(statusEl, cmd ? `xrandr applied; persist failed.\n${cmd}` : 'xrandr layout applied, but persisting the reboot script failed (check server logs / sudo)', false)
					} else {
						setStatus(
							statusEl,
							cmd
								? `No xrandr apply reported.\nPlanned: ${cmd}`
								: 'Apply-os finished but no xrandr change ran (no mapped outputs, xrandr query failed, or apply failed — see server [OS-Config] / [settings-os] logs). Settings were still saved.',
							false
						)
					}
				} else {
					throw new Error(res?.error || 'Apply failed')
				}
				await load({ forceRefresh: true })
			} catch (e) { setStatus(statusEl, e?.message || String(e), false) }
		}
	}
	const proc = appendSegment(mappingPanel, '')
	proc.append(renderMappingsBand(internalCtx))

	const eq = appendSegment(rearPanel, '')
	eq.parentElement?.classList.add('device-view__segment--rear-only')
	eq.append(ctx.simpleWiring ? renderCasparBandSimple(internalCtx) : renderCasparBand(internalCtx))
}

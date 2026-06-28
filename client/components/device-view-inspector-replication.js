/**
 * Device View — server inspector hot backup section (WO-54 operator UX).
 */
import { api } from '../lib/api-client.js'
import { setStatus, buildInspectorTable } from './device-view-ui-utils.js'
import { showAppToast } from '../lib/app-toast.js'
import { refreshReplicationStatusSoon, getReplicationInspectorMode, setReplicationInspectorMode } from '../lib/replication-ui-state.js'

/**
 * @param {HTMLElement} host
 * @param {{ statusEl: HTMLElement, load: () => Promise<void> }} ctx
 */
export function renderReplicationInspector(host, ctx) {
	const sec = document.createElement('div')
	sec.className = 'device-view__inspector-section device-view__replication-section'
	sec.innerHTML = '<p class="device-view__note"><strong>Hot backup</strong></p>'

	const statusLine = document.createElement('p')
	statusLine.className = 'device-view__note small device-view__replication-status'
	statusLine.textContent = 'Loading replication status…'

	const connectionDetails = document.createElement('details')
	connectionDetails.className = 'device-view__inspector-section device-view__replication-connection'
	connectionDetails.open = true
	connectionDetails.hidden = true
	const connectionSummary = document.createElement('summary')
	connectionSummary.className = 'device-view__note'
	connectionSummary.innerHTML = '<strong>Connection</strong>'
	connectionDetails.append(connectionSummary)

	const channelParityLine = document.createElement('p')
	channelParityLine.className = 'device-view__note small device-view__replication-channel-parity'
	channelParityLine.hidden = true

	const casparParityLine = document.createElement('p')
	casparParityLine.className = 'device-view__note small device-view__replication-caspar-parity'
	casparParityLine.hidden = true

	const connectionActions = document.createElement('div')
	connectionActions.className = 'device-view__replication-actions'
	const refreshConnBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Refresh connection',
		title: 'Reconnect peer HTTP, live-state WebSocket, and AMCP fan-out; force ping and reconcile',
	})
	connectionActions.append(refreshConnBtn)

	const localTableHost = document.createElement('div')
	localTableHost.className = 'device-view__replication-local-table'
	const peerTableHost = document.createElement('div')
	peerTableHost.className = 'device-view__replication-peer-table'
	const transportTableHost = document.createElement('div')
	transportTableHost.className = 'device-view__replication-transport-table'

	const connectionWarnLine = document.createElement('p')
	connectionWarnLine.className = 'device-view__note small device-view__replication-connection-warn'
	connectionWarnLine.hidden = true

	connectionDetails.append(
		channelParityLine,
		casparParityLine,
		connectionActions,
		localTableHost,
		peerTableHost,
		transportTableHost,
		connectionWarnLine,
	)

	/** @deprecated alias — leader follower panel merged into connectionDetails */
	const followerSec = connectionDetails
	const followerTableHost = peerTableHost
	const followerWarnLine = connectionWarnLine

	const outputWarnLine = document.createElement('p')
	outputWarnLine.className = 'device-view__note small device-view__replication-output-warn'
	outputWarnLine.hidden = true

	const localWiringNote = document.createElement('p')
	localWiringNote.className = 'device-view__note small device-view__replication-local-note'
	localWiringNote.hidden = true
	localWiringNote.textContent =
		'Screen destinations sync from the leader (channel ids must match). Wiring, cables, and Caspar consumers stay local — cable outputs on this box after connect, then Regenerate Caspar from Device View.'

	const reloadLocalBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Apply Device View → Caspar',
		title: 'Load leader screen destinations into config and regenerate casparcg.config on this backup box',
	})

	const modeLab = document.createElement('label')
	modeLab.className = 'device-view__field'
	modeLab.innerHTML = '<span class="device-view__field-label">Mode</span>'
	const modeSel = document.createElement('select')
	modeSel.className = 'device-view__destinations-type'
	for (const [val, label] of [
		['standalone', 'Standalone'],
		['leader', 'Leader (available for followers)'],
		['follower', 'Follower'],
	]) {
		const opt = document.createElement('option')
		opt.value = val
		opt.textContent = label
		modeSel.append(opt)
	}
	modeLab.append(modeSel)

	const leaderPick = document.createElement('div')
	leaderPick.className = 'device-view__field device-view__replication-leader-pick'
	leaderPick.style.display = 'none'
	leaderPick.innerHTML = '<span class="device-view__field-label">Leader server</span>'
	const leaderSel = document.createElement('select')
	leaderSel.className = 'device-view__destinations-type'
	leaderPick.append(leaderSel)

	const btnRow = document.createElement('div')
	btnRow.className = 'device-view__replication-actions'

	const scanBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Scan for leaders',
	})
	const becomeBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Become leader',
	})
	const stopLeaderBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Stop offering as leader',
	})
	const connectBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Connect to leader',
	})
	const disconnectBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Disconnect (standalone)',
	})
	btnRow.append(scanBtn, becomeBtn, stopLeaderBtn, connectBtn, disconnectBtn, reloadLocalBtn)
	sec.append(statusLine, connectionDetails, outputWarnLine, localWiringNote, modeLab, leaderPick, btnRow)
	host.append(sec)

	let lastStatus = null
	/** @type {ReturnType<typeof setInterval>|null} */
	let pollTimer = null

	const savedMode = getReplicationInspectorMode()
	if (savedMode) modeSel.value = savedMode

	function applyServerMode(st) {
		if (!st?.enabled) return
		if (st.configuredRole === 'follower' || st.role === 'follower') {
			modeSel.value = 'follower'
			setReplicationInspectorMode('follower')
		} else {
			modeSel.value = 'leader'
			setReplicationInspectorMode('leader')
		}
	}

	function syncModeFromStatus(st) {
		if (st?.enabled) {
			applyServerMode(st)
			return
		}
		const intent = getReplicationInspectorMode()
		if (intent === 'follower' || intent === 'leader') {
			modeSel.value = intent
			return
		}
		modeSel.value = st?.leaderAvailable ? 'leader' : 'standalone'
		if (modeSel.value === 'standalone') setReplicationInspectorMode('standalone')
	}

	function syncLeaderSelect(st) {
		if (st?.enabled && (st.role === 'follower' || st.configuredRole === 'follower') && st.peer?.host) {
			const host = String(st.peer.host)
			const port = parseInt(String(st.peer.port || 4200), 10) || 4200
			const value = `${host}:${port}`
			const label = st.peerHostname || st.peerSelfId || host
			leaderSel.innerHTML = ''
			const opt = document.createElement('option')
			opt.value = value
			opt.textContent = `${label} (${value}) — connected`
			opt.selected = true
			leaderSel.append(opt)
			return
		}
		if (!leaderSel.options.length) {
			const opt = document.createElement('option')
			opt.value = ''
			opt.textContent = '(scan for leaders, then connect)'
			leaderSel.append(opt)
		}
	}

	function syncModeUi() {
		const mode = modeSel.value
		leaderPick.style.display = mode === 'follower' ? '' : 'none'
		becomeBtn.style.display = mode === 'leader' && !lastStatus?.enabled ? '' : 'none'
		stopLeaderBtn.style.display = lastStatus?.leaderAvailable && !lastStatus?.enabled ? '' : 'none'
		connectBtn.style.display = mode === 'follower' && !lastStatus?.enabled ? '' : 'none'
		disconnectBtn.style.display = lastStatus?.enabled ? '' : 'none'
		const isFollower = lastStatus?.role === 'follower' || (mode === 'follower' && lastStatus?.enabled)
		reloadLocalBtn.style.display = isFollower ? '' : 'none'
	}

	function formatCasparFps(fr) {
		if (!fr) return '—'
		const s = String(fr).trim()
		const slash = s.indexOf('/')
		if (slash > 0) {
			const num = parseInt(s.slice(0, slash), 10)
			const den = parseInt(s.slice(slash + 1), 10)
			if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
				const fps = num / den
				return `${Number.isInteger(fps) ? fps : fps.toFixed(3)} fps`
			}
		}
		const n = parseFloat(s)
		return Number.isFinite(n) ? `${n} fps` : s
	}

	function formatAgeMs(ms) {
		if (ms == null || !Number.isFinite(ms)) return '—'
		if (ms < 2000) return 'just now'
		if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
		return `${Math.round(ms / 60_000)}m ago`
	}

	function formatDriftMs(ms) {
		if (!Number.isFinite(ms)) return '—'
		const sign = ms > 0 ? '+' : ''
		return `${sign}${ms} ms`
	}

	function formatChannelParity(cp) {
		if (!cp?.peerAvailable) return 'Channel plan: peer not reached yet'
		if (cp.ok) return 'Channel plan matches'
		const parts = (cp.mismatches || []).map((m) => `${m.label}: ${m.local} ≠ ${m.peer}`)
		return `Channel plan mismatch — ${parts.join('; ')}`
	}

	function formatCasparParity(cp, role) {
		if (!cp || cp.skipped) return ''
		if (cp.ok) {
			return `Running Caspar: ${cp.leaderChannelCount} channels match (leader ↔ ${role === 'leader' ? 'backup' : 'this box'})`
		}
		if (cp.followerNeedsMoreChannels) {
			return `Running Caspar: backup needs ${cp.missingCount} more channel(s) (${cp.followerChannelCount} on backup vs ${cp.leaderChannelCount} on leader) — load Device View setup and regenerate`
		}
		const msgs = (cp.mismatches || []).map((m) => m.message).filter(Boolean)
		return msgs.length ? `Running Caspar: ${msgs.join('; ')}` : 'Running Caspar: mismatch vs leader'
	}

	function buildPeerRows(peer, st, roleLabel) {
		if (!peer) return []
		const fan = st.amcpFanout || {}
		const ph = st.playheadSync || {}
		const endpoint = fan.endpoint?.host
			? `${fan.endpoint.host}:${fan.endpoint.port || 5250}`
			: peer.casparHost
				? `${peer.casparHost}:${peer.casparPort || 5250}`
				: '—'

		const rows = [
			{ label: roleLabel, value: peer.hostname || peer.selfId || peer.host || '—' },
			{ label: 'Address', value: `${peer.host}:${peer.port || 4200}` },
			{
				label: 'Peer status',
				value: peer.reachable ? `online · ping ${formatAgeMs(peer.pingAgeMs)}` : 'offline',
			},
			{ label: 'Role', value: peer.role || '—' },
			{ label: 'App version', value: peer.appVersion || '—' },
		]
		if (st.role === 'leader') {
			rows.push({
				label: 'AMCP fan-out',
				value: fan.active
					? fan.connected
						? `connected → ${endpoint}`
						: `disconnected${fan.lastError ? ` (${fan.lastError})` : ''}`
					: 'inactive',
			})
			if (fan.active) {
				rows.push(
					{ label: 'Commands sent', value: String(fan.commandsSent ?? 0) },
					{ label: 'Queue depth', value: String(fan.queueDepth ?? 0) },
				)
				if ((fan.skippedNotConnected ?? 0) > 0) {
					rows.push({ label: 'Skipped (offline)', value: String(fan.skippedNotConnected) })
				}
			}
		}
		if (peer.lastAppliedSeq != null || peer.liveStateSeq != null) {
			rows.push({
				label: 'Mirror seq',
				value:
					st.role === 'leader'
						? `follower ${peer.lastAppliedSeq ?? '—'} · leader ${peer.liveStateSeq ?? st.liveStateSeq ?? '—'}`
						: `local ${st.lastAppliedSeq ?? '—'} · leader ${peer.liveStateSeq ?? '—'}`,
			})
		}
		if (peer.mirrorLag > 0) {
			rows.push({ label: 'Mirror lag', value: `${peer.mirrorLag} events` })
		}
		if (ph.lastSampleAt && st.role === 'leader') {
			rows.push(
				{ label: 'Playhead drift', value: formatDriftMs(ph.driftMs) },
				{ label: 'Drift sampled', value: formatAgeMs(Date.now() - ph.lastSampleAt) },
			)
		}
		const frKeys = new Set([
			...Object.keys(ph.followerFramerates || {}),
			...Object.keys(ph.leaderFramerates || {}),
			...Object.keys(peer.programFramerates || {}),
		])
		for (const ch of [...frKeys].sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
			const leaderFr = ph.leaderFramerates?.[ch]
			const followerFr = ph.followerFramerates?.[ch] || peer.programFramerates?.[ch]
			if (!leaderFr && !followerFr) continue
			rows.push({
				label: `PGM ch ${ch} fps`,
				value: `${formatCasparFps(leaderFr)} / ${formatCasparFps(followerFr)}`,
			})
		}
		return rows
	}

	function buildLocalRows(local, st) {
		if (!local) return []
		const map = local.channelMap || {}
		const pgm = (map.programChannels || []).map((ch) => `ch${ch}`).join(', ') || '—'
		const prv = (map.previewChannels || [])
			.map((ch, i) => (ch == null ? `screen${i + 1}:off` : `screen${i + 1}:ch${ch}`))
			.join(', ')
		return [
			{ label: 'This server', value: local.hostname || local.selfId || '—' },
			{ label: 'Role', value: local.role || st.role || '—' },
			{ label: 'PGM channels', value: pgm },
			{ label: 'PRV channels', value: prv || '—' },
			{
				label: 'Multiview',
				value: map.multiviewCh == null ? 'off' : `ch ${map.multiviewCh}`,
			},
		]
	}

	function buildTransportRows(st) {
		const conn = st.connection
		if (!conn) return []
		const cp = st.casparParity
		const rows = [
			{
				label: 'Peer HTTP',
				value: conn.peerHttp?.reachable
					? `online · ${formatAgeMs(conn.peerHttp.pingAgeMs)}`
					: conn.peerHttp?.rawReachable
						? `stale · ${formatAgeMs(conn.peerHttp.pingAgeMs)}`
						: 'offline',
			},
			{
				label: 'Peer link',
				value: st.peerLinkReady
					? 'ready'
					: st.peerHttpReachable
						? 'HTTP only (WS pending)'
						: st.peerPingError || 'offline',
			},
		]
		if (cp && !cp.skipped) {
			rows.push({
				label: 'Caspar channels',
				value: cp.ok
					? `${cp.leaderChannelCount} match`
					: `${cp.followerChannelCount ?? '?'}/${cp.leaderChannelCount ?? '?'} (backup/leader)`,
			})
		}
		if (conn.peerLiveWs) {
			const ws = conn.peerLiveWs
			if (ws.direction === 'outbound') {
				rows.push({
					label: 'Live-state WS',
					value: ws.connected ? 'connected (outbound)' : 'disconnected',
				})
			} else {
				rows.push({
					label: 'Live-state WS',
					value:
						ws.clientCount > 0
							? `${ws.clientCount} follower client(s)`
							: 'no follower WS clients',
				})
			}
		}
		if (conn.peerCaspar?.active) {
			const ep = conn.peerCaspar.endpoint
			const epStr = ep?.host ? `${ep.host}:${ep.port || 5250}` : '—'
			rows.push({
				label: 'Peer Caspar AMCP',
				value: conn.peerCaspar.connected ? `connected → ${epStr}` : 'disconnected',
			})
		}
		return rows
	}

	function syncConnectionPanel(st) {
		const show = st?.enabled && st.peer?.host
		connectionDetails.hidden = !show
		if (!show) {
			channelParityLine.hidden = true
			connectionWarnLine.hidden = true
			localTableHost.replaceChildren()
			peerTableHost.replaceChildren()
			transportTableHost.replaceChildren()
			return
		}

		const localRole = st.role || 'standalone'
		const peerRole = st.peerBox?.role || (localRole === 'leader' ? 'follower' : 'leader')
		const peerLabel = peerRole === 'leader' ? 'Leader' : peerRole === 'follower' ? 'Follower' : 'Peer'
		connectionSummary.innerHTML = `<strong>Connection</strong> — ${localRole} ↔ ${peerLabel}`

		const cp = st.channelParity || {}
		channelParityLine.hidden = false
		const parityOk = cp.ok && cp.configHashMatch !== false
		channelParityLine.textContent = formatChannelParity(cp)
		channelParityLine.classList.toggle('device-view__replication-channel-parity--ok', parityOk)
		channelParityLine.classList.toggle('device-view__replication-channel-parity--warn', !parityOk)

		const caspar = st.casparParity
		const casparText = formatCasparParity(caspar, localRole)
		casparParityLine.hidden = !casparText
		if (casparText) {
			casparParityLine.textContent = casparText
			const casparOk = !!caspar?.ok
			casparParityLine.classList.toggle('device-view__replication-caspar-parity--ok', casparOk)
			casparParityLine.classList.toggle('device-view__replication-caspar-parity--warn', !casparOk)
		}

		const peer = st.peerBox || st.follower
		localTableHost.replaceChildren(buildInspectorTable(buildLocalRows(st.local, st)))
		peerTableHost.replaceChildren(buildInspectorTable(buildPeerRows(peer, st, peerLabel)))
		transportTableHost.replaceChildren(buildInspectorTable(buildTransportRows(st)))

		const warnings = []
		if (cp.peerAvailable && !cp.ok) {
			warnings.push(formatChannelParity(cp))
		}
		if (caspar && !caspar.skipped && !caspar.ok) {
			warnings.push(formatCasparParity(caspar, localRole))
			if (caspar.fixHint && localRole === 'follower') {
				warnings.push(caspar.fixHint)
			}
		}
		if (caspar?.regenerateAttempted && !caspar?.regenerateOk) {
			warnings.push(`Caspar regenerate failed: ${caspar.regenerateError || 'unknown error'}`)
		}
		if (cp.configHashMatch === false) {
			warnings.push('Replication config hash differs from peer — review pairing and saved settings.')
		}
		if (Array.isArray(st.playheadSync?.fpsMismatch) && st.playheadSync.fpsMismatch.length) {
			warnings.push(
				`Channel fps mismatch: ${st.playheadSync.fpsMismatch.map((m) => `ch${m.channel}`).join(', ')}`,
			)
		}
		if (Math.abs(st.playheadSync?.driftMs ?? 0) >= 500) {
			warnings.push(`Playhead drift ${formatDriftMs(st.playheadSync.driftMs)} — check Caspar load and video modes.`)
		}
		if (st.amcpFanout?.active && !st.amcpFanout.connected) {
			warnings.push('AMCP fan-out disconnected — backup may not receive live takes.')
		}
		if (st.connection?.peerLiveWs?.direction === 'outbound' && !st.connection.peerLiveWs.connected) {
			warnings.push('Live-state WebSocket disconnected — mirror may be stale after restart.')
		}
		if (st.peerHttpReachable && !st.peerLinkReady) {
			warnings.push('Peer HTTP ok but live-state WebSocket not connected — mirror may be stale.')
		} else if (!(st.peerLinkReady ?? st.peerReachable)) {
			const err = st.peerPingError ? ` (${st.peerPingError})` : ''
			warnings.push(`Peer link not ready${err} — use Refresh connection after restarts.`)
		}
		connectionWarnLine.hidden = !warnings.length
		connectionWarnLine.textContent = warnings.join(' ')
	}

	function syncFollowerPanel(st) {
		syncConnectionPanel(st)
	}

	function formatStatus(st) {
		if (!st) return 'Replication unavailable'
		const parts = [`Role: ${st.role || 'standalone'}`]
		if (st.leaderAvailable && !st.enabled) parts.push('accepting followers')
		if (st.enabled) {
			const peerLabel = st.peerSelfId || st.peerHostname || st.peer?.host || '?'
			parts.push(`paired → ${peerLabel}`)
			const linkOk = st.peerLinkReady ?? st.peerReachable
			parts.push(linkOk ? 'peer linked' : st.peerHttpReachable === false ? 'peer offline' : 'peer connecting…')
			if (!linkOk && st.peerPingError) parts.push(st.peerPingError)
		} else if (!st.leaderAvailable) {
			parts.push('not paired')
		}
		if (st.mediaSync?.percent != null) {
			const transport = st.mediaSync.transport === 'syncthing' ? 'syncthing' : 'rsync'
			parts.push(`media ${st.mediaSync.percent}% (${transport})`)
		}
		if (st.casparOutput?.ok === false && st.casparOutput.warnings?.length) parts.push('Caspar output needs wiring')
		if (st.scheduledApply === false) parts.push('mirror immediate')
		else if (st.scheduledApplyLeadMs != null) parts.push(`mirror lead ${st.scheduledApplyLeadMs}ms`)
		if (st.peerLiveStateSeq > 0 && st.lastAppliedSeq < st.peerLiveStateSeq) {
			parts.push(`behind seq ${st.peerLiveStateSeq - st.lastAppliedSeq}`)
		}
		if (st.role === 'leader' && st.amcpFanout?.active) {
			parts.push(st.amcpFanout.connected ? 'fan-out connected' : 'fan-out disconnected')
			if (st.playheadSync?.lastSampleAt && Number.isFinite(st.playheadSync.driftMs)) {
				parts.push(`drift ${formatDriftMs(st.playheadSync.driftMs)}`)
			}
		}
		if (st.casparParity && !st.casparParity.skipped && !st.casparParity.ok) {
			if (st.casparParity.followerNeedsMoreChannels) {
				parts.push(`backup +${st.casparParity.missingCount} ch needed`)
			} else {
				parts.push('Caspar mismatch')
			}
		}
		return parts.join(' · ')
	}

	function syncOutputWarnings(st) {
		const warnings = Array.isArray(st?.casparOutput?.warnings) ? st.casparOutput.warnings : []
		if (!warnings.length) {
			outputWarnLine.hidden = true
			outputWarnLine.textContent = ''
			return
		}
		outputWarnLine.hidden = false
		outputWarnLine.textContent = warnings.map((w) => w.message).join(' ')
	}

	async function scanForLeaders(opts = {}) {
		const { quiet = false } = opts
		scanBtn.disabled = true
		try {
			const res = await api.get('/api/replication/leaders')
			leaderSel.innerHTML = ''
			const leaders = Array.isArray(res?.leaders) ? res.leaders : []
			if (!leaders.length) {
				const opt = document.createElement('option')
				opt.value = ''
				opt.textContent = '(no leaders found — scan again or use Become leader on primary box)'
				leaderSel.append(opt)
			}
			for (const l of leaders) {
				const opt = document.createElement('option')
				opt.value = `${l.host}:${l.port || 4200}`
				opt.textContent = `${l.hostname || l.host} (${l.selfId || l.host})`
				leaderSel.append(opt)
			}
			if (!quiet) {
				setStatus(ctx.statusEl, `Found ${leaders.length} leader(s)`, true)
				showAppToast(
					leaders.length ? `Found ${leaders.length} leader(s)` : 'No leaders on subnet',
					leaders.length ? 'success' : 'warn',
				)
			}
			return leaders
		} catch (e) {
			if (!quiet) {
				setStatus(ctx.statusEl, e?.message || String(e), false)
				showAppToast(e?.message || String(e), 'error')
			}
			throw e
		} finally {
			scanBtn.disabled = false
		}
	}

	async function refreshStatus() {
		try {
			lastStatus = await api.get('/api/replication/status')
			statusLine.textContent = formatStatus(lastStatus)
			syncFollowerPanel(lastStatus)
			if (lastStatus.enabled) {
				localWiringNote.hidden = false
			} else {
				localWiringNote.hidden = true
			}
			syncModeFromStatus(lastStatus)
			syncLeaderSelect(lastStatus)
			syncOutputWarnings(lastStatus)
			syncModeUi()
		} catch (e) {
			statusLine.textContent = `Replication unavailable: ${e?.message || e}`
		}
	}

	scanBtn.onclick = async () => {
		try {
			await scanForLeaders()
		} catch {
			/* toast/status in scanForLeaders */
		}
	}

	becomeBtn.onclick = async () => {
		becomeBtn.disabled = true
		try {
			await api.post('/api/replication/become-leader', {})
			setStatus(ctx.statusEl, 'This server is now available as leader', true)
			showAppToast('Leader available for followers', 'success')
			refreshReplicationStatusSoon()
			await refreshStatus()
			await ctx.load()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			becomeBtn.disabled = false
		}
	}

	stopLeaderBtn.onclick = async () => {
		stopLeaderBtn.disabled = true
		try {
			await api.post('/api/replication/stop-leader', {})
			setStatus(ctx.statusEl, 'Leader availability stopped', true)
			showAppToast('Leader availability stopped', 'info')
			refreshReplicationStatusSoon()
			await refreshStatus()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			stopLeaderBtn.disabled = false
		}
	}

	connectBtn.onclick = async () => {
		const raw = leaderSel.value
		if (!raw) {
			setStatus(ctx.statusEl, 'Select a leader first (Scan for leaders)', false)
			showAppToast('Select a leader first', 'warn')
			return
		}
		const [host, portStr] = raw.split(':')
		connectBtn.disabled = true
		showAppToast('Connecting to leader…', 'info')
		try {
			const out = await api.post('/api/replication/connect', {
				leaderHost: host,
				leaderPort: parseInt(portStr, 10) || 4200,
			})
			const ok = !!out?.ok
			const msg = ok
				? out.syncing
					? 'Connected as follower — syncing project from leader…'
					: 'Connected as follower — project + media syncing'
				: out?.error || 'Connect failed'
			setStatus(ctx.statusEl, msg, ok)
			showAppToast(ok ? (out.syncing ? 'Connected — sync in progress' : 'Connected as follower') : out?.error || 'Connect failed', ok ? 'success' : 'error')
			refreshReplicationStatusSoon()
			await refreshStatus()
			await ctx.load()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			connectBtn.disabled = false
		}
	}

	disconnectBtn.onclick = async () => {
		if (!confirm('Disconnect hot backup and return to standalone? Each machine keeps playing locally.')) return
		disconnectBtn.disabled = true
		try {
			await api.post('/api/replication/disconnect', {})
			setReplicationInspectorMode('standalone')
			setStatus(ctx.statusEl, 'Standalone — local playout continues', true)
			showAppToast('Disconnected — standalone playout', 'warn')
			refreshReplicationStatusSoon()
			await refreshStatus()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			disconnectBtn.disabled = false
		}
	}

	refreshConnBtn.onclick = async () => {
		if (!lastStatus?.enabled) {
			showAppToast('Not paired — connect to a leader first', 'warn')
			return
		}
		refreshConnBtn.disabled = true
		showAppToast('Refreshing replication connection…', 'info')
		try {
			const out = await api.post('/api/replication/refresh-connection', {})
			const ok = !!out?.ok
			if (out?.status) {
				lastStatus = out.status
				statusLine.textContent = formatStatus(lastStatus)
				syncConnectionPanel(lastStatus)
				syncLeaderSelect(lastStatus)
				syncOutputWarnings(lastStatus)
				syncModeUi()
			} else {
				await refreshStatus()
			}
			const msg = ok
				? out.pingOk
					? 'Connection refreshed'
					: `Reloaded transports; peer ping failed: ${out.pingError || 'unknown'}`
				: out?.error || 'Refresh failed'
			setStatus(ctx.statusEl, msg, ok && out.pingOk !== false)
			showAppToast(msg, ok ? (out.pingOk ? 'success' : 'warn') : 'error')
			refreshReplicationStatusSoon()
			if (ok && typeof ctx.load === 'function') await ctx.load()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			refreshConnBtn.disabled = false
		}
	}

	reloadLocalBtn.onclick = async () => {
		reloadLocalBtn.disabled = true
		showAppToast('Applying Device View setup and regenerating Caspar…', 'info')
		try {
			const out = await api.post('/api/replication/apply-device-view-caspar', {})
			const parity = out?.parity
			const ok = !!out?.ok && parity?.ok !== false && parity?.regenerateOk !== false
			const msg = parity?.ok
				? 'Caspar channels now match leader'
				: parity?.followerNeedsMoreChannels
					? `Still short ${parity.missingCount} channel(s) — check Device View destinations`
					: parity?.regenerateError || out?.parity?.mismatches?.[0]?.message || 'Regenerate finished — review parity'
			setStatus(ctx.statusEl, msg, ok)
			showAppToast(msg, ok ? 'success' : 'warn')
			refreshReplicationStatusSoon()
			await refreshStatus()
			if (typeof ctx.load === 'function') await ctx.load()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			reloadLocalBtn.disabled = false
		}
	}

	modeSel.onchange = async () => {
		const mode = modeSel.value
		setReplicationInspectorMode(mode)
		syncModeUi()

		if (mode === 'follower') {
			try {
				await scanForLeaders({ quiet: false })
			} catch {
				/* scanForLeaders reports errors */
			}
			if (lastStatus?.leaderAvailable && !lastStatus?.enabled) {
				try {
					await api.post('/api/replication/stop-leader', {})
					showAppToast('Leader availability stopped — pick a leader and connect', 'info')
					refreshReplicationStatusSoon()
					await refreshStatus()
				} catch (e) {
					showAppToast(e?.message || String(e), 'error')
				}
			}
			return
		}

		if (mode === 'standalone') {
			/* keep intent only — no scan */
		}
	}

	void refreshStatus().then(() => {
		if (getReplicationInspectorMode() === 'follower' && !lastStatus?.enabled) {
			void scanForLeaders({ quiet: true }).catch(() => {})
		}
	})
	pollTimer = setInterval(() => void refreshStatus(), 3000)

	const onFocus = () => void refreshStatus()
	window.addEventListener('highascg-device-view-focus-server', onFocus)

	return () => {
		if (pollTimer) clearInterval(pollTimer)
		window.removeEventListener('highascg-device-view-focus-server', onFocus)
	}
}

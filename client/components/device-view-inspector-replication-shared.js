/**
 * Shared formatters and inspector table row builders for hot backup UI.
 */

export function formatCasparFps(fr) {
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

export function formatAgeMs(ms) {
	if (ms == null || !Number.isFinite(ms)) return '—'
	if (ms < 2000) return 'just now'
	if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
	return `${Math.round(ms / 60_000)}m ago`
}

export function formatDriftMs(ms) {
	if (!Number.isFinite(ms)) return '—'
	const sign = ms > 0 ? '+' : ''
	return `${sign}${ms} ms`
}

export function formatChannelParity(cp) {
	if (!cp?.peerAvailable) return 'Channel plan: peer not reached yet'
	if (cp.ok) return 'Channel plan matches'
	const parts = (cp.mismatches || []).map((m) => `${m.label}: ${m.local} ≠ ${m.peer}`)
	return `Channel plan mismatch — ${parts.join('; ')}`
}

export function formatCasparParity(cp, role) {
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

export function formatStatus(st) {
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
	if (st.role === 'follower' && st.showSync?.revisionLag) {
		parts.push('show behind leader')
	} else if (st.showSync?.receivedAtMs) {
		parts.push(`show synced ${formatAgeMs(Date.now() - st.showSync.receivedAtMs)}`)
	}
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

export function buildPeerRows(peer, st, roleLabel) {
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
		{ label: 'Hardware ID', value: peer.hardwareId || st.peerHardwareId || '—' },
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
	const showSync = st.showSync || {}
	if (st.role === 'follower') {
		rows.push({
			label: 'Leader show rev',
			value: showSync.leaderRevision || peer.activeShowRevision || '—',
		})
		rows.push({
			label: 'Applied show rev',
			value: showSync.appliedRevision || '—',
		})
		rows.push({
			label: 'Show received',
			value: showSync.receivedAtMs
				? formatAgeMs(Date.now() - showSync.receivedAtMs)
				: showSync.receivedAt || '—',
		})
		if (showSync.revisionLag) {
			rows.push({ label: 'Show sync', value: 'behind leader (pull pending)' })
		}
	} else if (st.role === 'leader' && showSync.leaderRevision) {
		rows.push({ label: 'Active show rev', value: showSync.leaderRevision })
		if (showSync.leaderSavedAt) {
			rows.push({ label: 'Show saved at', value: showSync.leaderSavedAt })
		}
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

export function buildLocalRows(local, st) {
	if (!local) return []
	const map = local.channelMap || {}
	const pgm = (map.programChannels || []).map((ch) => `ch${ch}`).join(', ') || '—'
	const prv = (map.previewChannels || [])
		.map((ch, i) => (ch == null ? `screen${i + 1}:off` : `screen${i + 1}:ch${ch}`))
		.join(', ')
	return [
		{ label: 'This server', value: local.hostname || local.selfId || '—' },
		{ label: 'Hardware ID', value: local.hardwareId || '—' },
		{ label: 'Role', value: local.role || st.role || '—' },
		{ label: 'PGM channels', value: pgm },
		{ label: 'PRV channels', value: prv || '—' },
		{
			label: 'Multiview',
			value: map.multiviewCh == null ? 'off' : `ch ${map.multiviewCh}`,
		},
	]
}

export function buildTransportRows(st) {
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

export function syncProjectPairLineWithHelpers(projectPairLine, st, { hotBackupPairedTitle, hotBackupPeerBoxForViewer }) {
	const hb = st?.projectHotBackup
	if (!hb || !st?.enabled) {
		projectPairLine.hidden = true
		projectPairLine.textContent = ''
		return
	}
	const title = hotBackupPairedTitle(hb, st.role) || (hb.peerLabel ? `Paired with ${hb.peerLabel}` : '')
	const peer = hotBackupPeerBoxForViewer(hb, st.role)
	const details = []
	if (peer?.hostname) details.push(peer.hostname)
	if (peer?.hardwareId) details.push(`ID ${String(peer.hardwareId).padStart(4, '0')}`)
	if (peer?.host) details.push(peer.host)
	projectPairLine.textContent = [title, details.length ? details.join(' · ') : ''].filter(Boolean).join(' — ')
	projectPairLine.hidden = !projectPairLine.textContent
}

export function syncOutputWarnings(outputWarnLine, st) {
	const warnings = Array.isArray(st?.casparOutput?.warnings) ? st.casparOutput.warnings : []
	if (!warnings.length) {
		outputWarnLine.hidden = true
		outputWarnLine.textContent = ''
		return
	}
	outputWarnLine.hidden = false
	outputWarnLine.textContent = warnings.map((w) => w.message).join(' ')
}

export function syncConnectionPanel(ui, st, { buildInspectorTable, escapeHtml }) {
	const {
		connectionDetails,
		connectionSummary,
		channelParityLine,
		casparParityLine,
		localTableHost,
		peerTableHost,
		transportTableHost,
		connectionWarnLine,
	} = ui

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
	connectionSummary.innerHTML = `<strong>Connection</strong> — ${escapeHtml(localRole)} ↔ ${escapeHtml(peerLabel)}`

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
	if (cp.peerAvailable && !cp.ok) warnings.push(formatChannelParity(cp))
	if (caspar && !caspar.skipped && !caspar.ok) {
		warnings.push(formatCasparParity(caspar, localRole))
		if (caspar.fixHint && localRole === 'follower') warnings.push(caspar.fixHint)
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

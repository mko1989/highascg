'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { REPO_ROOT } = require('../repo-paths')
const { swallow } = require('../utils/swallow')
const { displaySessionEnv } = require('../utils/x-display-session')
const { clearStableCefPages } = require('./cef-interactive-cdp')
const { bridgeTrace, shouldTraceX11Event } = require('./cef-interactive-trace')
const { onCefFocusChange } = require('./cef-focus-registry')
const { S, hostFocusActive, syncPageHintFromFocus } = require('./cef-interactive-bridge-shared')
const {
	bridgeEnabledInConfig,
	listInteractiveZones,
	channelVideoSize,
	zonesKey,
} = require('./cef-interactive-bridge-zones')
const {
	ensureCefBrowser,
	warmCefInteractivePage,
	scheduleCefWarm,
	refreshPageHint,
	refreshPageHintIfStale,
	enqueueX11Event,
	notifyCefFocusChanged,
} = require('./cef-interactive-bridge-events')

const X11_SCRIPT = path.join(REPO_ROOT, 'tools/runtime/cef-interactive-x11.py')

function stopCefInteractiveBridge() {
	if (S.infoPollTimer) {
		clearInterval(S.infoPollTimer)
		S.infoPollTimer = null
	}
	if (S.x11Proc) {
		try {
			S.x11Proc.kill('SIGTERM')
		} catch (err) { swallow(err, { tag: 'cef-bridge' }) }
		S.x11Proc = null
	}
	if (S.cefBrowser) {
		S.cefBrowser.disconnect().catch(() => {})
		S.cefBrowser = null
	}
	S.warmInFlight = null
	clearStableCefPages()
	S.zoneTargets = new Map()
	S.activeKey = null
	S.amcpRef = null
	S.pageHint = { needle: null, hasHtml: false }
	S.pageHintAt = 0
	S.keyboardZoneId = null
	S.pointerInZone = null
	S.lastWarmAt = 0
	S.bridgeConfigRef = null
	if (S.focusUnsubscribe) {
		S.focusUnsubscribe()
		S.focusUnsubscribe = null
	}
	S.bridgeLogRef = null
	S.eventChain = Promise.resolve()
}

/**
 * @param {object} config
 * @param {{ log?: Function, amcp?: object }} [opts]
 */
async function startCefInteractiveBridge(config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	if (!bridgeEnabledInConfig(config)) {
		stopCefInteractiveBridge()
		return { ok: false, reason: 'disabled_or_no_interactive_zones' }
	}
	if (!fs.existsSync(X11_SCRIPT)) {
		log('warn', `[CEF bridge] missing ${X11_SCRIPT}`)
		return { ok: false, reason: 'missing_x11_script' }
	}

	const zones = listInteractiveZones(config)
	const key = zonesKey(zones)
	if (S.x11Proc && S.activeKey === key) {
		S.amcpRef = opts.amcp || S.amcpRef
		return { ok: true, reason: 'already_running', zones: zones.length }
	}

	stopCefInteractiveBridge()
	S.activeKey = key
	S.amcpRef = opts.amcp || null
	S.bridgeConfigRef = config
	S.bridgeLogRef = log

	if (S.focusUnsubscribe) S.focusUnsubscribe()
	S.focusUnsubscribe = onCefFocusChange(() => notifyCefFocusChanged(S.bridgeLogRef || log))
	if (hostFocusActive()) syncPageHintFromFocus()

	S.zoneTargets = new Map()
	for (const z of zones) {
		const size = channelVideoSize(config, z.channel)
		// Multiview screen consumer is 1:1 with layout pixels (often 2160p); casparServer.multiview_mode can lag.
		const width = z.id === 'multiview' ? z.width : size.width
		const height = z.id === 'multiview' ? z.height : size.height
		// S.-prefix required: bare `zoneTargets` was a ReferenceError (unhandledRejection on every
		// Caspar connect, killing the bridge start — same latent-bug class as `warmInFlight`).
		S.zoneTargets.set(z.id, {
			channel: z.channel,
			layer: z.layer,
			width,
			height,
			zone: { x: z.x, y: z.y, width: z.width, height: z.height },
		})
	}

	const payload = JSON.stringify({
		zones: zones.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
	})
	const env = displaySessionEnv()
	S.x11Proc = spawn('python3', ['-u', X11_SCRIPT], {
		env,
		stdio: ['pipe', 'pipe', 'pipe'],
	})
	S.x11Proc.stdin.write(payload)
	S.x11Proc.stdin.end()

	let buf = ''
	S.x11Proc.stdout.on('data', (chunk) => {
		buf += String(chunk)
		let nl
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl).trim()
			buf = buf.slice(nl + 1)
			if (!line) continue
			try {
				const ev = JSON.parse(line)
				if (shouldTraceX11Event(String(ev.type || ''))) {
					const extra =
						ev.type === 'keydown' || ev.type === 'keyup'
							? ` keysym=${ev.keysym ?? 0} text=${JSON.stringify(ev.text || '')}`
							: ` (${ev.x},${ev.y}) btn=${ev.button ?? 0}`
					bridgeTrace(log, `x11→node ${ev.type} zone=${ev.zone}${extra}`)
				}
				enqueueX11Event(ev, { log })
			} catch (e) {
				log('warn', `[CEF bridge] bad x11 json: ${line.slice(0, 120)} (${e?.message || e})`)
			}
		}
	})
	S.x11Proc.stderr.on('data', (chunk) => {
		const t = String(chunk).trim()
		if (t) log('info', `[CEF bridge] ${t}`)
	})
	S.x11Proc.on('exit', (code, sig) => {
		if (S.activeKey === key) {
			log('warn', `[CEF bridge] X11 capture exited code=${code} sig=${sig}`)
			S.x11Proc = null
			S.activeKey = null
		}
	})

	await refreshPageHint().catch(() => {})
	bridgeTrace(log, `pageHint after start: needle=${S.pageHint.needle || '(none)'} hasHtml=${S.pageHint.hasHtml}`)
	for (let attempt = 0; attempt < 6; attempt++) {
		try {
			await ensureCefBrowser(log)
			break
		} catch (e) {
			if (attempt >= 5) log('warn', `[CEF bridge] CDP preconnect: ${e?.message || e}`)
			else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
		}
	}
	await warmCefInteractivePage(log)
	scheduleCefWarm(log, 1500)
	S.infoPollTimer = setInterval(() => {
		if (hostFocusActive()) {
			syncPageHintFromFocus()
			void warmCefInteractivePage(log)
			return
		}
		void (async () => {
			const prev = S.pageHint.needle
			await refreshPageHintIfStale(false)
			if (S.pageHint.needle !== prev || S.pageHint.hasHtml) {
				await warmCefInteractivePage(log)
			}
		})()
	}, S.WARM_INTERVAL_MS)

	log(
		'info',
		`[CEF bridge] Started — ${zones.length} interactive zone(s): ${zones.map((z) => `${z.id} ch${z.channel} L${z.layer}`).join(', ')}`,
	)
	return { ok: true, zones: zones.length }
}

/**
 * @param {object} config
 * @param {{ log?: Function, amcp?: object }} [opts]
 */
function syncCefInteractiveBridge(config, opts = {}) {
	if (!bridgeEnabledInConfig(config)) {
		stopCefInteractiveBridge()
		return Promise.resolve({ ok: false, reason: 'disabled' })
	}
	return startCefInteractiveBridge(config, opts)
}

module.exports = {
	stopCefInteractiveBridge,
	startCefInteractiveBridge,
	syncCefInteractiveBridge,
}

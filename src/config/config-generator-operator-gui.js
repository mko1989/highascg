'use strict'

const { channelXmlComment } = require('./config-generator-xml-comments')
const { escapeXml } = require('./config-generator-builders')
const { resolveOperatorMonitorPort } = require('../utils/operator-monitor-resolve')
const { resolveLayoutRectForOperatorPort } = require('../utils/x-display-session-layout')

/**
 * WO-255 T255.1/T255.2: pure port-resolution chain shared by the generator (here) and the runtime
 * shape-overlay monitor-rect resolver (src/system/operator-gui-channel.js's
 * `resolveOperatorGuiMonitorRect`) — factored out of `buildOperatorGuiChannel` so both sides agree
 * on which physical GPU port the operator_gui destination lands on. Explicit `dest.physicalPort`
 * wins; otherwise `resolveOperatorMonitorPort()` (WO-246); no operator_monitor flag resolvable
 * falls back to the multiview jack (the operator-area monitor by convention — never a program
 * screen, which would land the window over live PGM output).
 * @param {Record<string, unknown>} config
 * @param {ReturnType<import('./screen-destinations').normalizeDestination>} dest
 * @returns {number|null} 1-based physical GPU port, or null when nothing resolves
 */
function resolveOperatorGuiPort(config, dest) {
	// WO-325: a headless operator GUI drives no physical monitor — never resolve a port for it (and
	// in particular never fall through to the multiview jack below, which is what put the operator
	// GUI screen consumer on the multiview's monitor).
	if (dest?.headless === true) return null
	const explicitPort = Number.isFinite(Number(dest?.physicalPort)) && Number(dest.physicalPort) >= 1 && Number(dest.physicalPort) <= 4
		? Number(dest.physicalPort)
		: null
	if (explicitPort != null) return explicitPort
	let resolvedPort = null
	try {
		resolvedPort = resolveOperatorMonitorPort(config).port
	} catch (_) {
		resolvedPort = null
	}
	if (resolvedPort == null) {
		try {
			const { multiviewPhysicalPortIndex } = require('../utils/x-display-session-layout')
			resolvedPort = multiviewPhysicalPortIndex(config)
		} catch (_) {
			resolvedPort = null
		}
	}
	return resolvedPort
}

/**
 * WO-243/255: dedicated Caspar channel for the `operator_gui` destination — a `<screen>` consumer
 * (borderless, windowed, matching the existing PGM/multiview screen-consumer conventions,
 * ALWAYS-ON-TOP so it stacks above the fullscreen Firefox GUI beneath it — WO-255) on the chosen
 * monitor. Routed preview holes (10-49) are PLAYed here at runtime over AMCP
 * (src/system/operator-gui-channel.js) and shaped by the python-xlib helper
 * (tools/runtime/operator-shape-overlay.py) so only those holes are visible — this generator only
 * builds the raster + the physical monitor output, exactly like `buildMultiviewChannel`
 * (config-generator-consumer-attach.js)'s screen consumer but without any DeckLink/profile switch
 * (operator GUI is screen-only, always). Device/position resolution: see
 * {@link resolveOperatorGuiPort}; the resolved port's layout rect (screen or multiview sysId)
 * positions the window. No resolvable port falls back to the running `cumulativeX`/`0` (same
 * fallback multiview/PGM screens use when no OS-layout rect is available).
 * @param {Record<string, unknown>} config
 * @param {ReturnType<import('./screen-destinations').normalizeDestination>} dest
 * @param {any} dims - `{ width, height, fps, modeId, isCustom }` from `operatorGuiModeDimensions`
 * @param {{ cumulativeX: number, nextDevice: number, layout?: object }} ctx
 * @param {number|null|undefined} casparChannelNum
 */
function buildOperatorGuiChannel(config, dest, dims, ctx, casparChannelNum) {
	const resolvedPort = resolveOperatorGuiPort(config, dest)
	let rect = null
	if (resolvedPort != null) {
		try {
			rect = resolveLayoutRectForOperatorPort(config, ctx?.layout || null, resolvedPort)
		} catch (_) {
			rect = null
		}
	}
	const posX = rect && Number.isFinite(rect.x) ? rect.x : ctx.cumulativeX
	const posY = rect && Number.isFinite(rect.y) ? rect.y : 0
	// <device> is the X-screen index (1 on a single spanned desktop — what every other screen/
	// multiview consumer here emits), NOT our GPU port number. Positioning is x/y-driven; a
	// device value beyond the real X screen count makes Caspar fall back to 0,0 on screen 1.
	const device = 1

	const screenInner = [
		`<device>${device}</device>`,
		`<x>${posX}</x><y>${posY}</y>`,
		`<width>${dims.width}</width><height>${dims.height}</height>`,
		`<stretch>none</stretch>`,
		`<windowed>true</windowed>`,
		`<vsync>true</vsync>`,
		// WO-263 (inverts WO-255): this consumer stacks BELOW the fullscreen Firefox GUI, which
		// stays on top and takes all clicks. The shape helper punches HOLES in FIREFOX at the
		// preview rects so this window shows through. always-on-top MUST be false — video-on-top
		// lost the picture the instant the operator clicked the GUI (WM raises the focused Firefox
		// above an always-on-top video window). See tools/runtime/operator-shape-overlay.py.
		`<always-on-top>false</always-on-top>`,
		`<borderless>true</borderless>`,
	].join('\n                    ')

	const ch = casparChannelNum != null && Number.isFinite(Number(casparChannelNum)) ? Number(casparChannelNum) : '?'
	const label = escapeXml(String(dest?.label || 'Operator GUI'))

	// WO-325: headless / stream-only — emit the channel (raster + audio-osc, which the route layers
	// 10-49 and the runtime NVENC gui-stream consumer depend on) but NO physical <screen> consumer.
	// The channel still renders, so the runtime STREAM consumer keeps feeding the remote client; the
	// operator monitor is left entirely to the multiview.
	if (dest?.headless === true) {
		return `${channelXmlComment(
			`Caspar channel ${ch}: Operator GUI channel "${label}" — HEADLESS (stream-only, no physical screen consumer); routed preview layers (10-49) + runtime NVENC gui-stream feed remote clients only`,
		)}        <channel>
            <video-mode>${dims.modeId}</video-mode>
            <consumers>
            </consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
	}

	return `${channelXmlComment(
		`Caspar channel ${ch}: Operator GUI channel "${label}" — routed preview layers (10-49) shown through HOLES punched in the fullscreen Firefox GUI above it (WO-263); consumer stacks below Firefox on ${rect ? `port ${resolvedPort}` : 'default position (no monitor resolved yet)'}`,
	)}        <channel>
            <video-mode>${dims.modeId}</video-mode>
            <consumers>
                <screen>
                    ${screenInner}
                </screen>
            </consumers>
            <mixer>
                <audio-osc>true</audio-osc>
            </mixer>
        </channel>`
}

module.exports = { buildOperatorGuiChannel, resolveOperatorGuiPort }

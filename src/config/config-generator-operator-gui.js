'use strict'

const { channelXmlComment } = require('./config-generator-xml-comments')
const { escapeXml } = require('./config-generator-builders')
const { resolveOperatorMonitorPort } = require('../utils/operator-monitor-resolve')
const { resolveLayoutRectForOperatorPort } = require('../utils/x-display-session-layout')

/**
 * WO-243: dedicated Caspar channel for the `operator_gui` destination — a `<screen>` consumer
 * (borderless, windowed, matching the existing PGM/multiview screen-consumer conventions) on the
 * chosen monitor. The CEF web-UI layer (100) and routed preview holes (10-49) are PLAYed here at
 * runtime over AMCP (src/system/operator-gui-channel.js) — this generator only builds the raster +
 * the physical monitor output, exactly like `buildMultiviewChannel` (config-generator-consumer-attach.js)'s
 * screen consumer but without any DeckLink/profile switch (operator GUI is screen-only, always).
 * Device/position resolution: explicit `dest.physicalPort` wins; otherwise
 * `resolveOperatorMonitorPort()` (WO-246); the resolved port's layout rect (screen or multiview
 * sysId) positions the window. No resolvable port falls back to the running `cumulativeX`/`0`
 * (same fallback multiview/PGM screens use when no OS-layout rect is available).
 * @param {Record<string, unknown>} config
 * @param {ReturnType<import('./screen-destinations').normalizeDestination>} dest
 * @param {any} dims - `{ width, height, fps, modeId, isCustom }` from `operatorGuiModeDimensions`
 * @param {{ cumulativeX: number, nextDevice: number, layout?: object }} ctx
 * @param {number|null|undefined} casparChannelNum
 */
function buildOperatorGuiChannel(config, dest, dims, ctx, casparChannelNum) {
	const explicitPort = Number.isFinite(Number(dest?.physicalPort)) && Number(dest.physicalPort) >= 1 && Number(dest.physicalPort) <= 4
		? Number(dest.physicalPort)
		: null
	let resolvedPort = explicitPort
	if (resolvedPort == null) {
		try {
			resolvedPort = resolveOperatorMonitorPort(config).port
		} catch (_) {
			resolvedPort = null
		}
	}
	// No operator_monitor flag resolvable (e.g. multiple displays, no flag set): the multiview
	// jack is the operator-area monitor by convention — land the GUI consumer there rather than
	// on the first program screen (nextDevice), which would open a window over live PGM output.
	if (resolvedPort == null) {
		try {
			const { multiviewPhysicalPortIndex } = require('../utils/x-display-session-layout')
			resolvedPort = multiviewPhysicalPortIndex(config)
		} catch (_) {
			resolvedPort = null
		}
	}
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
		`<always-on-top>false</always-on-top>`,
		`<borderless>true</borderless>`,
	].join('\n                    ')

	const ch = casparChannelNum != null && Number.isFinite(Number(casparChannelNum)) ? Number(casparChannelNum) : '?'
	const label = escapeXml(String(dest?.label || 'Operator GUI'))
	return `${channelXmlComment(
		`Caspar channel ${ch}: Operator GUI channel "${label}" — CEF web-UI (layer 100, PLAYed at runtime) over routed preview holes (layers 10-49); screen consumer on ${rect ? `port ${resolvedPort}` : 'default position (no monitor resolved yet)'}`,
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

module.exports = { buildOperatorGuiChannel }

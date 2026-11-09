'use strict'

/**
 * WO-1012 stage C — the link policy of the private Zoom-audio daemon (it has no session manager). Pure: from a pw-dump
 * graph {nodes, ports, links} → the [outPortId, inPortId] pairs that are wanted and not linked yet.
 */

const { SINK_IN, SRC_OUT, SINK_OUT_FEED, TAP, FEEDER } = require('./zoom-audio-conf')

const ZOOM_APP = /zoom/i
const prop = (o, k) => o.info?.props?.[k]

function wantedLinks(g) {
	const byName = (n) => g.nodes.find((x) => prop(x, 'node.name') === n)
	const ports = (node, dir, monitor) =>
		g.ports
			.filter((p) => prop(p, 'node.id') === node.id && prop(p, 'port.direction') === dir && !!prop(p, 'port.monitor') === monitor)
			.sort((a, b) => String(prop(a, 'audio.channel')).localeCompare(String(prop(b, 'audio.channel'))))
	const linked = new Set(g.links.map((l) => `${l.info?.['output-port-id']}>${l.info?.['input-port-id']}`))
	const want = []
	const pair = (outs, ins) => {
		for (let i = 0; i < Math.min(outs.length, ins.length); i++) {
			const key = `${outs[i].id}>${ins[i].id}`
			if (!linked.has(key)) want.push([outs[i].id, ins[i].id])
		}
	}
	const zin = byName(SINK_IN)
	const zout = byName(SRC_OUT)
	const feed = byName(SINK_OUT_FEED)
	const tap = byName(TAP)
	const feeder = byName(FEEDER)
	const isZoom = (n) => ZOOM_APP.test(`${prop(n, 'application.name') || ''} ${prop(n, 'application.process.binary') || ''}`)
	for (const n of g.nodes) {
		const cls = prop(n, 'media.class')
		if (zin && cls === 'Stream/Output/Audio' && isZoom(n)) pair(ports(n, 'out', false), ports(zin, 'in', false))
		if (zout && cls === 'Stream/Input/Audio' && isZoom(n)) pair(ports(zout, 'out', false), ports(n, 'in', false))
	}
	if (zin && tap) pair(ports(zin, 'out', true), ports(tap, 'in', false))
	if (feed && feeder) pair(ports(feeder, 'out', false), ports(feed, 'in', false))
	return want
}

const DIRECTION = { 'Audio/Sink': 'Input', 'Stream/Input/Audio': 'Input', 'Audio/Source': 'Output', 'Stream/Output/Audio': 'Output' }

/**
 * Nodes that have no ports yet: without a session manager nobody sends them the PortConfig that creates their ports
 * (a null sink, a loopback side, a pw-cat stream all sit at 0 ports). Ours and Zoom's streams only.
 * @returns {{ id: number, direction: 'Input'|'Output', monitor: boolean }[]}
 */
function portConfigs(g) {
	const ours = new Set([SINK_IN, SRC_OUT, SINK_OUT_FEED, TAP, FEEDER])
	const out = []
	for (const n of g.nodes) {
		const direction = DIRECTION[prop(n, 'media.class')]
		const mine = ours.has(prop(n, 'node.name')) || (direction && /^Stream\//.test(prop(n, 'media.class')) && ZOOM_APP.test(`${prop(n, 'application.name') || ''} ${prop(n, 'application.process.binary') || ''}`))
		if (!direction || !mine || g.ports.some((p) => prop(p, 'node.id') === n.id)) continue
		out.push({ id: n.id, direction, monitor: prop(n, 'media.class') === 'Audio/Sink' })
	}
	return out
}

const portConfigPod = (c) =>
	`{ direction=${c.direction}, mode=dsp, monitor=${c.monitor}, control=false, format={ mediaType=audio, mediaSubtype=raw, format=F32P, rate=48000, channels=2, position=[FL,FR] } }`

module.exports = { wantedLinks, portConfigs, portConfigPod }

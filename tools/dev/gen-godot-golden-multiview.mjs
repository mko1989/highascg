// WO-600 M — writes godot/client/tests/golden/multiview_editor.json by running the WEB multiview
// editor modules (client/lib/multiview-state*.js, client/components/multiview-editor-canvas-*.js)
// over fixed channel maps / cells / pointer moves. The move/resize/drop blocks are inline in
// client/components/multiview-editor.js — copied verbatim below (keep in sync when that changes).
// Run: node tools/dev/gen-godot-golden-multiview.mjs
import { writeFileSync } from 'node:fs'
import { multiviewState } from '../../client/lib/multiview-state.js'
import { defaultLayout, cellsToApiLayout, migratePreviewRouteSources } from '../../client/lib/multiview-state-layout.js'
import {
	getCellOverlayType, getResolutionSuffix, resolveCellSourceResolution, getContainedVideoRect,
	resolveSourceAspectRatio, solveCellDimensions,
} from '../../client/components/multiview-editor-canvas-layout.js'
import { getResizeHandle } from '../../client/components/multiview-editor-canvas-interaction.js'
import { resolveMvCellSourceChannel, parseRouteValue } from '../../client/lib/input-channels.js'

const r = (o) => JSON.parse(JSON.stringify(o))
const cmOne = {
	screenCount: 1, programChannels: [1], previewChannels: [2], multiviewChannels: [3], multiviewCh: 3,
	programResolutions: [{ w: 1920, h: 1080, fps: 50 }], previewResolutions: [{ w: 1920, h: 1080, fps: 50 }],
	decklinkCount: 2, decklinkInputChannels: [4, 5],
	inputChannels: [
		{ kind: 'decklink', slot: 1, channel: 4, layer: 1, route: 'route://4-1', label: 'DeckLink 1', resolution: { w: 1920, h: 1080, fps: 50 } },
		{ kind: 'decklink', slot: 2, channel: 5, layer: 1, route: 'route://5-1', label: 'Cam B', resolution: { w: 1280, h: 720, fps: 50 } },
		{ kind: 'v4l2', slot: 1, channel: 6, layer: 1, route: 'route://6-1', label: 'USB cam', resolution: { w: 640, h: 480, fps: 30 } },
	],
}
const cmTwo = {
	screenCount: 2, programChannels: [1, 3], previewChannels: [2, null], multiviewChannels: [5, 6], multiviewCh: 5,
	screenLabels: ['Main', ''], programResolutions: [{ w: 3840, h: 1080, fps: 25 }, { w: 1080, h: 1920, fps: 25 }],
	previewResolutions: [{ w: 3840, h: 1080, fps: 25 }], decklinkCount: 0, inputsCh: 9, inputsResolution: { w: 1920, h: 1080, fps: 25 },
	decklinkInputChannels: [9], inputChannels: [],
}
const cmNone = { screenCount: 1, programChannels: [], previewChannels: [], decklinkCount: 5, decklinkInputChannels: [4, 5, 6, 7, 8] }
const maps = { one: cmOne, two: cmTwo, none: cmNone }

const cells = [
	{ id: 'pgm', type: 'pgm', label: 'PGM', screenIdx: 0, x: 0, y: 0, w: 960, h: 540 },
	{ id: 'prv_1', type: 'prv', label: 'PRV S2', x: 960, y: 0, w: 960, h: 540 },
	{ id: 'c1', type: 'route', label: 'Program 2', x: 10, y: 600, w: 400, h: 300, source: { value: 'route://3', type: 'route', label: 'PGM 2' } },
	{ id: 'decklink_1', type: 'decklink', label: 'Cam B', x: 500, y: 600, w: 480, h: 300, source: { value: 'route://5-1', type: 'route', label: 'Cam B' } },
	{ id: 'c2', type: 'media', label: 'clip', x: 1000, y: 600, w: 300, h: 300, source: { value: 'AMB', type: 'media' } },
	{ id: 'c3', type: 'route', label: 'USB cam', x: 1300, y: 600, w: 600, h: 400, aspectLocked: true, source: { value: 'route://6-1', type: 'route' } },
	{ id: 'c4', type: 'route', label: 'x', x: 0, y: 900, w: 300, h: 180, aspectLocked: false, source: { value: 'route://4-1', type: 'route' } },
	{ id: 't', type: 'timers', label: 'Timers', x: 1400, y: 900, w: 500, h: 180, source: { value: 'playback_timers.html', type: 'template' } },
	{ id: 'prv', type: 'prv', label: 'preview 1', x: 0, y: 0, w: 120, h: 60 },
	{ id: 'odd', type: 'route', label: 'pgm s 2', x: 5, y: 5, w: 30, h: 30, source: { value: 'route://9-3', type: 'route' } },
]
const canvases = [[1920, 1080], [3840, 2160], [1280, 720]]

const out = { defaults: [], api: [], overlay: [], contained: [], solve: [], handles: [], add: [], rescale: [], move: [], resize: [], drop: [], migrate: [], channel: [] }

for (const [mk, cm] of Object.entries(maps)) for (const [w, h] of canvases) {
	out.defaults.push({ map: mk, cw: w, ch: h, cells: r(defaultLayout(cm, w, h)) })
}
for (const [w, h] of canvases) out.api.push({ cw: w, ch: h, cells: r(cells), layout: cellsToApiLayout(cells, w, h) })
for (const [mk, cm] of Object.entries(maps)) for (const c of cells) {
	out.overlay.push({
		map: mk, cell: c.id, type: getCellOverlayType(c, cm.programChannels || [], cm.previewChannels || [], cm) ?? null,
		suffix: getResolutionSuffix(c, cm), res: resolveCellSourceResolution(c, cm), ratio: resolveSourceAspectRatio(c, cm),
	})
}
for (const [w, h] of canvases) for (const timers of [false, true]) for (const mk of ['one', 'two']) for (const c of cells) {
	multiviewState.canvasWidth = w; multiviewState.canvasHeight = h; multiviewState.showTimersUnderLabels = timers
	out.contained.push({ map: mk, cw: w, ch: h, timers, cell: c.id, rect: getContainedVideoRect(c, maps[mk]) })
}
for (const [w, h] of canvases) for (const timers of [false, true]) for (const ov of ['pgm', 'prv', 'route', 'timers', 'media'])
	for (const lock of ['width', 'height']) for (const [cw, chh, ratio] of [[480, 270, 16 / 9], [400, 400, 4 / 3], [1000, 200, 9 / 16], [60, 40, 32 / 9], [2000, 1500, 16 / 9]]) {
		multiviewState.canvasWidth = w; multiviewState.canvasHeight = h
		out.solve.push({ cw: w, ch: h, timers, ov, lock, w: cw, h: chh, ratio, out: solveCellDimensions(cw, chh, ratio, lock, ov, timers) })
	}
const hc = { x: 100, y: 100, w: 400, h: 200 }
for (const scale of [1, 0.5, 0.25]) for (const [px, py] of [[100, 100], [500, 300], [300, 100], [300, 300], [100, 200], [500, 200], [300, 200], [92, 150], [508, 150], [300, 85], [300, 316], [50, 50], [104, 104], [496, 296], [120, 120], [500, 100], [100, 300], [505, 95]])
	out.handles.push({ scale, x: px, y: py, handle: getResizeHandle(hc, px, py, scale) })

for (const [w, h] of canvases) for (const opts of [
	{ id: 'a', type: 'route', x: 10.4, y: 20.6, w: 300.5, h: 168.49 }, { id: 'b', type: 'media' }, { id: 'c' }, { id: 'd', type: 'pgm', aspectLocked: false },
	{ id: 'e', type: 'template', label: 'T', aspectLocked: true, source: { value: 'x', type: 'template' } }, { id: 'f', type: 'decklink', x: -2.5, y: 7.5 },
]) {
	multiviewState.canvasWidth = w; multiviewState.canvasHeight = h; multiviewState.cells = []
	out.add.push({ cw: w, ch: h, opts, cell: r(multiviewState.addCell(opts)) })
}
for (const [w, h] of canvases) for (const [nw, nh] of [[1920, 1080], [3840.7, 2160.2], [0, 0], [1024, 768]]) {
	multiviewState.canvasWidth = w; multiviewState.canvasHeight = h; multiviewState.cells = r(cells)
	multiviewState.setCanvasSize(nw, nh)
	out.rescale.push({ cw: w, ch: h, nw, nh, outW: multiviewState.canvasWidth, outH: multiviewState.canvasHeight, cells: r(multiviewState.cells) })
}

function snapValue(val, candidates, threshold) {
	let bestDiff = threshold
	let bestCandidate = val
	for (const c of candidates) {
		const diff = Math.abs(val - c)
		if (diff < bestDiff) { bestDiff = diff; bestCandidate = c }
	}
	return bestCandidate
}
// --- verbatim from multiview-editor.js onmousemove (move) ---
function move(start, cx, cy, mouseX, mouseY, scale) {
	const dragStart = { mouseX, mouseY, cell: start }
	const c = start
	const dx = cx - dragStart.mouseX, dy = cy - dragStart.mouseY
	const rawX = dragStart.cell.x + dx
	const rawY = dragStart.cell.y + dy
	const cw = dragStart.cell.w
	const ch = dragStart.cell.h
	const xCandidates = [0, multiviewState.canvasWidth]
	const yCandidates = [0, multiviewState.canvasHeight]
	for (const oc of multiviewState.getCells()) {
		if (oc.id === c.id) continue
		xCandidates.push(oc.x, oc.x + oc.w)
		yCandidates.push(oc.y, oc.y + oc.h)
	}
	const snapThresholdX = 10 / scale
	const snapThresholdY = 10 / scale
	let snapX1 = snapValue(rawX, xCandidates, snapThresholdX)
	let snapX2 = snapValue(rawX + cw, xCandidates, snapThresholdX) - cw
	let finalX = rawX
	if (Math.abs(snapX1 - rawX) <= Math.abs(snapX2 - rawX)) { if (Math.abs(snapX1 - rawX) < snapThresholdX) finalX = snapX1 }
	else { if (Math.abs(snapX2 - rawX) < snapThresholdX) finalX = snapX2 }
	let snapY1 = snapValue(rawY, yCandidates, snapThresholdY)
	let snapY2 = snapValue(rawY + ch, yCandidates, snapThresholdY) - ch
	let finalY = rawY
	if (Math.abs(snapY1 - rawY) <= Math.abs(snapY2 - rawY)) { if (Math.abs(snapY1 - rawY) < snapThresholdY) finalY = snapY1 }
	else { if (Math.abs(snapY2 - rawY) < snapThresholdY) finalY = snapY2 }
	return { x: finalX, y: finalY }
}
// --- verbatim from multiview-editor.js onmousemove (resize) ---
function resize(handleStr, start, cx, cy, mouseX, mouseY, scale, cm) {
	const dragStart = { mouseX, mouseY, cell: start }
	const c = start
	let { x, y, w, h: ch } = { ...dragStart.cell }; const dx = cx - dragStart.mouseX, dy = cy - dragStart.mouseY
	const xCandidates = [0, multiviewState.canvasWidth]
	const yCandidates = [0, multiviewState.canvasHeight]
	for (const oc of multiviewState.getCells()) {
		if (oc.id === c.id) continue
		xCandidates.push(oc.x, oc.x + oc.w)
		yCandidates.push(oc.y, oc.y + oc.h)
	}
	const snapThresholdX = 10 / scale
	const snapThresholdY = 10 / scale
	if (handleStr.includes('e')) { const rawRight = dragStart.cell.x + dragStart.cell.w + dx; const snappedRight = snapValue(rawRight, xCandidates, snapThresholdX); w = Math.max(60, snappedRight - dragStart.cell.x) }
	if (handleStr.includes('w')) { const rawLeft = dragStart.cell.x + dx; const snappedLeft = snapValue(rawLeft, xCandidates, snapThresholdX); const nw = Math.max(60, dragStart.cell.w + (dragStart.cell.x - snappedLeft)); x = dragStart.cell.x + dragStart.cell.w - nw; w = nw }
	if (handleStr.includes('s')) { const rawBottom = dragStart.cell.y + dragStart.cell.h + dy; const snappedBottom = snapValue(rawBottom, yCandidates, snapThresholdY); ch = Math.max(40, snappedBottom - dragStart.cell.y) }
	if (handleStr.includes('n')) { const rawTop = dragStart.cell.y + dy; const snappedTop = snapValue(rawTop, yCandidates, snapThresholdY); const nh = Math.max(40, dragStart.cell.h + (dragStart.cell.y - snappedTop)); y = dragStart.cell.y + dragStart.cell.h - nh; ch = nh }
	if (c.aspectLocked) {
		const ratio = resolveSourceAspectRatio(c, cm)
		const ovType = getCellOverlayType(c, cm.programChannels || [], cm.previewChannels || [], cm)
		const showTimersUnderLabels = !!multiviewState.showTimersUnderLabels
		if (handleStr.includes('e') || handleStr.includes('w')) {
			const solved = solveCellDimensions(w, ch, ratio, 'width', ovType, showTimersUnderLabels)
			ch = solved.h
			if (handleStr.includes('w')) x = dragStart.cell.x + dragStart.cell.w - w
			if (handleStr.includes('n')) y = dragStart.cell.y + dragStart.cell.h - ch
		} else if (handleStr.includes('s') || handleStr.includes('n')) {
			const solved = solveCellDimensions(w, ch, ratio, 'height', ovType, showTimersUnderLabels)
			w = solved.w
			if (handleStr.includes('w')) x = dragStart.cell.x + dragStart.cell.w - w
			if (handleStr.includes('n')) y = dragStart.cell.y + dragStart.cell.h - ch
		}
	}
	return { x, y, w, h: ch }
}
// --- verbatim from multiview-editor.js ondrop (new cell size/position) ---
function drop(data, x, y) {
	const mw = multiviewState.canvasWidth, mh = multiviewState.canvasHeight
	if (x < 0 || x > mw || y < 0 || y > mh) return null
	const routeType = data.routeType || data.type || 'media'
	let cw = Math.round(mw / 4)
	let ch = Math.round(mh / 4)
	let ratio = 16 / 9
	if (data.resolution) { const m = String(data.resolution).match(/(\d+)[×x](\d+)/i); if (m) ratio = parseInt(m[1], 10) / parseInt(m[2], 10) }
	if (['route', 'pgm', 'prv', 'decklink', 'live_audio', 'v4l2'].includes(routeType)) {
		const solved = solveCellDimensions(cw, cw, ratio, 'width', routeType, multiviewState.showTimersUnderLabels)
		cw = solved.w; ch = solved.h
		if (ch > mh) { const fit = solveCellDimensions(cw, mh, ratio, 'height', routeType, multiviewState.showTimersUnderLabels); cw = fit.w; ch = fit.h }
	}
	return { type: data.routeType || data.type, label: data.label || data.value, x: Math.max(0, Math.min(mw - cw, x - cw / 2)), y: Math.max(0, Math.min(mh - ch, y - ch / 2)), w: cw, h: ch, source: { value: data.value, type: data.type || 'media', label: data.label || data.value }, aspectLocked: true }
}

const layoutCells = cells.slice(0, 8)
for (const [w, h] of canvases) for (const scale of [1, 0.4]) for (const timers of [false, true]) {
	multiviewState.canvasWidth = w; multiviewState.canvasHeight = h; multiviewState.showTimersUnderLabels = timers
	multiviewState.cells = r(layoutCells)
	for (const id of ['pgm', 'c1', 'decklink_1', 'c2', 'c3', 'c4']) {
		const start = r(multiviewState.getCell(id))
		for (const [dx, dy] of [[3, 4], [-7, 9], [455, 0], [0, -598], [12.5, 33.3], [-30, -30], [1500, 900]]) {
			out.move.push({ cw: w, ch: h, scale, timers, cell: id, dx, dy, out: move(start, 200 + dx, 200 + dy, 200, 200, scale) })
		}
		for (const hs of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) for (const [dx, dy] of [[5, 5], [-40, 25], [-500, -500], [300, 7]]) {
			out.resize.push({ cw: w, ch: h, scale, timers, map: 'one', cell: id, handle: hs, dx, dy, out: resize(hs, start, 200 + dx, 200 + dy, 200, 200, scale, cmOne) })
		}
	}
	for (const data of [
		{ type: 'route', value: 'route://4-1', label: 'DeckLink 1' }, { type: 'media', value: 'AMB' }, { type: 'route', routeType: 'decklink', value: 'route://5-1', resolution: '1280×720' },
		{ type: 'route', value: 'route://6-1', resolution: '9x16' }, { type: 'template', value: 'x.html', label: 'X' }, { type: 'route', routeType: 'v4l2', value: 'route://6-1', resolution: '640x480' },
	]) for (const [px, py] of [[960, 540], [0, 0], [w, h], [w + 1, 10], [100, h - 5]]) {
		out.drop.push({ cw: w, ch: h, timers, data, x: px, y: py, out: drop(data, px, py) })
	}
}
out.migrate.push({ map: 'two', cells: r([{ id: 'a', source: { value: 'route://2-11', type: 'route' } }, { id: 'b', source: 'route://7-11', label: 'P' }, { id: 'c', source: { value: 'route://9-1' } }, { id: 'd', source: { value: 'AMB' } }]) })
out.migrate[0].out = r(migratePreviewRouteSources(out.migrate[0].cells, cmTwo))
maps.legacy = { ...cmOne, inputsCh: 7, liveAudioInputChannels: [8] }
const legacyCells = r([{ id: 'a', source: { value: 'route://7-2', type: 'route' } }, { id: 'b', source: 'route://7-1' }, { id: 'c', source: { value: 'route://7-9' } }, { id: 'd', source: { value: 'route://7' } }])
out.migrate.push({ map: 'legacy', cells: legacyCells, out: r(migratePreviewRouteSources(legacyCells, maps.legacy)) })
const audioOnly = { inputsCh: 7, liveAudioInputChannels: [8, 12] }
maps.audio = audioOnly
const audioCells = r([{ id: 'a', source: { value: 'route://7-2' } }, { id: 'b', source: { value: 'route://7-3' } }])
out.migrate.push({ map: 'audio', cells: audioCells, out: r(migratePreviewRouteSources(audioCells, audioOnly)) })
for (const c of cells) {
	const p = parseRouteValue(c.source?.value)
	out.channel.push({ map: 'one', cell: c.id, parsed: p, ch: resolveMvCellSourceChannel(c, p, cmOne) })
}
out.maps = maps
out.layoutCells = layoutCells
writeFileSync(new URL('../../godot/client/tests/golden/multiview_editor.json', import.meta.url), JSON.stringify(out) + '\n')
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.isArray(v) ? v.length : Object.keys(v).length])))

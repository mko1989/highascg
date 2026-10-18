/**
 * WO-585: POST /api/scene/global-border — switch / restyle a screen's global border server-side
 * (Companion has no browser to run the web inspector's push). Same slot, same AMCP builders and
 * the same on-air rules as the web push (`scenes-preview-global-border.js` → `/api/scene/border-lines`).
 *
 * Body: `{ screen: 0-based, enabled?: true|false|'toggle', type?, params?: {…}, fadeDuration?, preset?: slot }`
 *  WO-601 (Godot inspector): also `slices`, `inner`, `mirrorBorderOnPrv`, `savePreset: {slot, name}`, `deletePreset: slot`,
 *  `clear: true` (remove the screen's slot).
 *  - `preset` recalls a saved border preset (crossfades PGM 998 ↔ 996 when the border is already on).
 *  - Omitting `enabled` keeps the current on/off (a style change while on updates it live).
 * Reply: `{ ok, screen, enabled, border, lines }`.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getRouteMap } = require('./routes-scene-shared')
const { computeBorderLines, cancelPendingBorderClear } = require('./routes-scene-border')
const { scheduleProjectSyncBroadcast } = require('./routes-data-project-sync')
const liveSceneState = require('../state/live-scene-state')
const {
	GLOBAL_BORDER_LAYER_PGM_A,
	GLOBAL_BORDER_LAYER_PGM_B,
	buildGlobalBorderPresetCrossfadeLines,
} = require('../engine/global-border')
const GLOBAL_BORDER_LAYER_PRV_MIRROR = 997
const {
	normalizeGlobalBordersArray,
	applyControlToSlot,
	screenBorderCasparSlots,
	pgmAirSnapshotOf,
} = require('../engine/global-border-control')

const bad = (status, error) => ({ status, headers: JSON_HEADERS, body: jsonBody({ error }) })

/** Border payload for `computeBorderLines` (drops UI-only keys, like the web `stripMirrorFromBorderPayload`). */
function borderForLines(slot, enabled) {
	const fadeDuration = Math.max(0, parseInt(String(slot?.fadeDuration ?? 25), 10) || 0)
	if (!enabled) return { enabled: false, fadeDuration }
	const { mirrorBorderOnPrv, borderPresets, pgmAirSnapshot, ...rest } = slot
	void mirrorBorderOnPrv
	void borderPresets
	void pgmAirSnapshot
	return { ...rest, enabled: true, fadeDuration }
}

/** Lines for this request, grouped by channel (each group gets its own MIXER COMMIT). */
function planLines(ctx, map, screenIdx, res) {
	const { next, wasEnabled, nowEnabled, preset } = res
	const { pgmCh, onAir, clear } = screenBorderCasparSlots(map, screenIdx, next)
	/** @type {Map<number, string[]>} */
	const byCh = new Map()
	const push = (ch, lines) => {
		if (!lines.length) return
		byCh.set(ch, [...(byCh.get(ch) || []), ...lines])
	}

	const onPgm = onAir.length === 1 && onAir[0].channel === pgmCh
	if (preset && wasEnabled && onPgm) {
		// Web `recallGlobalBorderPreset`: load the preset on the idle PGM layer, crossfade across.
		const from = onAir[0].layer
		const to = from === GLOBAL_BORDER_LAYER_PGM_A ? GLOBAL_BORDER_LAYER_PGM_B : GLOBAL_BORDER_LAYER_PGM_A
		cancelPendingBorderClear(pgmCh, from)
		cancelPendingBorderClear(pgmCh, to)
		const fd = next.fadeDuration ?? 25
		push(pgmCh, buildGlobalBorderPresetCrossfadeLines(pgmCh, from, to, borderForLines(next, true), ctx, fd, 'add'))
		next.activePgmLayer = to
		return byCh
	}

	if (res.noAir) return byCh
	if (res.mirrorChanged && next.mirrorBorderOnPrv !== true) {
		// mirror off: the PRV mirror layer goes, PGM keeps / gets the restored state (below)
		const prvCh = Number(map.previewCh(screenIdx + 1)) || null
		if (prvCh && prvCh !== pgmCh) push(prvCh, computeBorderLines(ctx, { channel: prvCh, layer: GLOBAL_BORDER_LAYER_PRV_MIRROR, border: borderForLines(next, false), isUpdate: false }))
	}
	if (nowEnabled) {
		for (const s of onAir) {
			const isUpdate = wasEnabled && !res.forceAdd
			push(s.channel, computeBorderLines(ctx, { ...s, border: borderForLines(next, true), isUpdate }))
		}
	} else if (wasEnabled) {
		for (const s of clear) {
			push(s.channel, computeBorderLines(ctx, { ...s, border: borderForLines(next, false), isUpdate: false }))
		}
	}
	return byCh
}

async function runLines(ctx, byCh) {
	const sent = []
	for (const [ch, lines] of byCh) {
		const pipe = lines.some((l) => /\bDEFER\b/i.test(String(l))) ? [...lines, `MIXER ${ch} COMMIT`] : lines
		for (const line of pipe) {
			await ctx.amcp.raw(line)
			sent.push(line)
		}
	}
	return sent
}

/** Keep the PGM live entry's border in step, so the next take fades from the real on-air state. */
async function syncLiveSceneBorder(pgmCh, slot) {
	const live = liveSceneState.getChannel(pgmCh)
	if (!live?.scene) return
	await liveSceneState.setChannel(pgmCh, { ...live, scene: { ...live.scene, globalBorder: slot } })
}

async function handleGlobalBorderControl(body, ctx) {
	const b = parseBody(body)
	const map = getRouteMap(ctx)
	const screenIdx = parseInt(String(b.screen ?? b.screenIdx ?? b.screenIndex ?? ''), 10)
	const screenCount = Math.min(4, Number(map.screenCount) || 0)
	if (!Number.isFinite(screenIdx) || screenIdx < 0 || screenIdx >= screenCount) {
		return bad(400, `screen out of range (0..${Math.max(0, screenCount - 1)})`)
	}
	if (!ctx.amcp) return bad(503, 'Caspar not connected')

	const { loadFullProject, persistProject } = require('../engine/project-scenes')
	const project = loadFullProject()
	if (!project?.scenes || typeof project.scenes !== 'object') return bad(409, 'no project loaded')
	const borders = normalizeGlobalBordersArray(project.scenes.globalBorders)

	if (b.clear === true) return clearScreenSlot(ctx, map, project, borders, screenIdx, persistProject)
	const res = applyControlToSlot(borders[screenIdx], b)
	if (!res.ok) return bad(400, res.error)

	let sent
	try {
		sent = await runLines(ctx, planLines(ctx, map, screenIdx, res))
	} catch (e) {
		return bad(502, `AMCP failed: ${e?.message || e}`)
	}

	const next = res.next
	const { pgmCh } = screenBorderCasparSlots(map, screenIdx, next)
	if (next.mirrorBorderOnPrv !== true) next.pgmAirSnapshot = pgmAirSnapshotOf(next)
	borders[screenIdx] = next

	const updated = {
		...project,
		savedAt: new Date().toISOString(),
		scenes: { ...project.scenes, globalBorders: borders },
	}
	const persisted = await persistProject(ctx, updated, { writeAutosave: true, pushVolumes: false })
	if (!persisted?.unchanged) scheduleProjectSyncBroadcast(ctx, persisted?.project || updated)
	reconfigureLightingInput(ctx, persisted?.project || updated)
	if (pgmCh) {
		try {
			await syncLiveSceneBorder(pgmCh, next)
		} catch (e) {
			if (typeof ctx.log === 'function') ctx.log('warn', `[global-border] live state sync: ${e?.message || e}`)
		}
	}
	if (typeof ctx.log === 'function') {
		ctx.log('info', `[global-border] screen ${screenIdx + 1} ${next.enabled ? 'on' : 'off'} (${next.type}) via API`)
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, screen: screenIdx, enabled: !!next.enabled, border: next, lines: sent }),
	}
}

/** `{ clear: true }`: web "Remove border from this screen" — border off on air, slot null in the project. */
async function clearScreenSlot(ctx, map, project, borders, screenIdx, persistProject) {
	const cur = borders[screenIdx]
	let sent = []
	if (cur?.enabled) {
		const { clear } = screenBorderCasparSlots(map, screenIdx, cur)
		const byCh = new Map()
		for (const s of clear) byCh.set(s.channel, [...(byCh.get(s.channel) || []), ...computeBorderLines(ctx, { ...s, border: borderForLines(cur, false), isUpdate: false })])
		sent = await runLines(ctx, byCh)
	}
	borders[screenIdx] = null
	const updated = { ...project, savedAt: new Date().toISOString(), scenes: { ...project.scenes, globalBorders: borders } }
	const persisted = await persistProject(ctx, updated, { writeAutosave: true, pushVolumes: false })
	if (!persisted?.unchanged) scheduleProjectSyncBroadcast(ctx, persisted?.project || updated)
	reconfigureLightingInput(ctx, persisted?.project || updated)
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, screen: screenIdx, enabled: false, border: null, lines: sent }) }
}

/** The Art-Net/sACN receiver caches project.scenes — refresh it like the project save/autosave handlers do. */
function reconfigureLightingInput(ctx, project) {
	try {
		if (ctx.artnetReceiver?.reconfigureFromProject) ctx.artnetReceiver.reconfigureFromProject(project)
		else if (ctx.artnetReceiver?.reconfigure) ctx.artnetReceiver.reconfigure()
	} catch (e) {
		if (typeof ctx.log === 'function') ctx.log('warn', `[global-border] lighting input reconfigure: ${e?.message || e}`)
	}
}

/** GET /api/scene/global-border/fixture — the lighting-desk fixture file (web bundles client/fixtures/global-border.txt). */
function handleGlobalBorderFixture() {
	const fs = require('fs')
	const path = require('path')
	const { REPO_ROOT } = require('../repo-paths')
	try {
		const text = fs.readFileSync(path.join(REPO_ROOT, 'client', 'fixtures', 'global-border.txt'), 'utf8')
		return { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text }
	} catch {
		return bad(404, 'fixture file missing')
	}
}

module.exports = { handleGlobalBorderControl, handleGlobalBorderFixture, reconfigureLightingInput }

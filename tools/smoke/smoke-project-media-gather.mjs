#!/usr/bin/env node
'use strict'

/**
 * Gather media: look/timeline paths must rewrite when clips move into project folder.
 */
import { pathToFileURL } from 'url'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..')
const gatherUrl = pathToFileURL(path.join(repoRoot, 'client/lib/project-media-gather.js')).href

const gatherMod = await import(gatherUrl)

const buildGatherRefMap = gatherMod.__test?.buildGatherRefMap
const rewriteProjectPathsAfterGather = gatherMod.__test?.rewriteProjectPathsAfterGather
const buildMovedTargetMap = gatherMod.__test?.buildMovedTargetMap

if (!buildGatherRefMap || !rewriteProjectPathsAfterGather || !buildMovedTargetMap) {
	console.error('[smoke-project-media-gather] FAIL: gather test exports missing')
	process.exit(1)
}

const folder = 'projects/demo_show'
const slug = 'demo_show'
const settings = { projectScopedMedia: { location: 'internal' } }

const project = {
	name: 'Demo Show',
	scenes: {
		scenes: [
			{
				id: 's1',
				name: 'Look 1',
				layers: [
					{
						layerNumber: 10,
						source: { type: 'media', value: 'imports/clip.mp4', label: 'imports/clip.mp4' },
					},
				],
			},
		],
	},
	timelines: {
		timelines: [
			{
				id: 't1',
				layers: [
					{
						clips: [
							{
								source: { type: 'media', value: 'shared/b-roll.mp4', label: 'shared/b-roll.mp4' },
							},
						],
					},
				],
			},
		],
	},
}

const preMoveMedia = [{ id: 'imports/clip.mp4' }, { id: 'shared/b-roll.mp4' }]
const postMoveMedia = [
	{ id: 'projects/demo_show/clip.mp4' },
	{ id: 'projects/demo_show/b-roll.mp4' },
]

const idsToMove = ['imports/clip.mp4', 'shared/b-roll.mp4']
const projectRefs = ['imports/clip.mp4', 'clip.mp4', 'shared/b-roll.mp4']
const movedTargets = buildMovedTargetMap(idsToMove, folder, slug, settings)
const refMap = buildGatherRefMap(
	idsToMove,
	folder,
	slug,
	settings,
	projectRefs,
	preMoveMedia,
	postMoveMedia,
)

const updated = rewriteProjectPathsAfterGather(
	project,
	refMap,
	movedTargets,
	folder,
	slug,
	settings,
	postMoveMedia,
)

const lookVal = updated.scenes.scenes[0].layers[0].source.value
const tlVal = updated.timelines.timelines[0].layers[0].clips[0].source.value

let failed = 0
function ok(cond, msg) {
	if (cond) console.log(`[smoke-project-media-gather] OK: ${msg}`)
	else {
		console.error(`[smoke-project-media-gather] FAIL: ${msg}`)
		failed++
	}
}

ok(lookVal === 'clip.mp4', `look path rewritten (${lookVal})`)
ok(tlVal === 'b-roll.mp4', `timeline leaf ref matched moved file (${tlVal})`)

process.exit(failed > 0 ? 1 : 0)

#!/usr/bin/env node
/**
 * PGM-only routing: preview AMCP must not fall back to the program channel.
 * Usage: node tools/smoke/smoke-preview-amcp-channel.mjs
 */
import { pathToFileURL } from 'url'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..')
const lookStackUrl = pathToFileURL(
	path.join(repoRoot, 'client/lib/scenes-preview-look-stack.js'),
).href
const lookBusUrl = pathToFileURL(path.join(repoRoot, 'client/lib/look-stack-amcp-channel.js')).href
const timelineSendToUrl = pathToFileURL(
	path.join(repoRoot, 'client/lib/timeline-state-model.js'),
).href

const { isPreviewBusAvailable, resolvePreviewAmcpChannel } = await import(lookStackUrl)
const { resolveLookStackChannelForBus } = await import(lookBusUrl)
const { coerceTimelineSendTo, defaultTimelineSendTo, previewBusAvailableForSendTo } = await import(
	timelineSendToUrl
)

const pgmOnlyMap = {
	screenCount: 1,
	programChannels: [1],
	previewChannels: [null],
	previewEnabledByMain: [false],
}

const pgmPrvMap = {
	screenCount: 1,
	programChannels: [1],
	previewChannels: [2],
	previewEnabledByMain: [true],
}

const sharedBusMap = {
	screenCount: 1,
	programChannels: [1],
	previewChannels: [1],
	previewEnabledByMain: [true],
}

const sceneState = { editOnPgm: false, activeScreenIndex: 0 }
const getPgmOnly = () => pgmOnlyMap
const getPgmPrv = () => pgmPrvMap

let failed = 0
function ok(cond, msg) {
	if (cond) {
		console.log(`[smoke-preview-amcp-channel] OK: ${msg}`)
	} else {
		console.error(`[smoke-preview-amcp-channel] FAIL: ${msg}`)
		failed++
	}
}

ok(isPreviewBusAvailable(pgmOnlyMap, 0) === false, 'pgm_only main has no preview bus')
ok(isPreviewBusAvailable(pgmPrvMap, 0) === true, 'pgm_prv main has preview bus')
ok(isPreviewBusAvailable(sharedBusMap, 0) === false, 'shared PGM/PRV physical channel is not a separate preview bus')
ok(
	resolvePreviewAmcpChannel(sceneState, getPgmOnly, 0, true) === null,
	'deck recall does not fall back to PGM on pgm_only',
)
ok(
	resolvePreviewAmcpChannel(sceneState, getPgmOnly, 0, false) === null,
	'compose edit does not use PGM on pgm_only',
)
ok(
	resolvePreviewAmcpChannel({ editOnPgm: true, activeScreenIndex: 0 }, getPgmOnly, 0, false) === null,
	'editOnPgm does not target PGM on pgm_only (air via Take only)',
)
ok(
	resolvePreviewAmcpChannel({ editOnPgm: true, activeScreenIndex: 0 }, getPgmPrv, 0, false) === 2,
	'editOnPgm still uses mapped PRV (never PGM) on pgm_prv',
)
ok(
	resolvePreviewAmcpChannel(sceneState, () => sharedBusMap, 0, false) === null,
	'shared physical bus skips preview AMCP on PGM',
)
ok(
	resolvePreviewAmcpChannel(sceneState, getPgmPrv, 0, true) === 2,
	'pgm_prv deck recall uses mapped PRV channel',
)
ok(
	resolveLookStackChannelForBus(pgmOnlyMap, sceneState, { mainScope: '0' }, 'prv') === null,
	'look stack prv mode does not fall back to PGM on pgm_only',
)
ok(
	resolveLookStackChannelForBus(pgmOnlyMap, sceneState, { mainScope: '0' }, 'edit') === null,
	'look stack edit mode stays off PGM on pgm_only',
)

const prvDefault = { preview: true, program: false, screenIdx: 0 }
ok(
	previewBusAvailableForSendTo(pgmOnlyMap, prvDefault) === false,
	'timeline dest has no PRV bus on pgm_only',
)
const coerced = coerceTimelineSendTo(pgmOnlyMap, { ...prvDefault })
ok(coerced.preview === false && coerced.program === true, 'timeline sendTo coerces to PGM on pgm_only')
const coercedDefault = defaultTimelineSendTo(pgmOnlyMap)
ok(
	coercedDefault.preview === false && coercedDefault.program === true,
	'timeline default sendTo is PGM on pgm_only',
)
const kept = coerceTimelineSendTo(pgmPrvMap, { ...prvDefault })
ok(kept.preview === true && kept.program === false, 'timeline sendTo stays PRV on pgm_prv')

process.exit(failed > 0 ? 1 : 0)

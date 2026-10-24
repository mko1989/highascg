'use strict'

/**
 * WO-731 — the desks the audio page can drive, and their drivers. A driver speaks one protocol family and offers
 * the same five calls: probe() → text, getChannel(n) → { on, db }, setOn(n, on), setDb(n, db), names(count),
 * close(). Channel numbers are 1-based everywhere above the driver.
 * Ports, channel counts and messages: work/work-orders/731_WO_audio_operator_page_desk_automation.md (sources).
 */

const MODELS = {
	x32: { label: 'Behringer X32 / Midas M32', family: 'x32', port: 10023, inputs: 32 },
	xair: { label: 'Behringer X Air / Midas MR', family: 'xair', port: 10024, inputs: 16 },
	wing: { label: 'Behringer WING', family: 'wing', port: 2223, inputs: 40 },
	'yamaha-cl': { label: 'Yamaha CL / QL', family: 'yamaha', port: 49280, inputs: 72 },
	'yamaha-tf': { label: 'Yamaha TF', family: 'yamaha', port: 49280, inputs: 40 },
	'yamaha-dm3': { label: 'Yamaha DM3', family: 'yamaha', port: 49280, inputs: 16 },
	'yamaha-dm7': { label: 'Yamaha DM7 / DM7 Compact', family: 'yamaha', port: 49280, inputs: 120 },
	'yamaha-rivage': { label: 'Yamaha RIVAGE PM', family: 'yamaha', port: 49280, inputs: 288 },
	// MixRack 51325; a dLive Surface listens on 51328 (type it in Port)
	dlive: { label: 'Allen & Heath dLive', family: 'dlive', port: 51325, inputs: 128, midi: true },
	sq: { label: 'Allen & Heath SQ (NRPN fader law: Linear)', family: 'sq', port: 51325, inputs: 48, midi: true },
}

const DRIVERS = {
	x32: () => require('./drivers/behringer-x32'),
	xair: () => require('./drivers/behringer-x32'),
	wing: () => require('./drivers/behringer-wing'),
	yamaha: () => require('./drivers/yamaha-rcp'),
	dlive: () => require('./drivers/allenheath-dlive'),
	sq: () => require('./drivers/allenheath-sq'),
}

/** @param {string} model a MODELS key @param {{ host: string, port: number, log?: Function }} opts */
function createDriver(model, opts) {
	const m = MODELS[model]
	if (!m) throw new Error(`unknown desk ${model}`)
	return DRIVERS[m.family]().create({ ...opts, model, family: m.family, inputs: m.inputs })
}

module.exports = { MODELS, createDriver }

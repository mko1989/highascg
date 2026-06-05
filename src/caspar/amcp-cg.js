'use strict'

const { param, chLayer } = require('./amcp-utils')

class AmcpCg {
	/**
	 * @param {import('./amcp-client').AmcpClient} client
	 */
	constructor(client) {
		this._client = client
	}

	_send(cmd, responseKey) {
		return this._client._send(cmd, responseKey)
	}

	_cgTyped(method, channel, layer, templateHostLayer, cmd, extra = {}) {
		const ch = Number(channel)
		const ly = Number(layer)
		const cgLayer = parseInt(templateHostLayer, 10)
		const typed = { channel: ch, layer: ly, cgLayer, ...extra }
		return this._client._invokeTyped(method, typed, cmd, 'CG')
	}

	cgAdd(channel, layer, templateHostLayer, template, playOnLoad, data) {
		const p = param(template)
		const templateParam = p.startsWith('"') ? p : `"${p}"`
		let cmd = `CG ${chLayer(channel, layer)} ADD ${parseInt(templateHostLayer, 10)} ${templateParam}`
		cmd += ' ' + (playOnLoad ? 1 : 0)
		if (data) cmd += ' ' + param(data)
		// Library cgDataSerializer may differ from HighAsCG param(data) — keep raw when data present.
		if (data) return this._send(cmd, 'CG')
		return this._cgTyped('cgAdd', channel, layer, templateHostLayer, cmd, {
			template: String(template).replace(/^"|"$/g, ''),
			playOnLoad: !!playOnLoad,
		})
	}

	cgPlay(channel, layer, templateHostLayer) {
		const cl = chLayer(channel, layer)
		const th = parseInt(templateHostLayer, 10)
		return this._cgTyped('cgPlay', channel, layer, templateHostLayer, `CG ${cl} PLAY ${th}`)
	}

	cgStop(channel, layer, templateHostLayer) {
		const cl = chLayer(channel, layer)
		const th = parseInt(templateHostLayer, 10)
		return this._cgTyped('cgStop', channel, layer, templateHostLayer, `CG ${cl} STOP ${th}`)
	}

	cgNext(channel, layer, templateHostLayer) {
		const cl = chLayer(channel, layer)
		const th = parseInt(templateHostLayer, 10)
		return this._cgTyped('cgNext', channel, layer, templateHostLayer, `CG ${cl} NEXT ${th}`)
	}

	cgRemove(channel, layer, templateHostLayer) {
		const cl = chLayer(channel, layer)
		const th = parseInt(templateHostLayer, 10)
		return this._cgTyped('cgRemove', channel, layer, templateHostLayer, `CG ${cl} REMOVE ${th}`)
	}

	cgClear(channel, layer) {
		const cl = chLayer(channel, layer)
		return this._client._invokeTyped('cgClear', { channel: Number(channel), layer: Number(layer) }, `CG ${cl} CLEAR`, 'CG')
	}

	cgGoto(channel, layer, templateHostLayer, label) {
		let cmd = `CG ${chLayer(channel, layer)} GOTO ${parseInt(templateHostLayer, 10)}`
		if (label) cmd += ' ' + param(label)
		return this._send(cmd, 'CG')
	}

	cgUpdate(channel, layer, templateHostLayer, data) {
		const cl = chLayer(channel, layer)
		const th = parseInt(templateHostLayer, 10)
		return this._cgTyped('cgUpdate', channel, layer, templateHostLayer, `CG ${cl} UPDATE ${th} ${param(data)}`, {
			data,
		})
	}

	cgInvoke(channel, layer, templateHostLayer, method) {
		const cl = chLayer(channel, layer)
		const th = parseInt(templateHostLayer, 10)
		return this._cgTyped('cgInvoke', channel, layer, templateHostLayer, `CG ${cl} INVOKE ${th} ${param(method)}`, {
			method: String(method),
		})
	}

	cgInfo(channel, layer, templateHostLayer) {
		let cmd = `CG ${chLayer(channel, layer)} INFO`
		if (templateHostLayer != null) {
			cmd += ' ' + parseInt(templateHostLayer, 10)
			return this._cgTyped('cgInfo', channel, layer, templateHostLayer, cmd)
		}
		return this._client._invokeTyped('cgInfo', { channel: Number(channel), layer: Number(layer) }, cmd, 'CG')
	}
}

module.exports = { AmcpCg }

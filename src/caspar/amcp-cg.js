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

	cgAdd(channel, layer, templateHostLayer, template, playOnLoad, data) {
		let cmd = `CG ${chLayer(channel, layer)} ADD ${parseInt(templateHostLayer, 10)} ${param(template)}`
		cmd += ' ' + (playOnLoad ? 1 : 0)
		if (data) cmd += ' ' + param(data)
		return this._send(cmd, 'CG')
	}

	cgPlay(channel, layer, templateHostLayer) {
		return this._send(`CG ${chLayer(channel, layer)} PLAY ${parseInt(templateHostLayer, 10)}`, 'CG')
	}

	cgStop(channel, layer, templateHostLayer) {
		return this._send(`CG ${chLayer(channel, layer)} STOP ${parseInt(templateHostLayer, 10)}`, 'CG')
	}

	cgNext(channel, layer, templateHostLayer) {
		return this._send(`CG ${chLayer(channel, layer)} NEXT ${parseInt(templateHostLayer, 10)}`, 'CG')
	}

	cgRemove(channel, layer, templateHostLayer) {
		return this._send(`CG ${chLayer(channel, layer)} REMOVE ${parseInt(templateHostLayer, 10)}`, 'CG')
	}

	cgClear(channel, layer) {
		return this._send(`CG ${chLayer(channel, layer)} CLEAR`, 'CG')
	}

	cgGoto(channel, layer, templateHostLayer, label) {
		let cmd = `CG ${chLayer(channel, layer)} GOTO ${parseInt(templateHostLayer, 10)}`
		if (label) cmd += ' ' + param(label)
		return this._send(cmd, 'CG')
	}

	cgUpdate(channel, layer, templateHostLayer, data) {
		return this._send(`CG ${chLayer(channel, layer)} UPDATE ${parseInt(templateHostLayer, 10)} ${param(data)}`, 'CG')
	}

	cgInvoke(channel, layer, templateHostLayer, method) {
		return this._send(`CG ${chLayer(channel, layer)} INVOKE ${parseInt(templateHostLayer, 10)} ${param(method)}`, 'CG')
	}

	cgInfo(channel, layer, templateHostLayer) {
		let cmd = `CG ${chLayer(channel, layer)} INFO`
		if (templateHostLayer != null) cmd += ' ' + parseInt(templateHostLayer, 10)
		return this._send(cmd, 'CG')
	}
}

module.exports = { AmcpCg }

'use strict'

const { param, chLayer } = require('./amcp-utils')
const { resolveCasparCinfMediaId, toCasparClsMediaId } = require('../media/caspar-cls-id')

class AmcpQuery {
	/**
	 * @param {import('./amcp-client').AmcpClient} client
	 */
	constructor(client) {
		this._client = client
	}

	_send(cmd, responseKey) {
		return this._client._send(cmd, responseKey)
	}

	/**
	 * @param {string} filename
	 * @param {{ ctx?: object }} [opts]
	 */
	cinf(filename, opts = {}) {
		const id = opts?.ctx ? resolveCasparCinfMediaId(filename, opts.ctx) : toCasparClsMediaId(filename)
		return this._send(`CINF ${param(id)}`, 'CINF')
	}

	cls(subDir) {
		if (subDir) return this._send(`CLS ${param(subDir)}`, 'CLS')
		return this._client._invokeTyped('cls', {}, 'CLS', 'CLS')
	}

	fls() {
		return this._client._invokeTyped('fls', {}, 'FLS', 'FLS')
	}

	tls(subDir) {
		if (subDir) return this._send(subDir ? `TLS ${param(subDir)}` : 'TLS', 'TLS')
		return this._client._invokeTyped('tls', {}, 'TLS', 'TLS')
	}

	version(component) {
		if (component) return this._send(`VERSION ${param(component)}`, 'VERSION')
		return this._client._invokeTyped('version', {}, 'VERSION', 'VERSION')
	}

	/**
	 * @param {number|string} [channel]
	 * @param {number|string} [layer]
	 */
	info(channel, layer) {
		if (channel != null && channel !== '') return this.infoChannel(channel, layer)
		return this._client._invokeTyped('info', {}, 'INFO', 'INFO')
	}

	infoChannel(channel, layer) {
		let cmd = 'INFO'
		const typed = { channel: Number(channel) }
		if (channel != null && channel !== '') cmd += ' ' + chLayer(channel, layer)
		if (layer != null && layer !== '') {
			typed.layer = Number(layer)
			return this._client._invokeTyped('infoLayer', typed, cmd, 'INFO')
		}
		return this._client._invokeTyped('infoChannel', typed, cmd, 'INFO')
	}

	infoTemplate(filename) {
		return this._send(`INFO TEMPLATE ${param(filename)}`, 'INFO')
	}

	infoConfig() {
		return this._client._invokeTyped('infoConfig', {}, 'INFO CONFIG', 'INFO')
	}

	infoPaths() {
		return this._client._invokeTyped('infoPaths', {}, 'INFO PATHS', 'INFO')
	}

	infoSystem() {
		return this._client._invokeTyped('infoSystem', {}, 'INFO SYSTEM', 'INFO')
	}

	infoServer() {
		return this._client._invokeTyped('infoServer', {}, 'INFO SERVER', 'INFO')
	}

	infoQueues() {
		return this._client._invokeTyped('infoQueues', {}, 'INFO QUEUES', 'INFO')
	}

	infoThreads() {
		return this._client._invokeTyped('infoThreads', {}, 'INFO THREADS', 'INFO')
	}

	infoDelay(channel, layer) {
		let cmd = 'INFO'
		if (channel != null && channel !== '') cmd += ' ' + chLayer(channel, layer)
		cmd += ' DELAY'
		return this._send(cmd, 'INFO')
	}

	diag() {
		return this._client._invokeTyped('diag', {}, 'DIAG', 'DIAG')
	}

	glInfo() {
		return this._client._invokeTyped('glInfo', {}, 'GL INFO', 'GL')
	}

	glGc() {
		return this._client._invokeTyped('glGc', {}, 'GL GC', 'GL')
	}

	bye() {
		return this._send('BYE', 'BYE')
	}

	kill() {
		return this._send('KILL', 'KILL')
	}

	restart() {
		return this._send('RESTART', 'RESTART')
	}

	help(command) {
		const cmd = command ? `HELP ${param(command)}` : 'HELP'
		return this._send(cmd, 'HELP')
	}

	helpProducer(producer) {
		const cmd = producer ? `HELP PRODUCER ${param(producer)}` : 'HELP PRODUCER'
		return this._send(cmd, 'HELP')
	}

	helpConsumer(consumer) {
		const cmd = consumer ? `HELP CONSUMER ${param(consumer)}` : 'HELP CONSUMER'
		return this._send(cmd, 'HELP')
	}
}

module.exports = { AmcpQuery }

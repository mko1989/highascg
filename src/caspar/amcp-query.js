'use strict'

const { param, chLayer } = require('./amcp-utils')

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

	cinf(filename) {
		return this._send(`CINF ${param(filename)}`, 'CINF')
	}

	cls(subDir) {
		return this._send(subDir ? `CLS ${param(subDir)}` : 'CLS', 'CLS')
	}

	fls() {
		return this._send('FLS', 'FLS')
	}

	tls(subDir) {
		return this._send(subDir ? `TLS ${param(subDir)}` : 'TLS', 'TLS')
	}

	version(component) {
		const cmd = component ? `VERSION ${param(component)}` : 'VERSION'
		return this._send(cmd, 'VERSION')
	}

	info() {
		return this._send('INFO', 'INFO')
	}

	/**
	 * @param {number|string} [channel]
	 * @param {number|string} [layer]
	 */
	info(channel, layer) {
		if (channel != null && channel !== '') return this.infoChannel(channel, layer)
		return this.info()
	}

	infoChannel(channel, layer) {
		let cmd = 'INFO'
		if (channel != null && channel !== '') cmd += ' ' + chLayer(channel, layer)
		return this._send(cmd, 'INFO')
	}

	infoTemplate(filename) {
		return this._send(`INFO TEMPLATE ${param(filename)}`, 'INFO')
	}

	infoConfig() {
		return this._send('INFO CONFIG', 'INFO')
	}

	infoPaths() {
		return this._send('INFO PATHS', 'INFO')
	}

	infoSystem() {
		return this._send('INFO SYSTEM', 'INFO')
	}

	infoServer() {
		return this._send('INFO SERVER', 'INFO')
	}

	infoQueues() {
		return this._send('INFO QUEUES', 'INFO')
	}

	infoThreads() {
		return this._send('INFO THREADS', 'INFO')
	}

	infoDelay(channel, layer) {
		let cmd = 'INFO'
		if (channel != null && channel !== '') cmd += ' ' + chLayer(channel, layer)
		cmd += ' DELAY'
		return this._send(cmd, 'INFO')
	}

	diag() {
		return this._send('DIAG', 'DIAG')
	}

	glInfo() {
		return this._send('GL INFO', 'GL')
	}

	glGc() {
		return this._send('GL GC', 'GL')
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

'use strict'

/** Flat convenience aliases on {@link AmcpClient}. */
module.exports = {
	play(channel, layer, clip, opts) {
		return this.basic.play(channel, layer, clip, opts)
	},

	loadbg(channel, layer, clip, opts) {
		return this.basic.loadbg(channel, layer, clip, opts)
	},

	pause(channel, layer) {
		return this.basic.pause(channel, layer)
	},

	resume(channel, layer) {
		return this.basic.resume(channel, layer)
	},

	stop(channel, layer) {
		return this.basic.stop(channel, layer)
	},

	call(channel, layer, fn, paramsStr) {
		return this.basic.call(channel, layer, fn, paramsStr)
	},

	clear(channel, layer) {
		return this.basic.clear(channel, layer)
	},

	mixerFill(...args) {
		return this.mixer.mixerFill(...args)
	},

	mixerCommit(...args) {
		return this.mixer.mixerCommit(...args)
	},

	mixerOpacity(...args) {
		return this.mixer.mixerOpacity(...args)
	},

	mixerVolume(...args) {
		return this.mixer.mixerVolume(...args)
	},

	mixerClear(...args) {
		return this.mixer.mixerClear(...args)
	},

	cgAdd(...args) {
		return this.cg.cgAdd(...args)
	},

	cgUpdate(...args) {
		return this.cg.cgUpdate(...args)
	},

	cgPlay(...args) {
		return this.cg.cgPlay(...args)
	},

	cgStop(...args) {
		return this.cg.cgStop(...args)
	},

	cgNext(...args) {
		return this.cg.cgNext(...args)
	},

	cgRemove(...args) {
		return this.cg.cgRemove(...args)
	},

	version(component) {
		return this.query.version(component)
	},

	info(channel, layer) {
		return this.query.info(channel, layer)
	},

	diag() {
		return this.query.diag()
	},

	bye() {
		return this.query.bye()
	},

	thumbnailList(subDir) {
		return this.thumb.thumbnailList(subDir)
	},

	thumbnailRetrieve(filename) {
		return this.thumb.thumbnailRetrieve(filename)
	},

	thumbnailGenerate(filename) {
		return this.thumb.thumbnailGenerate(filename)
	},

	thumbnailGenerateAll() {
		return this.thumb.thumbnailGenerateAll()
	},

	raw(cmd) {
		const first = (cmd.trim().match(/^(\S+)/) || [])[1]
		return this._send(cmd, first)
	},

	batchSend(commandLines, opts) {
		return this.batch.batchSend(commandLines, opts)
	},

	batchSendChunked(commandLines, opts) {
		return this.batch.batchSendChunked(commandLines, opts)
	},
}

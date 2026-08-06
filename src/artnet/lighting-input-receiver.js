'use strict'

const { ArtnetReceiver } = require('./artnet-receiver')
const { SacnReceiver } = require('./sacn-receiver')
const {
	slotLightingProtocol,
	resolveArtnetPatch,
	loadProjectScenesForLookup,
	globalBorderSlotFromScenes,
} = require('./artnet-slot-config')

/**
 * Protocol dispatch for the global-border lighting input (WO-446, completes WO-179 T179.4).
 *
 * The inspector's Art-Net/sACN select was saved to the slot and `slotLightingProtocol()` could
 * read it — but NOTHING did: index.js constructed ArtnetReceiver unconditionally, so choosing
 * sACN silently kept Art-Net running (the fifth WO-367 lost-wiring find). This facade owns
 * whichever receiver the slot asks for and swaps on reconfigure. It exposes exactly the
 * surface every call site already uses (init / reconfigure / reconfigureFromProject / stop /
 * getInputStatus), so `appCtx.artnetReceiver` keeps its name and no call site changes.
 */
class LightingInputReceiver {
	constructor(appCtx) {
		this.appCtx = appCtx
		this.log = appCtx.log || console.log
		this._active = null
		this._activeProtocol = null
	}

	_desiredProtocol(projectScenes = null) {
		try {
			const patch = resolveArtnetPatch(this.appCtx, null, projectScenes)
			const scenes = loadProjectScenesForLookup(this.appCtx, projectScenes)
			const slot = globalBorderSlotFromScenes(scenes, patch.screenIndex ?? 0)
			return slotLightingProtocol(slot)
		} catch {
			return 'artnet'
		}
	}

	/** @returns {boolean} true when a fresh receiver instance was created */
	_ensureActive(protocol) {
		if (this._active && this._activeProtocol === protocol) return false
		if (this._active) {
			this.log('info', `[Lighting] Input protocol ${this._activeProtocol} → ${protocol} — restarting receiver`)
			try {
				this._active.stop()
			} catch {
				/* old transport may already be down */
			}
		}
		this._active = protocol === 'sacn' ? new SacnReceiver(this.appCtx) : new ArtnetReceiver(this.appCtx)
		this._activeProtocol = protocol
		return true
	}

	_masterEnabled() {
		return this.appCtx.config?.dmx?.artnetInputEnabled !== false
	}

	init(options = {}) {
		this._ensureActive(this._desiredProtocol())
		this._active.init(options)
	}

	/* On a fresh instance, mirror the boot sequence: init() (which reads port/intervals from
	 * config and does the first bind) runs only when the DMX master switch is on — index.js
	 * guards it the same way. The follow-up reconfigure is idempotent over init. */
	_initFreshIfEnabled(fresh) {
		if (fresh && this._masterEnabled()) this._active.init()
	}

	reconfigure(patch = null) {
		this._initFreshIfEnabled(this._ensureActive(this._desiredProtocol()))
		return this._active.reconfigure(patch)
	}

	reconfigureFromProject(project) {
		const scenes = project?.scenes && typeof project.scenes === 'object' ? project.scenes : null
		this._initFreshIfEnabled(this._ensureActive(this._desiredProtocol(scenes)))
		return this._active.reconfigureFromProject(project)
	}

	stop() {
		if (this._active) this._active.stop()
	}

	getInputStatus() {
		if (!this._active) return { listening: false, protocol: this._activeProtocol }
		return { ...this._active.getInputStatus(), protocol: this._activeProtocol }
	}
}

module.exports = { LightingInputReceiver }

'use strict'

/**
 * WO-711 wiring — the PTZ service (src/ptz/ptz-service.js) driven by the Auto director (WO-708): each tick asks
 * director.ptzTargetOf(camId) (a slot's person, A1 for an `auto` camera, 'home' with the fronts) and the service sends
 * VISCA at ≤ 10 Hz per camera itself. Cameras come from project.previs.tracking.ptz (at boot, then on every project
 * change); the director lists them in GET /api/tracking/auto `ptz`. Out of register.js for its 500-line limit.
 */

const { createPtzService } = require('../ptz/ptz-service')

function createAutoPtz(director) {
	let svc = null
	let off = null

	return {
		/** @param {object} ctx  server ctx (log); `allowed` = this server's `ptz` duty (WO-712 R1), default on */
		boot(ctx, { allowed } = {}) {
			this.stop()
			const log = typeof ctx?.log === 'function' ? ctx.log.bind(ctx) : () => {}
			svc = createPtzService({ log, ...(allowed ? { allowed } : {}) })
			director.setPtz(svc)
			const apply = (project) => svc?.configure(project)
			try {
				apply(require('../engine/project-scenes').loadFullProject())
			} catch (e) {
				log('warn', '[tracking] ptz: project load: ' + (e?.message || e))
			}
			off = require('../engine/project-events').onProjectChanged(apply)
		},
		tick(now) {
			if (svc) svc.step(now, director.ptzTargetOf)
		},
		stop() {
			if (off) off()
			off = null
			if (svc) svc.close()
			svc = null
			director.setPtz(null)
		},
	}
}

module.exports = { createAutoPtz }

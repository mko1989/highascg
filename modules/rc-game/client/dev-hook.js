/* global window, URLSearchParams */
/**
 * Test hook of the RC game (WO-1082, like Stage Skirmish's): ONLY when the page runs on 127.0.0.1 with `?dev=1` (the
 * headless check on the box) it exposes `window.__rcDev` — the session object and a fixed camera pose for screenshots
 * (`setCam({ eye: [x, y, z], target: [x, y, z] })`, null = the game's own camera again). Never active on the box's own
 * address or without the flag.
 */
export function devHookAllowed(loc) {
	try {
		return loc.hostname === '127.0.0.1' && new URLSearchParams(loc.search).get('dev') === '1'
	} catch {
		return false
	}
}

export function installDevHook(G) {
	if (!devHookAllowed(window.location)) return false
	window.__rcDev = {
		G,
		setCam: (pose) => {
			G.devCam = pose && Array.isArray(pose.eye) && Array.isArray(pose.target) ? pose : null
			if (G.devCam) G.world.setFov(60)
		},
		scene: () => ({ rev: G.scene?.rev, floors: G.scene?.floors, venue: G.scene?.venue, bounds: G.scene?.bounds }),
	}
	return true
}

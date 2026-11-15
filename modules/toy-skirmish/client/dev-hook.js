/* global window, URLSearchParams */
/**
 * Test hook of Stage Skirmish (WO-1081): ONLY when the page runs on 127.0.0.1 with `?dev=1` (the headless check
 * against the dev server) it exposes `window.__skDev` — the session object and a way to drive the input (move / aim
 * / fire) without real keys. Never active on the box's own address or without the flag.
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
	window.__skDev = {
		G,
		/** @param {{ mx?: number, mz?: number, yaw?: number, fire?: boolean, pick?: number } | null} o */
		setInput: (o) => G.input?.setOverride(o),
		me: () => ({ id: G.meId, x: G.my?.x, z: G.my?.z, yaw: G.my?.yaw, alive: G.alive, held: G.held, me: G.me, phase: G.phase }),
		remotes: () => [...G.remotes.values()].map((r) => ({ id: r.id, name: r.name, alive: r.alive, x: r.pose?.x, z: r.pose?.z })),
	}
	return true
}

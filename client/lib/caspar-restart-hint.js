/**
 * Notify Device View that generated Caspar config is stale (orange Apply & restart).
 */
export function markCasparRestartDirty() {
	try {
		window.dispatchEvent(new CustomEvent('highascg-caspar-restart-dirty'))
	} catch {
		/* non-browser */
	}
}

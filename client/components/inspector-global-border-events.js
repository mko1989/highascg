export function requestGlobalBorderPush() {
	window.dispatchEvent(new CustomEvent('highascg-global-border-push'))
}

export function scheduleGlobalBorderConfigSave() {
	window.dispatchEvent(new CustomEvent('highascg-global-border-config-save'))
}

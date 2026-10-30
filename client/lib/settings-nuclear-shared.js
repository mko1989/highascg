/**
 * Nuclear tab helpers — password field visibility.
 */

/**
 * @param {ParentNode} modal
 * @returns {string}
 */
export function getNuclearPasswordFromModal(modal) {
	return (modal.querySelector('#set-nuclear-password') || {}).value || ''
}

/**
 * Show the configured nuclear password field only when protection is enabled.
 * @param {ParentNode} modal
 */
export function syncNuclearPasswordVisibility(modal) {
	const required = !!(modal.querySelector('#set-nuclear-require-pass') || {}).checked
	const fields = modal.querySelector('#set-nuclear-password-fields')
	if (fields) fields.style.display = required ? '' : 'none'
}

/**
 * WO-830c: why the "Set password" action must not run ('' = fine). Setting is explicit (new + repeat + button) because
 * the password field used to autosave: a typo'd reboot attempt silently REPLACED the stored password.
 * @param {string} [first]
 * @param {string} [again]
 * @returns {string}
 */
export function validateNewNuclearPassword(first, again) {
	const a = String(first ?? '').trim()
	if (!a) return 'Type the new password first.'
	if (a !== String(again ?? '').trim()) return 'The two entries differ - nothing changed.'
	return ''
}

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

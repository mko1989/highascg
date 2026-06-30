/**
 * NDI SDK license attribution — link + registered trademark notice (WO-90 / NDI SDK terms).
 */

export const NDI_TRADEMARK_NOTICE = 'NDI® is a registered trademark of Vizrt NDI AB'

/**
 * @param {string} [className]
 * @returns {HTMLParagraphElement}
 */
export function createNdiAttributionElement(className = 'settings-note ndi-attribution') {
	const p = document.createElement('p')
	p.className = className
	const ndiLink = document.createElement('a')
	ndiLink.href = 'https://ndi.video/'
	ndiLink.target = '_blank'
	ndiLink.rel = 'noopener noreferrer'
	ndiLink.textContent = 'NDI®'
	const siteLink = document.createElement('a')
	siteLink.href = 'https://ndi.video/'
	siteLink.target = '_blank'
	siteLink.rel = 'noopener noreferrer'
	siteLink.textContent = 'ndi.video'
	p.append('Uses ', ndiLink, ' (', siteLink, '). ', document.createTextNode(`${NDI_TRADEMARK_NOTICE}.`))
	return p
}

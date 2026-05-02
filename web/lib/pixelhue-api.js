import { api } from './api-client.js'

function listFromResponse(res) {
	if (Array.isArray(res)) return res
	if (!res || typeof res !== 'object') return []
	if (Array.isArray(res.list)) return res.list
	if (res.data && Array.isArray(res.data.list)) return res.data.list
	if (res.data && Array.isArray(res.data)) return res.data
	return []
}

export async function getPixelhueStatus() {
	return await api.get('/api/pixelhue/status')
}

export async function getPixelhueScreens() {
	const res = await api.get('/api/pixelhue/screens')
	return listFromResponse(res)
}

export async function getPixelhueLayers() {
	const res = await api.get('/api/pixelhue/layers')
	return listFromResponse(res)
}

export async function getPixelhuePresets() {
	const res = await api.get('/api/pixelhue/presets')
	return listFromResponse(res)
}

export async function getPixelhueInterfaces() {
	const res = await api.get('/api/pixelhue/interfaces')
	return listFromResponse(res)
}

export async function getPixelhueLayerPresets() {
	const res = await api.get('/api/pixelhue/layer-presets')
	return listFromResponse(res)
}

export async function getPixelhueSourceBackup() {
	return await api.get('/api/pixelhue/source-backup')
}

export async function setPixelhueTake(body) {
	return await api.post('/api/pixelhue/take', body)
}

export async function setPixelhueCut(body) {
	return await api.post('/api/pixelhue/cut', body)
}

export async function setPixelhueFtb(body) {
	return await api.post('/api/pixelhue/ftb', body)
}

export async function setPixelhueFreeze(body) {
	return await api.post('/api/pixelhue/freeze', body)
}

export async function setPixelhueLayerSelect(body) {
	return await api.post('/api/pixelhue/layer-select', body)
}

export async function setPixelhueLayerSource(body) {
	return await api.post('/api/pixelhue/layer-source', body)
}

export async function setPixelhueLayerZorder(body) {
	return await api.post('/api/pixelhue/layer-zorder', body)
}

export async function setPixelhueLayerWindow(body) {
	return await api.post('/api/pixelhue/layer-window', body)
}

export async function setPixelhueLayerUmd(body) {
	return await api.post('/api/pixelhue/layer-umd', body)
}

export async function setPixelhueLayerPresetApply(body) {
	return await api.post('/api/pixelhue/layer-preset-apply', body)
}

export async function setPixelhueSourceBackup(body) {
	return await api.post('/api/pixelhue/source-backup', body)
}

export async function setPixelhuePresetApply(body) {
	return await api.post('/api/pixelhue/preset-apply', body)
}

export const pixelhueApi = {
	getStatus: getPixelhueStatus,
	getScreens: getPixelhueScreens,
	getPresets: getPixelhuePresets,
	getLayers: getPixelhueLayers,
	getInterfaces: getPixelhueInterfaces,
	getLayerPresets: getPixelhueLayerPresets,
	getSourceBackup: getPixelhueSourceBackup,
	setTake: setPixelhueTake,
	setCut: setPixelhueCut,
	setFtb: setPixelhueFtb,
	setFreeze: setPixelhueFreeze,
	setLayerSelect: setPixelhueLayerSelect,
	setLayerSource: setPixelhueLayerSource,
	setLayerZorder: setPixelhueLayerZorder,
	setLayerWindow: setPixelhueLayerWindow,
	setLayerUmd: setPixelhueLayerUmd,
	setLayerPresetApply: setPixelhueLayerPresetApply,
	setSourceBackup: setPixelhueSourceBackup,
	setPresetApply: setPixelhuePresetApply,
}


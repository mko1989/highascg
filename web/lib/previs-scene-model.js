/**
 * Previs scene model host.
 */
import { tagScreenMesh, untagScreenMesh, readScreenTag, traverseMeshes } from './previs-mesh-info.js'
import { disposeModel } from './previs-model-loader.js'
import { applyVirtualCanvasRegionToTexture, resolveCanvasRegionFromTag } from './previs-texture-crop.js'
import * as MatH from './previs-scene-materials.js'
import * as Utils from './previs-scene-utils.js'

const HOST_GROUP_NAME = 'previs:model-host'; const DEFAULT_SOURCE_ID = 'pgm'

export function createPrevisSceneModel(opts) {
	const { scene, THREE, streamManager } = opts; if (!scene || !THREE || !streamManager) throw new Error('Missing deps')
	const getVC = typeof opts.getVirtualCanvas === 'function' ? opts.getVirtualCanvas : null
	const defSrc = opts.defaultSourceId || DEFAULT_SOURCE_ID; const showDemo = opts.showDemoWhenEmpty !== false; const emissive = MatH.resolveEmissive(opts.emissive)
	const hostG = new THREE.Group(); hostG.name = HOST_GROUP_NAME; scene.add(hostG)

	let demoB = null; let currentModel = null; const meshB = new Map(); let selHelper = null; let selectedM = null
	const cloneTex = (m) => { if (m?.clone) { const c = m.clone(); c.needsUpdate = true; return c } return m }
	const syncTex = (d, m) => { if (d && m) { d.image = m.image; if ('colorSpace' in m) d.colorSpace = m.colorSpace; d.needsUpdate = true } }
	const applyCrop = (m, t) => { if (getVC && m && t) { const vc = getVC(); if (vc?.width > 0) applyVirtualCanvasRegionToTexture(t, vc, resolveCanvasRegionFromTag(readScreenTag(m), vc)) } }

	const addDemo = () => {
		if (demoB) return; const b = streamManager.acquire(defSrc); if (!b) return
		const dt = cloneTex(b.texture); const m = Utils.buildDemoScreenMesh(THREE, dt, MatH.createScreenMaterial, emissive)
		const u = b.onTextureChanged(t => { syncTex(dt, t); MatH.applyTextureToScreenMaterial(m.material, dt, emissive); applyCrop(m, dt) })
		applyCrop(m, dt); hostG.add(m); demoB = { mesh: m, sourceId: defSrc, material: m.material, textureBinding: b, displayTexture: dt, unsubscribe: u }
		if (opts.onScreenBound) opts.onScreenBound(m, { tagSource: 'demo' })
	}
	const removeDemo = () => { if (!demoB) return; try { demoB.unsubscribe() } catch {}; if (demoB.mesh.parent) demoB.mesh.parent.remove(demoB.mesh); streamManager.release(demoB.sourceId); demoB = null }
	const unbind = (m) => { const e = meshB.get(m.uuid); if (!e) return; try { e.unsubscribe() } catch {}; if (e.originalMaterial) m.material = e.originalMaterial; streamManager.release(e.sourceId); meshB.delete(m.uuid) }
	const bind = (m, sid, tag) => {
		const b = streamManager.acquire(sid); if (!b) return null; const orig = m.material; const dt = cloneTex(b.texture)
		const mat = MatH.createScreenMaterial(THREE, dt, emissive); m.material = mat; const u = b.onTextureChanged(t => { syncTex(dt, t); MatH.applyTextureToScreenMaterial(mat, dt, emissive); applyCrop(m, dt) })
		applyCrop(m, dt); const e = { mesh: m, sourceId: sid, material: mat, originalMaterial: orig, textureBinding: b, displayTexture: dt, unsubscribe: u }; meshB.set(m.uuid, e)
		if (opts.onScreenBound) opts.onScreenBound(m, { tagSource: tag }); return e
	}
	const refreshBinding = () => {
		if (!currentModel) return; const wanted = new Map(); traverseMeshes(currentModel.root, m => { const t = readScreenTag(m); if (t) wanted.set(m.uuid, { m, sid: t.source || defSrc }) })
		for (const [id, e] of Array.from(meshB.entries())) if (!wanted.has(id) || wanted.get(id).sid !== e.sourceId) unbind(e.mesh)
		for (const { m, sid } of wanted.values()) if (!meshB.has(m.uuid)) bind(m, sid, 'tag')
		if (meshB.size > 0) removeDemo(); else if (showDemo && !demoB) addDemo()
	}

	const setModel = (m) => { for (const e of Array.from(meshB.values())) unbind(e.mesh); removeDemo(); if (currentModel) disposeModel(currentModel); currentModel = m; if (!m) { if (showDemo) addDemo(); return } hostG.add(m.root); const tagged = Utils.collectTaggedMeshes(m.root); if (tagged.length) tagged.forEach(x => bind(x, readScreenTag(x)?.source || defSrc, 'tag')); else { const a = Utils.pickAutoScreen(m.root, THREE); if (a) { tagScreenMesh(a, { screenId: a.uuid, source: defSrc }); bind(a, defSrc, 'auto') } else if (showDemo) addDemo() } }

	if (showDemo) addDemo()
	return {
		setModel, getModel: () => currentModel, getScreenMesh: () => meshB.size ? meshB.values().next().value.mesh : demoB?.mesh,
		getMeshSource: id => meshB.get(id)?.sourceId, getBindings: () => meshB, getSelection: () => selectedM,
		getScreenMappingSummary: id => {
			let e = meshB.get(id) || (demoB?.mesh.uuid === id ? demoB : null); if (!e) return null
			const sz = new THREE.Vector3(); new THREE.Box3().setFromObject(e.mesh).getSize(sz); const mw = { widthM: Math.max(sz.x, sz.z), heightM: sz.y }
			const tb = e.textureBinding; let vp = null; try { vp = tb.getVideoFrameDimensions() } catch {}; if (!vp || vp.width <= 0) vp = null
			const vc = getVC?.() || { width: 1920, height: 1080 }
			return { mode: 'uv0', videoPixels: vp, videoLive: !!tb?.isLive, meshWorld: mw, videoAspect: vp ? vp.width/vp.height : null, meshAspect: mw.widthM/mw.heightM, virtualCanvas: vc, canvasRegion: resolveCanvasRegionFromTag(readScreenTag(e.mesh), vc) }
		},
		refreshTextureCrop: () => { for (const e of meshB.values()) if (e.material.map) applyCrop(e.mesh, e.material.map); if (demoB?.material.map) applyCrop(demoB.mesh, demoB.material.map) },
		refreshBinding, tagMeshAsScreen: (m, t) => { if (!m) return; tagScreenMesh(m, { screenId: t?.screenId || m.uuid, source: t?.source || readScreenTag(m)?.source || defSrc, ...t }); refreshBinding() },
		untagMesh: m => { if (m) { untagScreenMesh(m); refreshBinding() } }, setMeshSource: (m, sid) => { if (m) { tagScreenMesh(m, { ...(readScreenTag(m) || { screenId: m.uuid }), source: sid }); refreshBinding() } },
		setSelection: m => { if (selectedM === m) return; if (selHelper) { if (selHelper.parent) selHelper.parent.remove(selHelper); selHelper = null } selectedM = m; if (m) { selHelper = new THREE.BoxHelper(m, 0x00d0ff); selHelper.material.depthTest = false; scene.add(selHelper) } },
		setEmissiveIntensity: i => { emissive.intensity = i; for (const e of meshB.values()) if (e.material.emissiveIntensity != null) e.material.emissiveIntensity = i; if (demoB?.material.emissiveIntensity != null) demoB.material.emissiveIntensity = i },
		dispose: () => { for (const e of Array.from(meshB.values())) unbind(e.mesh); removeDemo(); if (currentModel) disposeModel(currentModel); if (hostG.parent) hostG.parent.remove(hostG) }
	}
}
export { HOST_GROUP_NAME, DEFAULT_SOURCE_ID }

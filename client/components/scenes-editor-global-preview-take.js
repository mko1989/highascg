import { resolveMainIndexForScene } from '../lib/look-stack-amcp-channel.js'

export function createGlobalPreviewTakeCut({ sceneState, showScenesToast, getTakeSceneToProgram }) {
	// All armed screens take TOGETHER (WO-150 B150.6) — one batched dispatch instead of
	// awaiting each screen's full transition before starting the next.
	const collectArmedPreviewEntries = () => {
		const armed = sceneState.armedScreenIndices?.length ? sceneState.armedScreenIndices : [sceneState.activeScreenIndex]
		const entries = []
		for (const mIdx of armed) {
			const sid = sceneState.getPreviewSceneIdForMain(mIdx)
			if (sid) entries.push({ sceneId: sid, mainIdx: mIdx })
		}
		return entries
	}

	const globalTakeFromPreview = async () => {
		const takeSceneToProgram = getTakeSceneToProgram()
		// WO-185 T185.1: If editing a scene with a specific mainScope, take the edited scene to its main
		if (sceneState.editingSceneId) {
			const scene = sceneState.getScene(sceneState.editingSceneId)
			if (scene) {
				const scope = String(scene.mainScope || 'all')
				// Only override if scope is NOT 'all' - 'all' scope uses armed-preview logic
				if (scope !== 'all') {
					const mainIdx = resolveMainIndexForScene(scene, sceneState)
					await takeSceneToProgram(sceneState.editingSceneId, false, { targetMains: [mainIdx] })
					return
				}
			}
		}

		// Otherwise use armed-preview logic
		const entries = collectArmedPreviewEntries()
		if (!entries.length) {
			showScenesToast('No look on preview. Click a look thumbnail (canvas) first.', 'error')
			return
		}
		await takeSceneToProgram.batch(entries, false, {})
	}

	const globalCutFromPreview = async () => {
		const takeSceneToProgram = getTakeSceneToProgram()
		// WO-185 T185.1: If editing a scene with a specific mainScope, cut the edited scene to its main
		if (sceneState.editingSceneId) {
			const scene = sceneState.getScene(sceneState.editingSceneId)
			if (scene) {
				const scope = String(scene.mainScope || 'all')
				// Only override if scope is NOT 'all' - 'all' scope uses armed-preview logic
				if (scope !== 'all') {
					const mainIdx = resolveMainIndexForScene(scene, sceneState)
					await takeSceneToProgram(sceneState.editingSceneId, true, { targetMains: [mainIdx] })
					return
				}
			}
		}

		// Otherwise use armed-preview logic
		const entries = collectArmedPreviewEntries()
		if (!entries.length) {
			showScenesToast('No look on preview. Click a look thumbnail first.', 'error')
			return
		}
		await takeSceneToProgram.batch(entries, true, {})
	}

	return { globalTakeFromPreview, globalCutFromPreview }
}

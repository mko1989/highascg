/**
 * Commit in-progress look name inputs before DOM rebuild (avoids losing renames).
 * @param {ParentNode | null | undefined} root
 * @param {{ getScene: (id: string) => object | undefined, setSceneName: (id: string, name: string) => void, editingSceneId?: string | null }} sceneState
 */
export function commitPendingLookNameEdits(root, sceneState) {
	if (!root || !sceneState) return
	const sel = '.scenes-card__name-input, .scenes-edit-name, #scenes-name'
	root.querySelectorAll(sel).forEach((input) => {
		if (!(input instanceof HTMLInputElement)) return
		const card = input.closest('[data-scene-id]')
		const id =
			(card?.dataset?.sceneId && String(card.dataset.sceneId)) ||
			(sceneState.editingSceneId ? String(sceneState.editingSceneId) : null)
		if (!id || !sceneState.getScene(id)) return
		sceneState.setSceneName(id, input.value)
	})
}

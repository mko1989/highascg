import { buildLtEditorComponents, LT_CONTAINER_CLASS, LT_GRAPHIC_CLASS } from '../../../lib/cg-studio-lt-presets.js'

/**
 * @param {import('grapesjs').Editor} editor
 */
export function createOverlayHelpers(editor) {
	let dropOffset = 0

	function nextDropPosition() {
		dropOffset = (dropOffset + 48) % 280
		return { left: `${80 + dropOffset}px`, top: `${80 + dropOffset}px` }
	}

	function isLtScaffoldComponent(component) {
		if (!component) return false
		const tag = String(component.get?.('tagName') || '').toLowerCase()
		const cls = String(component.getClasses?.() || '')
		const role = component.getAttributes?.()?.['data-lt-role']
		if (cls.includes(LT_CONTAINER_CLASS) || cls.includes(LT_GRAPHIC_CLASS)) return true
		if (tag === 'main' || tag === 'h1' || tag === 'p') return true
		if (role === 'title' || role === 'subtitle') return true
		if (cls.includes('subtitle')) return true
		return false
	}

	function prepareOverlayComponent(component) {
		if (!component || component === editor.getWrapper()) return
		if (isLtScaffoldComponent(component)) {
			component.set({
				draggable: component.getClasses?.().includes(LT_GRAPHIC_CLASS) ? false : true,
				removable: false,
				copyable: false,
			})
			return
		}
		const pos = nextDropPosition()
		component.set({
			draggable: true,
			resizable: true,
			selectable: true,
			removable: true,
			copyable: true,
			badgable: true,
			stylable: true,
			hoverable: true,
			layerable: true,
			dmode: 'absolute',
		})
		const style = component.getStyle()
		if (!style.position || style.position === 'static') {
			component.addStyle({
				position: 'absolute',
				left: style.left || pos.left,
				top: style.top || pos.top,
			})
		}
	}

	function seedLowerThirdScaffold() {
		const wrapper = editor.getWrapper()
		if (!wrapper) return
		wrapper.components().reset()
		const added = wrapper.append(buildLtEditorComponents())
		const main = Array.isArray(added) ? added[0] : added
		if (main) editor.select(main)
	}

	function findGraphicComponent() {
		const wrapper = editor.getWrapper()
		return wrapper?.find?.(`.${LT_GRAPHIC_CLASS}`)?.[0] || null
	}

	/** @param {string} blockId */
	function addToGraphic(blockId) {
		const block = editor.BlockManager.get(blockId)
		const graphic = findGraphicComponent()
		if (!block || !graphic) return
		const added = graphic.append(block.get('content'))
		const component = Array.isArray(added) ? added[0] : added
		if (component) {
			prepareOverlayComponent(component)
			editor.select(component)
		}
	}

	return {
		prepareOverlayComponent,
		seedLowerThirdScaffold,
		findGraphicComponent,
		addToGraphic,
	}
}

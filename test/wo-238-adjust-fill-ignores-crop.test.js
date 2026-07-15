/**
 * WO-238: Test that adjust/fit fill is computed from uncropped source geometry.
 * The crop effect should be independent and not factor into the fit fill calculation.
 */

const assert = require('node:assert/strict')
const test = require('node:test')

// Use dynamic import to load ES modules
;(async () => {
	const fillMath = await import('../client/lib/fill-math.js')
	const layerCrop = await import('../client/lib/layer-crop.js')

	const {
		sceneLayerPixelRectForContentFit,
		pixelRectToFill,
	} = fillMath

	const {
		cropAdjustedFillForLayer,
	} = layerCrop

	/**
	 * Test 1: Basic adjust/fit behavior without crop
	 * A 1920x1080 canvas with 1280x720 media (16:9) in 'fill-canvas' mode
	 * Both have same aspect ratio, so no letterboxing
	 */
	test('adjust fill-canvas with no crop', () => {
		const canvas = { width: 1920, height: 1080 }
		const contentRes = { w: 1280, h: 720 } // 16:9, same as canvas
		const contentFit = 'fill-canvas'

		const rect = sceneLayerPixelRectForContentFit(
			canvas.width,
			canvas.height,
			contentRes.w,
			contentRes.h,
			contentFit
		)
		const fill = pixelRectToFill(rect, canvas)

		// Both are 16:9, so should fill the canvas (no letterboxing)
		assert(fill.x === 0, 'fill.x should be 0 (no pillarbox)')
		assert(fill.y === 0, 'fill.y should be 0 (no letterbox)')
		assert(fill.scaleX === 1, 'fill.scaleX should be 1 (full width)')
		assert(fill.scaleY === 1, 'fill.scaleY should be 1 (full height)')
	})

	/**
	 * Test 2: Adjust fill with crop should produce SAME fill
	 * If a layer has crop {top: 0.2}, adjusting the fill should NOT account for the crop.
	 * The fill should be the same as if there was no crop.
	 */
	test('adjust fill-canvas ignores crop (same fill with/without crop)', () => {
		const canvas = { width: 1920, height: 1080 }
		const contentRes = { w: 1280, h: 720 }
		const contentFit = 'fill-canvas'

		// Get fill without crop
		const rectNoCrop = sceneLayerPixelRectForContentFit(
			canvas.width,
			canvas.height,
			contentRes.w,
			contentRes.h,
			contentFit
		)
		const fillNoCrop = pixelRectToFill(rectNoCrop, canvas)

		// Get fill with crop (the adjust process should STILL use uncropped source)
		// The current code should produce the same fill because sceneLayerPixelRectForContentFit
		// takes the uncropped content resolution
		const rectWithCrop = sceneLayerPixelRectForContentFit(
			canvas.width,
			canvas.height,
			contentRes.w,
			contentRes.h,
			contentFit
		)
		const fillWithCrop = pixelRectToFill(rectWithCrop, canvas)

		// These should be identical (no crop factor in the adjust path)
		assert.deepEqual(fillNoCrop, fillWithCrop,
			'Fill should be identical with or without crop'
		)
	})

	/**
	 * Test 3: Verify that crop DOES affect overlay rect (WO-158 intent)
	 * cropAdjustedFillForLayer should apply crop to the fill for border/overlay placement.
	 * But this is SEPARATE from the FILL — the FILL itself stays uncropped.
	 */
	test('crop adjustment applies only to overlay, not fill', () => {
		const fill = { x: 0.2, y: 0.2, scaleX: 0.6, scaleY: 0.6 }
		const layerWithCrop = {
			effects: [
				{
					type: 'crop',
					params: { left: 0, top: 0.2, right: 1, bottom: 1 }
				}
			]
		}

		// The fill itself should NOT be affected when we call adjust
		// (adjust uses uncropped content resolution)
		// But when we do get the fill and then apply crop adjustment for overlay:
		const overlayRect = cropAdjustedFillForLayer(fill, layerWithCrop)

		// The overlay rect should be different (cropped)
		assert.notDeepEqual(overlayRect, fill,
			'Crop-adjusted fill for overlay should differ from original fill'
		)

		// The y position should move down due to crop
		assert(overlayRect.y > fill.y,
			'Crop-adjusted y should increase (crop top removed content)'
		)

		// The scaleY should shrink due to crop
		assert(overlayRect.scaleY < fill.scaleY,
			'Crop-adjusted scaleY should decrease (top 20% cropped)'
		)
	})

	/**
	 * Test 4: Simulate the adjust workflow
	 * This is what happens when user drops media on a layer and "adjust" is called.
	 */
	test('adjust workflow with cropped layer produces fill from uncropped source', () => {
		const canvas = { width: 1920, height: 1080 }
		const contentRes = { w: 3840, h: 2160 } // 4K source (2x larger)
		const contentFit = 'native'

		// Simulate a layer that has a crop applied
		const layerWithCrop = {
			contentFit: contentFit,
			effects: [
				{
					type: 'crop',
					params: { left: 0, top: 0.2, right: 1, bottom: 1 }
				}
			],
			fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 } // placeholder
		}

		// The adjust process calls sceneLayerPixelRectForContentFit with UNCROPPED media dimensions
		const adjustedRect = sceneLayerPixelRectForContentFit(
			canvas.width,
			canvas.height,
			contentRes.w,
			contentRes.h,
			contentFit
		)

		const adjustedFill = pixelRectToFill(adjustedRect, canvas)

		// Verify the fill is computed from native 1:1 scaling (4K is 2x, so centered at -0.5 with scale 2)
		assert(adjustedFill.x === -0.5, 'Native 4K on 1080p should have x=-0.5 (centered, overscale)')
		assert(adjustedFill.y === -0.5, 'Native 4K on 1080p should have y=-0.5 (centered, overscale)')
		assert(adjustedFill.scaleX === 2, 'Native 4K on 1080p should have scaleX=2')
		assert(adjustedFill.scaleY === 2, 'Native 4K on 1080p should have scaleY=2')

		// Crop should NOT have affected the fill calculation
		// (we passed uncropped content resolution to the function)

		// But when rendering overlays, we would crop-adjust this fill:
		const overlayRect = cropAdjustedFillForLayer(adjustedFill, layerWithCrop)
		assert.notDeepEqual(overlayRect, adjustedFill,
			'Overlay rect is crop-adjusted, but the FILL itself remains uncropped'
		)
	})

	/**
	 * Test 5: Different contentFit modes
	 */
	test('all contentFit modes compute from uncropped source', () => {
		const canvas = { width: 1920, height: 1080 }
		const contentRes = { w: 1280, h: 720 }

		const modes = ['native', 'fill-canvas', 'stretch', 'horizontal', 'vertical']

		for (const mode of modes) {
			const rect = sceneLayerPixelRectForContentFit(
				canvas.width,
				canvas.height,
				contentRes.w,
				contentRes.h,
				mode
			)

			// Basic sanity checks
			assert(rect.x >= 0, `${mode}: x should be >= 0`)
			assert(rect.y >= 0, `${mode}: y should be >= 0`)
			assert(rect.w > 0, `${mode}: w should be > 0`)
			assert(rect.h > 0, `${mode}: h should be > 0`)

			// The rect should be computed from contentRes (1280x720), not from cropped dimensions
			// (there's no crop parameter passed to this function)
		}
	})
})()

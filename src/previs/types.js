/**
 * Previs module — shared data types (JSDoc).
 *
 * Shapes are aligned 1:1 with the Unnamed_Show_Creator project so JSON sidecars interoperate.
 * See [`work/references/show_creator/store_types_excerpt.ts`](../../work/references/show_creator/store_types_excerpt.ts)
 * and [WO-17](../../work/17_WO_3D_PREVIS.md) "Borrowed workflows from Show Creator".
 *
 * Runtime: this file ships no code — it is pure type documentation that the Node server and
 * the browser both include so the wire format stays in sync.
 */

'use strict'

/**
 * @typedef {Object} LEDWallConfig
 * @property {number} pixelPitch    Millimetres (e.g. 2.6, 3.91, 4.81).
 * @property {number} panelWidth    Pixels per panel horizontally.
 * @property {number} panelHeight   Pixels per panel vertically.
 * @property {number} panelsWide    Count of panels horizontally.
 * @property {number} panelsHigh    Count of panels vertically.
 */

/**
 * @typedef {Object} LEDPanel
 * @property {string} id
 * @property {number} localX        Metres from the screen origin (bottom-left of bounding box).
 * @property {number} localY
 * @property {number} width         Panel width in metres.
 * @property {number} height
 * @property {number} pixelWidth
 * @property {number} pixelHeight
 * @property {number} uvMinX        Normalised UV rect into the content canvas.
 * @property {number} uvMinY
 * @property {number} uvMaxX
 * @property {number} uvMaxY
 * @property {string} [meshUuid]    Original mesh uuid in the imported glTF scene.
 * @property {string} [meshName]
 */

/**
 * @typedef {'stretch'|'fit'|'panel_uv'} ContentMappingStrategy
 */

/**
 * @typedef {Object} IrregularScreenConfig
 * @property {LEDPanel[]} panels
 * @property {number} totalPixelWidth
 * @property {number} totalPixelHeight
 * @property {ContentMappingStrategy} [strategy]
 */

/**
 * @typedef {'generic'|'led_wall'|'irregular'} ScreenType
 */

/**
 * @typedef {Object} ScreenRegion
 * @property {string} id
 * @property {string} name
 * @property {ScreenType} screenType
 * @property {number} canvasX            Virtual-canvas coordinates (source rect).
 * @property {number} canvasY
 * @property {number} canvasWidth
 * @property {number} canvasHeight
 * @property {number} worldWidth         Physical dimensions in metres (bounding box).
 * @property {number} worldHeight
 * @property {[number,number,number]} position
 * @property {[number,number,number]} rotation
 * @property {LEDWallConfig}       [ledConfig]
 * @property {IrregularScreenConfig} [irregularConfig]
 * @property {number} resolutionWidth
 * @property {number} resolutionHeight
 * @property {string} [sourceStream]     HighAsCG stream id feeding this region (e.g. 'pgm_1').
 */

/**
 * @typedef {Object} ModelMeshInfo
 * @property {string} name
 * @property {string} uuid
 * @property {[number,number,number]} position
 * @property {[number,number,number]} rotation
 * @property {[number,number,number]} scale
 * @property {{ min: [number,number,number], max: [number,number,number] }} boundingBox
 * @property {number} worldWidth
 * @property {number} worldHeight
 * @property {number} worldDepth
 */

/**
 * @typedef {Object} VirtualCanvas
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} StageBlock
 * @property {string} id
 * @property {string} name
 * @property {number} width
 * @property {number} height
 * @property {number} depth
 * @property {[number,number,number]} position
 * @property {[number,number,number]} rotation
 * @property {string} color
 */

module.exports = {}

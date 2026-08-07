# Show Creator reference snapshot

Source: `/Users/marcin/toolspage/Unnamed_Show_Creator` (private sibling project, 2026-04-21 snapshot). Included here so the Previs module (WO-17) has an offline reference for the patterns we're borrowing.

**Not shipped with HighAsCG.** These files are read-only references — do not modify, do not import. They are React / React Three Fiber / TypeScript; HighAsCG's Previs module is vanilla Three.js + plain ES modules. The _workflows_ port cleanly, the _code_ does not.

## Files

| File | What to learn from it |
|------|-----------------------|
| `SceneViewer.tsx` | glTF import + clone, per-mesh click → `ModelMeshInfo`, selection highlight via `emissive`, LED grid overlay, Transform controls for translate/rotate. |
| `ScreenSystem.tsx` | Virtual-canvas → screen UV mapping math (regular + irregular screens), `VideoTexture` lifecycle (create / seek / play-pause / dispose), image fallback, user-interaction autoplay gate. |
| `CanvasMapper.tsx` | 2D drag-on-canvas UV editor UI (port target for the Previs side-pane "screen region editor"). |
| `store_types_excerpt.ts` | The data model — `ScreenRegion`, `LEDPanel`, `IrregularScreenConfig`, `LEDWallConfig`, `VirtualCanvas`, `ModelMeshInfo`. Adopt these shapes verbatim for the Previs module's server-side JSON. |

## Porting strategy

See [../../17_WO_3D_PREVIS.md](../../17_WO_3D_PREVIS.md) — "Borrowed workflows from Show Creator" section lists the 1:1 mapping from R3F component → vanilla Three.js node + HighAsCG file path.

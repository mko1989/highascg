Button icons (WO-621), 24×24 viewBox, white fill (tinted by the Button's icon colours). timer / play / pause /
reset are the web's client/components/ui-icons.js paths; cog.svg is generated (8-tooth gear, evenodd hole).
pulse.svg (WO-623 performance-overlay toggle) is a hand-drawn activity trace. prev / next (WO-603 Playlists panel) are
the web playlist-control-panel.js transport paths scaled to 24; close (playlist row delete) is a plain ✕. Read
raw and rasterised at runtime by app/ui_icons.gd — no import step, like assets/devices/. Needed because the box has
no font with ⏱ (U+23F1) or ⏸ (U+23F8): `fc-list ':charset=23f1'` is empty, so those glyphs rendered blank.
save / load (WO-608 header) are the web header's two-image buttons (client/assets/arrow-right|left.svg + save.svg,
IcoMoon 17×17) joined into one 34×17 drawing — width 48 / height 24 so the px/24 raster scale keeps them 2:1.
headphones (WO-608 header audio monitor) is the web header-bar-audio.js Lucide stroke path.
eye / eye_off (WO-647 previs layer visibility) are hand-drawn: an almond outline with a pupil, and the same
outline struck through.
copy (WO-656 look card duplicate) is hand-drawn: two offset rounded squares, the front one hollow.
clock (WO-659 Live 2D Times toggle) is a plain circle with two hands. cube_face / cube (WO-659 Live 2D / 3D toggle) are
a box with "2D" drawn inside it as strokes (WO-668: the plain square read as a stop button; Godot's SVG
loader draws no <text>) and an isometric hexagon with its three visible faces (3D). The toggle uses them at 22 px.
warning (WO-661 Shaders group / rows while Caspar runs without GPU) is a hand-drawn amber triangle with a black "!" —
coloured on purpose (not white), so set it on Tree items, not on Buttons that tint their icons.

Button icons (WO-621), 24×24 viewBox, white fill (tinted by the Button's icon colours). timer / play / pause /
reset are the web's client/components/ui-icons.js paths; cog.svg is generated (8-tooth gear, evenodd hole).
pulse.svg (WO-623 performance-overlay toggle) is a hand-drawn activity trace. prev / next (WO-603 Playlists panel) are
the web playlist-control-panel.js transport paths scaled to 24; close (playlist row delete) is a plain ✕. Read
raw and rasterised at runtime by app/ui_icons.gd — no import step, like assets/devices/. Needed because the box has
no font with ⏱ (U+23F1) or ⏸ (U+23F8): `fc-list ':charset=23f1'` is empty, so those glyphs rendered blank.
save / load (WO-608 header) are the web header's two-image buttons (client/assets/arrow-right|left.svg + save.svg,
IcoMoon 17×17) joined into one 34×17 drawing — width 48 / height 24 so the px/24 raster scale keeps them 2:1.
headphones (WO-608 header audio monitor) is the web header-bar-audio.js Lucide stroke path.

Button icons (WO-621), 24×24 viewBox, white fill (tinted by the Button's icon colours). timer / play / pause /
reset are the web's client/components/ui-icons.js paths; cog.svg is generated (8-tooth gear, evenodd hole).
pulse.svg (WO-623 performance-overlay toggle) is a hand-drawn activity trace. Read
raw and rasterised at runtime by app/ui_icons.gd — no import step, like assets/devices/. Needed because the box has
no font with ⏱ (U+23F1) or ⏸ (U+23F8): `fc-list ':charset=23f1'` is empty, so those glyphs rendered blank.

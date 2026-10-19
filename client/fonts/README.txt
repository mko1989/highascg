Rewir (Rewir-Light.woff + Rewir-Light.ttf fallback)
Source: https://github.com/warszawskie-kroje/rewir/tree/master/Rewir-Light
License: SIL Open Font License (OFL)
Copyright © 2016 Stowarzyszenie Kulturotwórcze Miastodwa

See https://scripts.sil.org/OFL for the full license text.

Rewir-Light.woff and .ttf are MODIFIED (WO-620): upstream maps "·" U+00B7 and "•" U+2022 to empty glyphs, so every
" · " separator rendered as a gap. Both are now composites of Rewir's own period (tools/dev/patch-rewir-middot.py;
DSIG dropped, name ID 5 notes the patch); nothing else changed. The .ttf is byte-identical to
godot/client/assets/fonts/Rewir-Light.ttf. Rewir-Light.otf (not referenced by the CSS) is the unmodified upstream file.
If the browser reports OTS/WOFF errors, redeploy both files — a truncated upload breaks WOFF parsing.

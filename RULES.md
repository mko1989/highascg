# HighAsCG — project rules

Rules every client (Godot and web) and every change must follow. These are owner rules: a change that breaks
one is a regression, whatever else it fixes. Add a rule here when the owner states one.

## Input fields

1. **Focus selects the value.** When a text or number field gets keyboard focus (Tab, Shift+Tab or a click into
   it), its whole current value is selected, so typing replaces it. Typing a width, pressing Tab and typing the
   height must give the new height, not the old digits with the new ones added.
2. **Number fields accept maths.** Every field that holds a number evaluates `+ - * /` (and parentheses) when it
   is committed with Enter or by leaving the field: `1920/2` → `960`, `3840-64` → `3776`. Input that is not a valid
   expression leaves the previous value in place. The result is then clamped and rounded like a typed number.

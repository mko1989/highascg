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
3. **Number fields take only numbers (owner, 30.10, WO-839).** Gibberish is never salvaged: `100+`, `1920/`,
   `12abc` or `42px` revert to the value the field had before. Committing gives either the correct value (a number
   or a complete expression) or the previous value, nothing in between.

## Timers (owner, 30.10, WO-806 G3)

1. **Timer visibility is per screen, not per look.** It is stored in look presets (one per screen), not in each look.

## Linked servers (owner, 29.10, WO-802)

1. **Linking is node ↔ node only.** A link joins two HighAsCG node servers, never a client.
2. **A Godot client talks only to the node on its own machine** (or the one its operator chose explicitly: `--server`,
   `HIGHASCG_SERVER`, the A/B host). It never opens a socket or HTTP connection to another machine's node or client on
   its own, and nothing the cluster says changes where it is connected.
3. **All cross-machine traffic goes node ↔ node.** The local node relays what its client needs (Devices "Edit" of a
   linked server: `/api/cluster/peers/:id/relay/…`).
4. **Unlink restores the local-only state visibly.** No residual remote connection, no stored remote origin a restart
   goes back to.
5. **No silent fallback.** The header always shows which server the client is connected to ("local", or amber
   "on <host>").

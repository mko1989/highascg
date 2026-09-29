**Status: DONE (2026-09-29, offline suite 2526/0/2, lint clean) — not yet eyeballed live**

# WO-584 — Global border: Art-Net listen is opt-in; DMX patch/mapping collapsed by default

Owner: "artnet listener is activated on the global border as default which it shouldnt be, this should
be an optin option only, as well as the whole dmx channel mapping should be expandable and hidden by
default." Follow-up: "there is no indication that the dmx channel mapping is available when expanded.
need an arrow or something."

## Cause

Server `slotListenEnabled()` already treated a missing flag as off (WO-179 smoke). The client did not:
`sceneStateDefaultGlobalBorderTemplate()` seeded `artnetListenEnabled: true` into every new slot (then
persisted), and `normalizeStoredBorder`, `preserveLocalArtnetConfig` and the Art-Net WS fingerprint all
read `!== false` (missing → on).

## Fix

- [x] `client/lib/scene-state-global-border.js`: template default `false`; reads use `=== true`;
  Art-Net WS updates are ignored unless the slot is explicitly opted in.
- [x] `client/lib/global-border-artnet-ws.js`: fingerprint uses `=== true`.
- [x] `client/components/inspector-global-border-artnet.js`: listen checkbox stays visible (label says
  opt-in); protocol, start channel, universe, per-channel mapping table and fixture download move into
  a `<details>` "DMX patch & channel mapping (universe U, start ch N)", closed by default; open/closed
  survives inspector rerenders within the session.
- [x] `client/styles/06c-inspector-effects-pip.css`: `.inspector-effect-card__advanced-summary` had its
  native marker hidden with nothing in its place — now draws ▸ (rotates to ▾ when open) + hover color.
  Also applies to the effect cards' "Advanced" disclosures.

No migration: slots saved with an explicit `true` stay on (can't tell a deliberate opt-in from the old
default). This box's `config/.highascg-state.json` already stores `false`.

## Owner acceptance

- [ ] A584.1 Add a global border to a screen that has none → "Listen for Art-Net/sACN" is unchecked.
- [ ] A584.2 The DMX patch/mapping block is collapsed with a ▸ arrow; clicking expands it (▾).

Needs `npm run build:client` + kiosk reload (not built after the arrow change — show running).

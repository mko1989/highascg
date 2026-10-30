# WO-698 — choose the network card the fixture DMX output (Art-Net / sACN) leaves by

**Area:** lighting, network
**Status: DONE (2026-10-23, smoke-wo698 4/4 + wo615 8/8, Godot 21153/0; egress measured on this box's NIC TX
counters; live server reports `dmx.iface`; the picker shown in the real client. Owner QA: pick the lighting NIC under
Previs → Fixtures → Out via and check the nodes / DMX viewer)**

Owner, 23.10: *"how do i choose which nic the artnet is using. im chasing a wild goose now with artnet but its due to
transmiting on wrong nic."*

## Investigation

- There was no choice. Fixture DMX output (typed patch, follow, Art-Net through) goes through ONE socket,
  `src/fixtures/artdmx.js` `ArtnetSender`, bound to `0.0.0.0:<ephemeral>`. Art-Net heads default to dest
  `255.255.255.255` (`follow-patch.js` `DEFAULT_DEST`); sACN goes to `239.255.x.y` multicast (no
  `setMulticastInterface`). Only PSN had an interface field (`output.psn.iface`, WO-631).
- The kernel sends a limited broadcast and multicast out of the default route's NIC:
  `ip route get 255.255.255.255` → `dev eno1 src 192.168.0.23`; `ip route get 239.255.0.1` → eno1. This box: eno1
  192.168.0.23/24 (office LAN, default route), eno2 2.0.0.13/8 (the Art-Net 2.x network), tailscale0.
- Measured (2000 packets each, `/sys/class/net/*/statistics/tx_packets`): unbound → eno1 +2034, eno2 +1 (broadcast);
  eno1 +2039, eno2 +0 (multicast). So every universe went to the office LAN, whatever the patch said.
- Bound to the source address, the route lookup follows it: `ip route get 255.255.255.255 from 2.0.0.13` → `dev eno2`;
  same for `239.255.0.1`. Node has no SO_BINDTODEVICE, but binding the address is enough.

## What was done

- `fixtures.dmx.iface` — an IPv4 of this box, `''` = OS default route (old projects unchanged). Normalised in
  `src/fixtures/gdtf-patch.js` `normalizeDmx` and its twin `follow_model.gd` `normalize_dmx`; reported in the engine
  status (`GET /api/fixtures/dmx` → `dmx.iface`).
- `ArtnetSender.setInterface(ip)`: a change closes the socket; the next send binds `{port: 0, address: ip}` and sets
  the multicast interface to it. An address not on this box (NIC unplugged, a project from another box) logs
  `DMX output interface <ip>: … using the OS default route` and falls back. `follow-service.js` applies it on every
  patch change; the patch log line now ends `via <ip | OS default route>`.
- Godot: Previs → Fixtures, **Out via** next to DMX viewer… — "OS default route" + every `name  address` from
  `GET /api/tracking/follow` `psn.interfaces` (the same list the PSN picker uses); an address that is gone shows as
  "(not on this box — default route)".

Why bind rather than rewrite 255.255.255.255 to the NIC's directed broadcast: binding also covers sACN multicast and
unicast node destinations, and keeps the patch's `dest` untouched.

## Verified

- `tools/smoke/smoke-wo698-dmx-output-nic.test.js` 4/4 (normaliser; bound socket sends from the address; fallback for
  192.0.2.77 logged; source pins); `smoke-wo615-dmx` updated for the new status key. Godot 21153/0 (+iface cases).
- Box: the real sender with `iface 2.0.0.13` → eno2 +2000 / eno1 +0 (broadcast), eno2 +2002 (multicast); default →
  eno1. Server restarted: `/api/fixtures/dmx` carries `"iface": ""`, journal `… output off (artnet) via OS default
  route`. Test client (second instance): Out via lists OS default route / eno1 / eno2 / tailscale0.
- NOT changed on the owner's live project (they were mid-debug) — choosing eno2 is the owner's step.

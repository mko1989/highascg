# WO-1124 — Ship LocalSend on the ISO

**Area:** os-iso, process
**Status: IN PROGRESS (17.11.26 — licence checked, attribution + licence-tree row added; not yet seen in a built ISO)**

Owner 17.11: "if its possible/legal id like to ship with localsend".

## Investigation

- LocalSend is Apache-2.0 (GitHub API `repos/localsend/localsend/license` → `Apache-2.0`). Redistribution of the
  unmodified binary is allowed with a copy of the licence and the notices kept; no source offer needed.
- Installed here as the upstream .deb `localsend 1.18.2+64` (→ /opt/localsend_app). The ISO is a clone of this box, so
  it is on the next build without an install step. The package has no /usr/share/doc copyright file; its component
  notices are in `/opt/localsend_app/data/flutter_assets/NOTICES.Z`.
- It did not start: `libayatana-appindicator3.so.1` missing (the .deb's alternative dependency was not pulled in).
  Owner installed `libayatana-appindicator3-1` (Ubuntu package, LGPL, covered by the Ubuntu-packages line); it
  starts and shows its window.

## What was done

- `THIRD_PARTY_NOTICES`: LocalSend entry. `tools/release/collect-licenses-stack.sh`: when the package is installed,
  the Apache-2.0 text goes into the licence tree with a row for LocalSend.

## What was verified

- LocalSend window opens on the box. Licence-tree smokes (wo1096, wo1022) pass.

## Not verified / open

- A built ISO: the app in the dock's app list, the licence row in the generated tree, first start on a fresh install
  (it listens on TCP/UDP 53317 on every interface — receiving files from anyone on the show LAN is on by default,
  with a confirm prompt per transfer).
- A fresh, non-cloned install has no step that fetches the .deb.

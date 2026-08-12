Drop server updates here (contents of highascg-server_*.tar.gz from GitHub releases).

Required: package.json, index.js, src/, dist-web/, tools/runtime/ at the top of this folder.

Live USB stick (retain mode):
  - On every boot, files are rsync'd into /home/casparcg/highascg/
  - LEAVE the drop here — do not move to applied/ manually
  - The stick is the durable copy; RAM/overlay does not keep ~/highascg across reboots
  - Optional history copies may appear under drop-update/applied/ (audit only)

Persistent install (consume mode):
  - After a successful apply the drop may move to drop-update/applied/<UTC>/
  - ~/highascg/ survives reboot on internal disk

Operator UI: http://<playout-ip>:4200/

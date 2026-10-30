# WO-729 — Replication SSH keys in authorized_keys gave a full shell

**Area:** network
**Status: DONE (24.10.26) — this box's three plain replication keys restricted on server start (journal line,
backup kept); replication-check against 127.0.0.1 and .4 5/5 each, shell refused; smoke 5 cases in CI.**

Found by WO-728's live media copy check: `replication-check.js --peer=127.0.0.1` step 1 — `ssh -i ~/.ssh/highascg_replication casparcg@127.0.0.1 id`
printed `uid=1000(casparcg) … 27(sudo)` instead of the forced command's refusal.

## Investigation

- This box's `~/.ssh/authorized_keys` (Jul 4): 5 lines. Line 1 `casparcg-leader-deploy` (plain, not a replication key —
  left alone). Lines 2–4 `highascg-replication@highascg-nvidia-595` **with no options**: line 2 is this box's own key,
  3–4 belong to other boxes. Only line 5 (`from="192.168.0.13",command=".../highascg-replication-ssh",…`) was
  restricted. .4's single line (this box's key) is restricted — proven by the same check.
- WO-78 (2.07) made `installPeerAuthorizedKey` write `command=` + `no-pty`/forwarding off, and "upgrades legacy plain
  keys on re-pair" — only for a key that is paired again. These never were.
- Two writers of plain keys were still in the repo: `scripts/replication/setup-replication-ssh.sh`
  `install_self_in_authorized_keys` (`echo "$line" >> authorized_keys`) and `copy_id_to_peer` (`ssh-copy-id`, which
  leaves the key on the peer with a shell).
- Every use of the replication key in the app is rsync: Send media / pulls (`sync-project-media-rsync.js:158`), the
  probe (`replication-ssh-setup.js` `testReplicationSshToPeer`); no `ssh … <command>` anywhere in `src/`. So a forced
  command breaks nothing the key is meant for.

## What was done

- `src/replication/replication-ssh-setup.js` `restrictPlainReplicationKeys()`: every option-less line whose comment
  starts `highascg-replication@` becomes the WO-78 entry (`command="<wrapper>",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty`;
  no `from=` — the peer address is not known for old keys). Lines with options and other keys are untouched; the
  file before is kept once as `authorized_keys.pre-wo729`; 0600.
- `src/replication/replication-service.js`: called on every server start, **not in a sandbox** (sandboxes share this
  user's `~/.ssh`). Field boxes get it on their next update.
- `scripts/replication/setup-replication-ssh.sh`: self key through `installPeerAuthorizedKey`; the peer key is
  installed by the peer's own script (`ssh peer '… --install-peer-key "$f"' < key.pub`) instead of `ssh-copy-id`.

## What was VERIFIED

- Live, this box: server restart → journal `[replication] 3 replication SSH key(s) had a full shell — now rsync-only (backup /home/casparcg/.ssh/authorized_keys.pre-wo729)`;
  lines 2–4 now start `command="/usr/local/bin/highascg-replication-ssh",no-port-fo…`, line 1 and 5 unchanged.
  `replication-check.js --peer=127.0.0.1` 5/5 (shell refused by the wrapper; push / pull / single pull / clean up)
  and `--peer=192.168.0.4` 5/5.
- Smoke (`smoke-wo728-box-checks.test.js`): two plain replication keys restricted, deploy key + already-restricted key
  byte-identical, backup written, 0600 (an existing 0644 file — caught a missing chmod), second pass = 0, the sandbox
  gate and the setup script pinned (no `ssh-copy-id`, no `>> authorized_keys`).

## Owner
- Revert, if ever needed: `cp ~/.ssh/authorized_keys.pre-wo729 ~/.ssh/authorized_keys`.
- Lines 3–4 are other boxes' keys (named after the ISO build host, so not traceable from here). They now only copy
  media; delete them if those boxes are gone.
- The repo wrapper `tools/runtime/highascg-replication-ssh.sh` is mode 644, so the fallback when `/usr/local/bin`
  has no wrapper fails closed (rsync refused, no shell). Pre-existing; install the wrapper on new boxes.

# WO-727 — Pulls of names with spaces refused by the forced command; clocks synced

**Area:** network, media
**Status: DONE (24.10.26) — live: pull of `npcc/Tlo Orange Ball/BAZA 2.mp4` (99.7 MB) and of that folder from .4,
push of `wo727 push test (1)/a & b.txt` to .4, every refusal re-probed on .4's installed wrapper; smoke 35/35 incl.
14 refusal cases; test:ci 3121 / 0 fail. This box's installed copy = owner sudo (below).**

Owner, 24.10 (after WO-724): *"Copying files from the other server still fails on names with spaces. The fix means
changing the receiving side's security check; your call. We need this so do what's ever needed. We need the clocks
synced."*

## Investigation

- WO-724 fixed **push** (Send media) by naming only `<root>/media/` on the remote side. A **pull** has to name the
  remote file (`sync-project-media-rsync.js` `rsyncArgs`, hot-backup pair `connect-pair.js:256`), and rsync ≥ 3.2.4
  backslash-escapes it on the remote command line: `rsync --server --sender … /home/casparcg/highascg/media/projects/npcc/Tlo\ Orange\ Ball/BAZA\ 2.mp4`.
- The forced command (`tools/runtime/highascg-replication-ssh.sh`) refused any `\` as a metacharacter, then split
  with `IFS=' ' read -r -a` → `disallowed path token: Orange\` (the error seen in WO-724).
- **The active forced command is not the repo file.** `authorized_keys` runs `command="/usr/local/bin/highascg-replication-ssh"`,
  a root copy (1634 bytes, July on both boxes) written only by `scripts/replication/install-replication-ssh-wrapper.sh`.
  Nothing in setup or the update paths refreshes it (`highascg-webui-server-update.sh` WO-511 refreshes only the
  three update helpers in `/usr/local/lib/highascg`). So a wrapper fix in the repo would never have reached sshd.
- Unchanged and pre-existing, noted for a later look: relative `media/…` tokens are checked by prefix, not
  canonicalized; option words (`-*`) pass through (rsync `--server` options; `-e` has no effect server-side).
- **Clocks:** both boxes had NTP off and read ≈2 h ahead of real UTC; .4 = this box − 17.17 s (WO-724). Signed
  cluster calls allow ±60 s. Side effect seen: today's commits from this box carry times ≈2 h in the future
  (`ea45801f` = 16:00:16 +0000, real ≈14:00 UTC), and files written before the sync have future mtimes.

## What was done

- `tools/runtime/highascg-replication-ssh.sh`: the raw metacharacter check now refuses only newline / CR; the
  command is split by `split_words`, which understands exactly one escape (`\x` = literal x, as rsync writes it) and
  refuses unescaped `; | & \` $ < > ( ) ' "` and tab. Per word: an option word may not contain an escaped character,
  `..` is checked again on the unescaped text (`\.\.` is not `..` on the line but is in the word), then the existing
  `validate_token` (`readlink -f` under media/ or template/ — a symlink out is still refused). `exec rsync "${argv[@]}"`
  — no shell ever sees the words. Chosen over `--protect-args` / `-s` on the client: that needs every sender changed
  and a wrapper that reads rsync's protocol to see the paths at all.
- `scripts/exfat/highascg-apply-server-drop.sh` (the root helper both the stick and the web-UI update run): after
  the merge, reinstalls `/usr/local/bin/highascg-replication-ssh` from the applied tree when it is installed and
  differs (never creates it — trust stays opt-in; root only; a failure only logs). The helper itself is refreshed by
  WO-511, so the first update after this lands the new helper and the next one the wrapper (or run the install
  script once, below).
- `.4`: `sudo bash scripts/replication/install-replication-ssh-wrapper.sh` → md5 `cbe71763…` = repo.
- Clocks: `POST /api/system/time {ntp:true}` on both boxes (the app's root helper `highascg-set-system-time.sh`);
  timesyncd enabled + active, so it survives reboots.

## What was VERIFIED

- `smoke-wo724-media-send-paths.test.js`: the WO-724 "old form fails" test now asserts it **arrives**; a pull of a
  file and of a folder with spaces, `&`, `(1)`; with a stand-in rsync, escaped names reach exec as one word each;
  14 refusals (not rsync, `;`, `$( )`, backticks, quotes, newline, `..`, escaped `..`, outside, escaped outside,
  symlink out of media, escaped option word, trailing `\`, escaped `rsync\ --server`), each with rsync never run;
  the update refresh pinned. 35/35 with `smoke-replication-ssh-setup` + `smoke-server-update-retain`. Mutation:
  removing either new per-word guard fails exactly its test.
- **Live, this box → .4 through the installed wrapper, replication key:** pull `media/projects/npcc/Tlo Orange Ball/BAZA 2.mp4`
  exit 0, 99,696,811 bytes; pull of the folder exit 0; push `media/wo727 push test (1)/a & b.txt` exit 0, content
  read back on .4, then removed. Refusals on .4: `id` → forbidden command; `/etc/passwd` → not under media/;
  `media/\.\./config` → path traversal; `media/x;id` and `a\ $(id)` → forbidden metacharacters.
- Update refresh, run as root on .4 (block extracted, stand-in path): stale → replaced (root 755, md5 = repo);
  current → untouched; absent → not created.
- Clocks: both `System clock synchronized: yes`, `NTP service: active`; offset .4 vs this box 1.5–2.3 ms over ping
  samples (was 17.17 s); highascg restarted on both after the jump.
- Gates on a clean export: repo-integrity, max-lines, unwired-exports, `--no-http` boot, lint (214 warnings), format:check;
  test:ci 3121 tests, 3117 pass, 3 skipped, 1 fail = `smoke-wo498` needs `.git` (export has none) → 8/8 in the checkout.

## Owner (this box needs root once)
- `sudo bash scripts/replication/install-replication-ssh-wrapper.sh` — until then pulls **from** this box still fail
  on spaces (the next update after this one also does it).
- `sudo timedatectl set-timezone Europe/Warsaw` — the clock is right now, but this box is on `Etc/UTC`, so it shows
  2 h less than the wall clock.

# Manual server update

Fallback for when the Web-UI updater cannot run. Substitute the tag/stamp of the release you want.

> **Every exclude below is anchored with a leading `/`. Do not remove those slashes.**
>
> An rsync pattern _without_ a leading slash matches at **any depth**. `--exclude 'config/'` excluded
> the live `config/` **and** `src/config/`, so a new `src/api/` file arrived while the `src/config/`
> module it required did not — `MODULE_NOT_FOUND`, restart loop, box down (WO-512). The same trap
> hides in `media/` (also matches `src/media/`) and `lib/` (also matches `scripts/lib/`).

```bash
cd /tmp && rm -rf hacg-new && mkdir hacg-new

curl -fL -o hacg.tgz https://github.com/mko1989/highascg/releases/download/2026-08-13_144837/highascg-server_2026-08-13T144837Z.tar.gz

tar -xzf hacg.tgz -C hacg-new

sudo systemctl stop highascg

rsync -rlpt --modify-window=2 \
  --exclude '/config/' --exclude '/projects/' --exclude '/data/' --exclude '/media/' \
  --exclude '/bin/' --exclude '/lib/' --exclude '/cef-cache/' --exclude '/log/' \
  --exclude '/node_modules/' --exclude '/.env' --exclude '/highascg.config.json' \
  --exclude '/.highascg-state.json' --exclude '/.module-state.json' \
  /tmp/hacg-new/ /home/casparcg/highascg/

sudo systemctl start highascg
```

## Verify it landed — a partial apply is silent

```bash
systemctl is-active highascg && curl -sf localhost:4200/api/state >/dev/null && echo UP
cat /home/casparcg/highascg/BUILD_STAMP
```

If the service restart-loops, the reason is one line in the journal:

```bash
journalctl -u highascg -n 40 --no-pager | grep -A3 'Error:'
```

`Cannot find module` there means files were **skipped by an exclude**, not that the release was bad.
Re-run the rsync with the anchors in place.

## Prefer the Web UI

The normal path is the in-app updater. It uses `/etc/highascg/server-update-rsync-excludes.txt`
(anchored, WO-512) and runs the apply in a transient systemd unit so it survives stopping the service
(WO-501). If its helper is out of date the updater now prints the exact command to refresh it, and
refreshes itself from then on (WO-511).

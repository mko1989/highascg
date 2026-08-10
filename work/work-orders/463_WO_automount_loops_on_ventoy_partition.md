# WO-463 — USB auto-mount retries the Ventoy boot partition forever (EBUSY loop)

**Status: IN PROGRESS (fixed + tested 2026-08-10; owner QA on the next ISO)**

Found in the operator box's journal while diagnosing the boot reported in WO-458/462 (the box was
live from a Ventoy stick, `highascg7579`, boot of 13:08):

```
[error] USB auto-mount failed for /dev/sdb1: Error mounting /dev/sdb1:
  GDBus.Error:org.freedesktop.UDisks2.Error.Failed: Error mounting /dev/sdb1
  at /media/casparcg/Ventoy: /dev/sdb1 already mounted or mount point busy
  Command failed: udisksctl mount -b /dev/sdb1 --no-user-interaction
```

## 1. Investigation

`src/media/usb-drives-discovery.js:65` classified mount candidates as:

```js
const isMountCandidate = type === 'part' || (type === 'disk' && !hasChildren && !!fsType)
```

`hasChildren` was consulted for whole disks but **not for partitions**. On a Ventoy stick booted
from itself, `sdb1` is a removable partition with no mountpoint — a perfect candidate by that
rule — but Ventoy has built a dm map of the booted ISO on top of it, and device-mapper holds the
underlying partition `O_EXCL`. udisks therefore cannot mount it, ever. The poller has no
back-off for permanent failures (by design: a failure leaves the device unclaimed so a later
retry can succeed), so this logs an error on every tick for the life of the boot.

This is the same mechanism as WO-458, seen from the other side: there, `mount(2)` on the raw
partition returned EBUSY and the fix was to use Ventoy's `/dev/mapper/<part>` twin. Here the
right answer is simply not to try — **a partition with children is never the mountable object**.
For Ventoy, LVM and LUKS alike, the thing you mount is the mapper device, not the raw partition.
lsblk already reports the claim as child nodes, which is the same signal WO-458 reads out of
`/sys/class/block/<part>/holders`, so no new probe is needed.

Note this is new with the Ventoy migration. On the old dd-flashed sticks the live medium was not
a normal partition the poller would consider, so nothing ever produced a permanently-unmountable
removable partition.

## 2. What was done

`src/media/usb-drives-discovery.js` — one line:

```js
const isMountCandidate = !hasChildren && (type === 'part' || (type === 'disk' && !!fsType))
```

`hasChildren` now gates partitions too. The walk still recurses into children, and dm nodes carry
`type: "dm"` (not `part`/`disk`), so they are not candidates either — the poller simply stops
having an opinion about claimed devices.

## 3. What was VERIFIED to work

- `tools/smoke/smoke-wo463-automount-skips-dm-held-partitions.test.js` (new, registered in
  `tools/ci/run-offline-tests.js`) — **5/5 pass**. It runs `parseRemovableCandidates` against the
  **exact topology captured on the box** (p1 `Ventoy` with `ventoy` + `sdb1` dm children,
  p2 `VTOYEFI`, p3 `HIGHASCGEXF`) and asserts `/dev/sdb1` is gone while `/dev/sdb2` and
  `/dev/sdb3` remain — i.e. the fix does not blind the poller to real volumes. Three regression
  cases pin the paths that must keep working: a plain unclaimed partition, an already-mounted
  partition, and a bare removable disk with a filesystem and no partition table.
- The pre-existing USB tests (`smoke-usb-lsblk.js`, `smoke-wo413-usb-automount.test.js`) still
  pass — 10/10.
- Full offline suite: **1920 pass / 0 fail / 2 skip**.

**Remains (owner):** visible on the next ISO build. Cosmetic in the sense that nothing failed
because of it, but it was one error line per poll tick in the operator journal, which is exactly
the noise that hides a real fault later.

# HighAsCG USB stick — superseded

**Do not follow this document.** It described the pre-Ventoy stick: an ISO written raw over the
whole device with `dd`/Etcher, an optional union **persistence** partition, and an exFAT volume
placed in whatever free space was left. All three of those are retired, and the persistence layer
never worked reliably.

**Current procedure:** **[`docs/STICK_QUICK_START.md`](../../../docs/STICK_QUICK_START.md)**

In short:

1. Install **Ventoy** on the stick with **Option → Partition Configuration → "Preserve some space
   at the end of the disk"** set to the size you want for operator data.
2. Create an exFAT partition in that reserved space, labelled exactly **`HIGHASCGEXF`**.
3. Copy the ISO onto the **Ventoy** partition (partition 1), then `sync` and verify the hash.
4. Unzip the starter layout onto **`HIGHASCGEXF`**.

Why operator data needs its own partition: while the machine is booted from the stick, Ventoy
holds its own partition open for the ISO it is streaming, so Linux cannot mount it. Data placed
there is unreachable at exactly the moment it is needed.

Why the old fixed **6 GiB offset** is gone: it existed because a raw-flashed ISO left free space
that Windows misread, so an offset-less partition landed *inside* the boot image. Ventoy reserves
the space itself, at the end, and there is nothing to compute.

---

Related:

| Topic | Document |
|-------|----------|
| Making a stick | [`docs/STICK_QUICK_START.md`](../../../docs/STICK_QUICK_START.md) |
| Stick contents / server drops | [`tools/eggs/live-usb/MANUAL_STICK_WINDOWS_MACOS.md`](../../../tools/eggs/live-usb/MANUAL_STICK_WINDOWS_MACOS.md) |
| What rides on exFAT vs in the ISO | [`docs/WO47_ISO_VS_EXFAT.md`](../../../docs/WO47_ISO_VS_EXFAT.md) |

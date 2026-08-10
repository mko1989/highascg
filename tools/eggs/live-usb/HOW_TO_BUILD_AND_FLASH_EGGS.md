# Build an ISO and put it on a Ventoy stick

One produce per boot — `eggs produce` leaves live-system bind mounts under `/home/eggs/liveroot`
and the build refuses to start again until you reboot.

```bash
tmux new -s eggs

sudo systemctl stop highascg
sudo bash tools/eggs/live-usb/stop-and-unmount-wo47-for-eggs-produce.sh
sudo HIGHASCG_NVIDIA_DRIVER=595 bash tools/eggs/live-usb/build-highascg-egg.sh
sudo systemctl start highascg
```

**Wait for `Done. ISO:` before copying anything.** The ISO file appears minutes earlier — its
filename carries the *produce* time, not the finish time — and the build keeps re-packing it
afterwards. Copying inside that window yields a stick that reaches the GRUB menu and then fails
with *"invalid magic number / you need to load the kernel first"*. The build writes
`<iso>.sha256` as its last action, so that sidecar existing is the ready signal.

Then copy to the **Ventoy** partition of the stick, flush, and verify:

```bash
cp /home/eggs/highascg-nvidia-595_amd64_*.iso /media/$USER/Ventoy/ && sync
bash tools/eggs/live-usb/verify-stick-iso.sh /media/$USER/Ventoy/highascg-nvidia-595_amd64_*.iso
```

Preparing the stick itself (Ventoy install with reserved space, plus the `HIGHASCGEXF` data
partition) is in **[`docs/STICK_QUICK_START.md`](../../../docs/STICK_QUICK_START.md)**.

`build-produce-flash-stick.sh` still exists and still `dd`s an ISO onto a whole stick. That is the
**pre-Ventoy** flow — it destroys the Ventoy layout and the operator data partition with it.

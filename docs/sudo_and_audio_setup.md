# Sudo Setup for CasparCG / HighAsCG

**Avoid `NOPASSWD: ALL` for `casparcg`.** Use narrow **`/etc/sudoers.d/`** fragments (see **`docs/HIGHASCG_PASSWORDLESS_SUDO.md`**): media mount helper, optional nuclear actions, etc.

**ALSA / `/etc/asound.conf`:** HighAsCG **does not install** passwordless `tee` → `/etc/asound.conf` by default. **PortAudio + device names** and per-user **`~/.asoundrc`** cover normal playout without sudo. Enable system-wide ALSA only if you truly need it: **`HIGHASCG_INSTALL_ASOUND_SUDOERS=1`** during **`scripts/install.sh`** (see **`install-phase3.sh`**).

Historical note: older docs sometimes suggested broad `tee` or `ALL` rules; prefer the inventory doc above.

---

## Legacy (overly broad — not recommended)

The following is **not** the reference layout; kept for context only.

### 1. Open the Sudoers File
Run the following command as a root-level user:
```bash
sudo visudo
```

### 2. Add Permission for the `casparcg` User
Append the following line to the end of the file:

```sudoers
casparcg ALL=(ALL) NOPASSWD: ALL
```

> [!NOTE]
> If you prefer to limit the scope for better security, you can specify only the necessary commands (like `tee` for config writing):
> `casparcg ALL=(ALL) NOPASSWD: /usr/bin/tee, /bin/tee`

### 3. Verify
Switch to the `casparcg` user and test a sudo command:
```bash
sudo -u casparcg sudo -n true && echo "Success: Passwordless sudo is active"
```

---

## Audio Configuration (CasparCG Enhanced)

With PortAudio, you should typically use the **custom_live** profile in HighAsCG. This profile enables:
- `<portaudio>` consumers inside `<channels>`.
- Direct hardware device selection for DP/HDMI outputs.
- Low-latency monitoring.

### Enabling PortAudio Outputs on GPU
1. In the **Device View**, click on a **GPU (DP/HDMI)** connector.
2. In the inspector, ensure **PortAudio** is enabled.
3. Select your hardware device from the list (e.g., `NVidia HDMI 0`).
4. Set the **Channel Layout** to `8ch` for surround/multi-channel support.

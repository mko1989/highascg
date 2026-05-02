# Sudo Setup for CasparCG / HighAsCG

To allow HighAsCG (running as user `casparcg`) to manage system-level configurations (like `/etc/asound.conf`) and perform restricted tasks without manual password entry, you must configure `sudoers`.

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

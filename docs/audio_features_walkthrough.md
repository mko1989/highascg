# Audio Playout & Monitoring Walkthrough

This update enhances HighAsCG with "CasparCG Enhanced" features, specifically focusing on PortAudio support, multi-channel layouts (8ch/16ch), and hardware-level monitoring.

## 1. PortAudio Output Setup

You can now assign physical audio outputs to your GPU (DP/HDMI) ports or dedicated audio cards.

1.  Open **Device View**.
2.  Click on a **GPU** or **Audio** port.
3.  In the inspector:
    - Check **Enable PortAudio**.
    - Select the physical **Device** from the dropdown (e.g., `NVidia HDMI 0`).
    - Choose the **Layout** (Stereo, 4ch, 8ch, 16ch).
    - **Save Audio Settings**.

## 2. Channel Patching (Cross-Patching)

If you need to route specific internal CasparCG channels to different physical outputs:

1.  In the same Audio Inspector, use the **Pair Mapper**.
2.  Example: To send internal channels **Mix 7-8** to physical **Out 1-2**:
    - Set `Out 1-2 ← Mix 7-8`.
3.  Click **Save Audio Settings**.
4.  Apply the Caspar configuration (Settings → Apply).

> [!TIP]
> In your Timeline or Looks, set the **Audio Route** for a layer to `7+8`. It will now play out of the physical channels 1-2 on that port.

## 3. Operator Hardware Monitor

You can now have a dedicated "Headphones" or "Monitor" jack on the server that you control from the UI.

### Configuration
1.  Go to **Device View** -> **Caspar host setup** (the server icon).
2.  Under the **Audio** section:
    - Check **Enable Monitor Channel**.
    - Select the **Monitor device** (e.g., your motherboard's line-out).
    - Save and Apply.

### Usage
1.  In the Top Bar, click the **Headphones** icon.
2.  Under **Server Hardware Monitor**, select the source:
    - **PGM**: Listen to the main program output.
    - **PRV**: Listen to the preview bus.
    - **Multiview**: Listen to the multiview audio.

## 4. Troubleshooting

- **No audio?** Ensure the `casparcg` user has permission to use the audio hardware. See the [Sudo and Audio Setup](file:///Users/marcin/.gemini/antigravity/brain/63228b37-49f5-4a6f-91c1-cd1a0aa92723/artifacts/sudo_and_audio_setup.md) guide.
- **PortAudio missing?** Ensure your CasparCG build supports PortAudio and the `custom_live` profile is selected in HighAsCG settings.

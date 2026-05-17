# WO-44: Audio Output Routing and Solo System

## Objective
Enhance the audio routing and output system in HighAsCG to support distinct PortAudio and System Audio consumers, allow targeted channel-to-device mapping via cables, and introduce a flexible "solo" monitoring system in the audio mixer for headphone output.

## Requirements

### 1. Audio Consumer Types
- **PortAudio (Main Output)**: 
  - Standard multi-channel (e.g. 8ch) primary audio output.
  - Used for routing channel pairs in layers, looks, or timelines.
- **System Audio (Monitor/Headphones Output)**:
  - Stereo only.
  - Meant for monitoring and headphone use.
  - Hardware detection for System Audio may differ from the existing PortAudio enumeration and must be investigated/implemented.

### 2. Output Device Selection & Routing
- In the "Audio Outputs" section of the Device View / Inspector, users must be able to select the consumer type (`portaudio` or `system audio`) from a dropdown menu.
- Users can attach these consumers to specific Caspar channels using the existing cabling interface.
- Examples: 
  - Cable `Channel 1` (PGM) to an 8-channel PortAudio device.
  - Cable `Channel 2` (PRV) to a stereo System Audio device (Headphones).
- **CasparCG Configuration**: The assigned devices and consumer types must be correctly serialized into the `casparcg.config` file, as is done for other consumers.

### 3. Audio Mixer "Solo" System
- Introduce a "Solo" button/toggle for each channel-layer in the audio mixer.
- This allows monitoring of specific layers that are actively producing audio (e.g., a DeckLink input layer not yet routed to the PGM output) directly to the System Audio (headphones) output.
- **Multi-Solo (Cmd/Ctrl + Click)**: Holding `Cmd` or `Ctrl` while clicking multiple solos will add them to a summed solo output sent to the headphones.
- **Solo Reset**: Clicking on any currently enabled solo button (without modifiers) will disable the solo system entirely, reverting the System Audio (headphone) output back to listening to `Channel 2` (the PRV channel).

## Technical Implementation Notes
1. **Device Enumeration API**: Investigate `routes-audio.js` and `hardware-info.js` to see how system audio devices (ALSA/Pulse/PipeWire) can be listed distinctly from PortAudio devices if necessary, or if PortAudio can reliably list both in a way that allows us to tag them as "system/stereo" vs "main/8ch".
2. **Config Generation**: Update `caspar-config-generator.js` to correctly format the XML nodes for `<portaudio>` and `<system-audio>` consumers inside the `<channels>` definitions.
3. **Mixer UI**: Update the audio mixer React/Vanilla components to include the Solo button. State management will need to handle the `Cmd/Ctrl` modifier to array-push selected layers, and handle the fallback routing to `Channel 2`.
4. **Dynamic Routing**: Since CasparCG handles consumers per-channel, dynamically "soloing" a layer might require dynamically creating an audio route (e.g., `AMCP MIXER ROUTE`) from the soloed layer directly to the channel that possesses the System Audio consumer (e.g., routing `CH1-LAYER10` audio to `CH2-LAYER[Monitor]`), or leveraging an internal hidden channel specifically for the Solo bus.

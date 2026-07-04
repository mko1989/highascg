# WO-132 — Flow: ALSA Audio Routing

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `alsa:hdmi`, `alsa:usb`, `alsa:dante`, `alsa:decklink-audio`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that results in CasparCG playing audio through physical sound hardware.

### 1. Initialization (This does that)
The HighAsCG server provisions CasparCG's configuration to instantiate ALSA audio consumers. CasparCG binds to specific logical ALSA PCM devices (e.g., `hw:0,0` for HDMI, `hw:1,0` for USB Mixers) based on the operator's routing configuration.

### 2. Execution Mechanism (In that way)
During playout, the CasparCG audio mixer processes floating-point audio data from all active layers, applying volume, panning, and transition effects. The final mixed multi-channel audio buffer is dispatched directly to the Linux ALSA subsystem. ALSA bypasses user-space audio servers (like PulseAudio or PipeWire) to gain exclusive, low-latency control over the hardware DACs.

### 3. Final Result (Which results in that reacting this way)
As a result, the physical audio interfaces (HDMI ports, USB soundcards, or Dante network adapters) receive the raw PCM stream. This reacts by converting the digital signal into analog voltage (or network packets), driving speakers, mixing consoles, or headphones synchronously with the video output.

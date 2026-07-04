# WO-131 — Flow: DeckLink PGM Output

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `decklink:output`, `decklink:input`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that results in CasparCG outputting physical broadcast signals via Blackmagic Design hardware.

### 1. Initialization (This does that)
The CasparCG server loads a `decklink` consumer module for a specific video channel as defined in `casparcg.config`. This module initializes a connection to the proprietary Blackmagic `blackmagic-io` kernel driver (DeckLink API) for a specific physical SDI or HDMI output port.

### 2. Execution Mechanism (In that way)
During active playout, CasparCG's compositor mixes all active layers (video, graphics, HTML) into a final uncompressed ARGB frame buffer. This frame buffer is handed off to the DeckLink consumer, which performs an internal color space conversion from ARGB to YUV 4:2:2 or 4:4:4. The frame is then scheduled into the hardware's playback queue.

### 3. Final Result (Which results in that reacting this way)
As a result, the Blackmagic PCIe card clocks out the YUV frames as a physical SDI or HDMI signal strictly conforming to the broadcast standard (e.g., 1080p50). This signal reacts by cleanly feeding downstream hardware switchers, recorders, or broadcast encoders with zero frame drops and embedded multi-channel audio.

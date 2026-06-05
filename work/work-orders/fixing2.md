# CasparCG Configuration Issues - 2026-04-29

## 1. Missing DeckLink Consumers
The CasparCG configuration generator is currently not generating `<decklink>` consumers in the `<consumers>` block of a channel, even when DeckLink outputs are configured in the Device View.

## 2. Audio Settings Centralization
Audio settings (device name, channel layout, etc.) should be migrated from general host settings into the `audioOutputs` array within the configuration. This ensures that each audio output can be configured independently.

## 3. PortAudio Initialization Issue
Even when `<portaudio>` is configured with `<output-channels>8</output-channels>` and a specific `<device-name>`, CasparCG logs indicate it initializes with 2 channels and the "default" device.
- Log indicates: `PortAudio Consumer: 2 channels`
- Log indicates: `Using default device: "default"`
- Expected: 8 channels, specific device (e.g., `hw:CARD=NVidia,DEV=7`)

The XML generation needs to be verified to ensure the tags are correct and compatible with the CasparCG version in use.

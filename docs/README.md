# HighAsCG documentation

Operator and integrator docs live at the **top level** of this folder. Deeper material is grouped by audience.

## Start here (operators & installers)

| Document | Topic |
|----------|--------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | **Unified playout stack** — API + `dist-web/` on `:4200`, same machine |
| [Interactive Map](/map) | **Project Map** — Visual architecture graph (served at `/map` at runtime) |
| [PLAN_SERVER_CLIENT_SPLIT.md](PLAN_SERVER_CLIENT_SPLIT.md) | Historical WO-51 headless plan (superseded by WO-52) |
| [../from_client/AGENT_SERVER_CLIENT_MERGE.md](../from_client/AGENT_SERVER_CLIENT_MERGE.md) | **WO-52** deploy checklist — API + UI on playout |
| [MANUAL_INSTALL.md](MANUAL_INSTALL.md) | Production install on Ubuntu (`scripts/install.sh`) |
| [STICK_QUICK_START.md](STICK_QUICK_START.md) | **Operator stick prep** — download ISO, Etcher, exFAT, starter zip, BIOS |
| [LIVE_USB_IMAGE.md](LIVE_USB_IMAGE.md) | Build / flash / boot a live USB from a running host |
| [CALAMARES_INSTALL_TO_DISK.md](CALAMARES_INSTALL_TO_DISK.md) | **Install to internal disk** — **disable CSM**, Calamares, UEFI ESP, **`bios_grub`** + `/`, troubleshooting |
| [ISO_CONTENTS.md](ISO_CONTENTS.md) | What is inside the Eggs live ISO (OS → Caspar → HighAsCG) |
| [DEV_RELEASE_GITHUB.md](DEV_RELEASE_GITHUB.md) | GitHub prereleases (alpha tarball, full ISO+tarball) |
| [WO47_ISO_VS_EXFAT.md](WO47_ISO_VS_EXFAT.md) | ISO squashfs vs exFAT stick payload (modular updates) |
| [BRIDGE_DISK_AND_USB_EXFAT.md](BRIDGE_DISK_AND_USB_EXFAT.md) | Internal bridge disk (HIGHASCGDAT) vs USB stick (HIGHASCGEXF) |
| [BOOT_EMERGENCY_RECOVERY.md](BOOT_EMERGENCY_RECOVERY.md) | Emergency boot (Ctrl+D): stale EFI fstab + optional USB mount blocking local-fs |
| [CASPAR_IMAGE_VS_HIGHASCG_OVERLAY.md](CASPAR_IMAGE_VS_HIGHASCG_OVERLAY.md) | Caspar-only ISO shell + HighAsCG from exFAT |
| [HIGHASCG_PASSWORDLESS_SUDO.md](HIGHASCG_PASSWORDLESS_SUDO.md) | Narrow `sudo` rules for media mount, NVIDIA, etc. |
| [openbox_autostart.md](openbox_autostart.md) | nodm + Openbox + Caspar autostart chain |
| [casparcg-linux-usb-guide.md](casparcg-linux-usb-guide.md) | USB stick usage on Linux |
| [USB_AUTO_MOUNT_UBUNTU.md](USB_AUTO_MOUNT_UBUNTU.md) | Auto-mount removable media (udisks / polkit) |

## Application & integration

| Document | Topic |
|----------|--------|
| [**HTML wiki**](wiki-site/index.html) | **Standalone browser UI** — open `docs/wiki-site/index.html` (`npm run wiki:build` after doc edits) |
| [wiki/api/README.md](wiki/api/README.md) | **HTTP API wiki** (all endpoints, examples, OpenAPI YAML) |
| [wiki/api/scene-take.md](wiki/api/scene-take.md) | **`POST /api/scene/take`** (detailed) |
| [wiki/api/playback.md](wiki/api/playback.md) | **Playback** — play/load/stop/clear, etc. |
| [wiki/api/timelines.md](wiki/api/timelines.md) | **Timelines** — CRUD, transport, take |
| [wiki/api/mixer.md](wiki/api/mixer.md) | **Mixer** — `/api/mixer/{command}` |
| [wiki/api/cg.md](wiki/api/cg.md) | **CG** templates |
| [wiki/api/project.md](wiki/api/project.md) | **Project** save/load |
| [wiki/api/state-and-media.md](wiki/api/state-and-media.md) | **State**, media, variables |
| [api-reference.md](api-reference.md) | Legacy AMCP REST overview (partial — see wiki) |
| [MODULES.md](MODULES.md) | Feature flags and optional modules |
| [osc-integration.md](osc-integration.md) | OSC from CasparCG into HighAsCG |
| [caspar_config_explained.md](caspar_config_explained.md) | Caspar XML / config concepts |
| [companion-websocket-catalog-bootstrap.md](companion-websocket-catalog-bootstrap.md) | Bitfocus Companion + slim WS catalog |
| [companion-module-ui-selection.md](companion-module-ui-selection.md) | Companion module UI notes |

## Audio (operator guides)

| Document | Topic |
|----------|--------|
| [guides/audio/audio-setup-guide.md](guides/audio/audio-setup-guide.md) | Audio routing entry point |
| [guides/audio/audio_features_walkthrough.md](guides/audio/audio_features_walkthrough.md) | Audio features tour |

## Other folders

| Folder | Audience |
|--------|----------|
| [reference/](reference/) | AMCP mapping, GPU/xrandr design, [screen consumer vsync (NVIDIA)](reference/screen-consumer-vsync-nvidia.md), PixelHue API, deep audio routing |
| [internal/](internal/) | Custom Caspar builds, image consolidation, architecture notes |
| [../work/work-orders/](../work/work-orders/) | Engineering work orders (WO-*) — **not shipped runtime** |
| [../work/references/](../work/references/) | Design prototypes — **not part of the program** |

**On playout server:** **`dist-web/`** (built from in-repo **`client/`**, served on `:4200` on the **same machine** as the API), **`index.js`**, **`src/`**, **`config/`**, **`template/`**.  
**Not on playout as sources:** raw **`client/`** tree (ship **`dist-web/`** only), **`work/`**.  
**Canonical UI development:** edit **`client/`** in this repo → `npm run build:client`.  
**highascg-client** (optional): Electron packaging extract (`client/tools/electron-launcher/`) — simulator, multiserver, modules; opens browser to playout `:4200`; **not** the operator UI source tree.

# AMCP Architecture Mapping

This document maps out the CasparCG TCP AMCP commands, their respective HighAsCG REST endpoints, and the underlying modular JS methods.

## Basic Layout

| CasparCG AMCP Command | JS Method (`amcp.[sub]`) | REST Endpoint |
|-----------------------|--------------------------|---------------|
| `LOAD`                | `basic.load` / `.load`   | `POST /api/load` |
| `LOADBG`              | `basic.loadbg` / `.loadbg` | `POST /api/loadbg` |
| `PLAY`                | `basic.play` / `.play`   | `POST /api/play` |
| `PAUSE`               | `basic.pause` / `.pause` | `POST /api/pause` |
| `RESUME`              | `basic.resume` / `.resume` | `POST /api/resume` |
| `STOP`                | `basic.stop` / `.stop`   | `POST /api/stop` |
| `CLEAR`               | `basic.clear` / `.clear` | `POST /api/clear` |
| `CALL`                | `basic.call`             | `POST /api/call` |
| `SWAP`                | `basic.swap`             | `POST /api/swap` |
| `ADD`                 | `basic.add`              | `POST /api/add` |
| `REMOVE`              | `basic.remove`           | `POST /api/remove` |
| `PRINT`               | `basic.print`            | `POST /api/print` |
| `LOG LEVEL`           | `basic.logLevel`         | `POST /api/log/level` |
| `LOG CATEGORY`        | `basic.logCategory`      | `POST /api/log/category` |
| `SET`                 | `basic.set`              | `POST /api/set` |
| `LOCK`                | `basic.lock`             | `POST /api/lock` |
| `PING`                | `basic.ping`             | `POST /api/ping` |

## Mixer Submodule

*Note: All Mixer commands accept `#duration`, `#tween`, and `#defer` parameters.*

| CasparCG AMCP Command | JS Method (`amcp.mixer`) | REST Endpoint |
|-----------------------|--------------------------|---------------|
| `MIXER KEYER`         | `mixerKeyer`             | `/api/mixer/keyer` |
| `MIXER CHROMA`        | `mixerChroma`            | `/api/mixer/chroma` |
| `MIXER BLEND`         | `mixerBlend`             | `/api/mixer/blend` |
| `MIXER INVERT`        | `mixerInvert`            | `/api/mixer/invert` |
| `MIXER OPACITY`       | `mixerOpacity`           | `/api/mixer/opacity` |
| `MIXER BRIGHTNESS`    | `mixerBrightness`        | `/api/mixer/brightness` |
| `MIXER SATURATION`    | `mixerSaturation`        | `/api/mixer/saturation` |
| `MIXER CONTRAST`      | `mixerContrast`          | `/api/mixer/contrast` |
| `MIXER LEVELS`        | `mixerLevels`            | `/api/mixer/levels` |
| `MIXER FILL`          | `mixerFill`              | `/api/mixer/fill` |
| `MIXER CLIP`          | `mixerClip`              | `/api/mixer/clip` |
| `MIXER ANCHOR`        | `mixerAnchor`            | `/api/mixer/anchor` |
| `MIXER CROP`          | `mixerCrop`              | `/api/mixer/crop` |
| `MIXER ROTATION`      | `mixerRotation`          | `/api/mixer/rotation` |
| `MIXER VOLUME`        | `mixerVolume`            | `/api/mixer/volume` |
| `MIXER STRAIGHT_ALPHA_OUTPUT` | `mixerStraightAlphaOutput` | `/api/mixer/straight_alpha` |
| `MIXER GRID`          | `mixerGrid`              | `/api/mixer/grid` |
| `MIXER COMMIT`        | `mixerCommit`            | `/api/mixer/commit` |
| `MIXER CLEAR`         | `mixerClear`             | `/api/mixer/clear` |

## CG Submodule

| CasparCG AMCP Command | JS Method (`amcp.cg`) | REST Endpoint |
|-----------------------|-----------------------|---------------|
| `CG ADD`              | `cgAdd`               | `POST /api/cg/add` |
| `CG PLAY`             | `cgPlay`              | `POST /api/cg/play` |
| `CG STOP`             | `cgStop`              | `POST /api/cg/stop` |
| `CG NEXT`             | `cgNext`              | `POST /api/cg/next` |
| `CG GOTO`             | `cgGoto`              | `POST /api/cg/goto` |
| `CG REMOVE`           | `cgRemove`            | `POST /api/cg/remove` |
| `CG CLEAR`            | `cgClear`             | `POST /api/cg/clear` |
| `CG UPDATE`           | `cgUpdate`            | `POST /api/cg/update` |
| `CG INVOKE`           | `cgInvoke`            | `POST /api/cg/invoke` |
| `CG INFO`             | `cgInfo`              | `POST /api/cg/info` |

## DATA Submodule

| CasparCG AMCP Command | JS Method (`amcp.data`) | REST Endpoint |
|-----------------------|-------------------------|---------------|
| `DATA STORE`          | `dataStore`             | `POST /api/data/store` |
| `DATA RETRIEVE`       | `dataRetrieve`          | `POST /api/data/retrieve` |
| `DATA LIST`           | `dataList`              | `POST /api/data/list` |
| `DATA REMOVE`         | `dataRemove`            | `POST /api/data/remove` |

## SYSTEM Queries Submodule

| CasparCG AMCP Command | JS Method (`amcp.query`) | REST Endpoint |
|-----------------------|--------------------------|---------------|
| `CLS`                 | `cls`                    | Used internally (`/api/media`) |
| `TLS`                 | `tls`                    | Used internally (`/api/templates`) |
| `FLS`                 | `fls`                    | `GET /api/fonts` |
| `VERSION`             | `version`                | *Internal property hook* |
| `INFO`                | `info`                   | *Internal properties* |
| `INFO SERVER`         | `infoServer`             | `GET /api/server` |
| `INFO QUEUES`         | `infoQueues`             | `GET /api/server/queues` |
| `INFO THREADS`        | `infoThreads`            | `GET /api/server/threads` |
| `GL INFO`             | `glInfo`                 | `GET /api/server/gl` |
| `GL GC`               | `glGc`                   | `POST /api/gl/gc` |
| `DIAG`                | `diag`                   | `POST /api/diag` |
| `HELP`                | `help`                   | `GET /api/help` / `GET /api/help/:cmd` |
| `BYE`                 | `bye`                    | *Internal shutdown* |
| `KILL`                | `kill`                   | `POST /api/kill` |
| `RESTART`             | `restart`                | `POST /api/restart` |

## THUMBNAIL Submodule

| CasparCG AMCP Command | JS Method (`amcp.thumb`) | REST Endpoint |
|-----------------------|--------------------------|---------------|
| `THUMBNAIL LIST`      | `thumbnailList`          | `GET /api/thumbnails` |
| `THUMBNAIL RETRIEVE`  | `thumbnailRetrieve`      | `GET /api/thumbnail/:filename` |
| `THUMBNAIL GENERATE`  | `thumbnailGenerate`      | `POST /api/thumbnails/generate` |
| `THUMBNAIL GENERATE_ALL` | `thumbnailGenerateAll`| `POST /api/thumbnails/generate-all` |

## Scene take (`POST /api/scene/take`)

Default look take uses dual-bank mixer opacity crossfades (`runSceneTake`). Optional **`takeMode: "lbg"`** runs **`runSceneTakeLbg`**: per layer, `LOADBG` with the look’s transition (e.g. `MIX` + frames + tween), then mixer setup, then `PLAY` with no clip (FG/BG swap). Timeline-only looks ignore `takeMode` and use the timeline engine.

# Open issues (operator / production)

Lightweight index of **unresolved** work. Close items here when verified on hardware.

**Status legend:** 🟡 Implemented — code landed 2026-07-13, needs highascg service restart + browser reload, then operator/hardware sign-off. 🔴 Open — work remaining. ✅ Done — verified.

> **2026-07-13 batch note:** WO-155 through WO-179 were implemented today by agents on this box. NOTHING server-side is active until the `highascg` service restarts (client bundle in `dist-web/` was rebuilt — a browser reload picks up client fixes). See each WO's acceptance criteria for its hardware checklist. The media scanner (WO-162) is the exception: fixed live, already running.

| ID | Summary | Tracker | Status |
|----|---------|---------|--------|
| LOOKS-RESTART | Clip restarted on every looks-editor param edit; PRV mirror; stale PRV thumbnail | [WO-155](./work-orders/155_WO_LOOKS_EDITOR_CLIP_RESTART_AND_PRV_MIRROR.md) | 🟡 Implemented |
| ROUTE-SELFLOOP | Self-route guard (all playout paths); multiview auto re-apply + refresh button | [WO-156](./work-orders/156_WO_ROUTE_SELF_LOOP_GUARD_AND_MULTIVIEW_RESTART_REAPPLY.md) | 🟡 Implemented |
| AUDIO-STRIP-ROUTING | Screens row above stereo-pair on media strips (UI done); cross-screen fan-out model | [WO-157](./work-orders/157_WO_AUDIO_MIXER_SCREEN_THEN_PAIR_ROUTING.md) | 🟡 UI done / 🔴 fan-out owner-gated |
| CROP-UX | Crop visible in editor, px values, visual handles, crop-aware PIP borders | [WO-158](./work-orders/158_WO_LOOKS_CROP_VISUAL_HANDLES_PIXELS_AND_BORDER_AWARENESS.md) | 🟡 Implemented |
| CH3-BLACK-PREVIEW | Stale jpeg truncation, blocklist WS bootstrap + reconnect reset, badge states | [WO-159](./work-orders/159_WO_CH3_BLACK_COMPOSE_PREVIEW_STALE_JPEG_AND_BLOCKLIST_UX.md) | 🟡 Implemented |
| BANK-LAYERS | Consecutive layers 10+ (A) / 110+ (B), timelines 210+, PIP band 260-979, migration; PGM-only on real bank crossfades | [WO-160](./work-orders/160_WO_BANK_LAYER_SCHEME_90_LAYERS_AND_PGM_ONLY_BANKS.md) | 🟡 Implemented (A+B verified in smokes) |
| CONFIG-LIFECYCLE | Atomic XML writes, save mutex, configVersion; stale-file/backup deletions | [WO-161](./work-orders/161_WO_CONFIG_LIFECYCLE_ATOMIC_WRITES_STALE_FILES_BACKUPS.md) | 🟡 Implemented / 🔴 deletions owner-gated |
| SCANNER-CONFIG | Media scanner revived live (was crash-looping since Jun 28); eggs guard + seeding | [WO-162](./work-orders/162_WO_SCANNER_CONFIG_RESTORE_AND_EGGS_RESET_GUARD.md) | ✅ Scanner live / 🟡 eggs guard needs next produce run |
| MAP-REMOVAL | Project map removed from main service (GitHub Pages only) | [WO-163](./work-orders/163_WO_REMOVE_PROJECT_MAP_FROM_MAIN_SERVICE.md) | ✅ Done |
| INFO-POLL | Live-audio watchdog INFO 6-10 every 15 s → probe-on-suspicion only | [WO-164](./work-orders/164_WO_LIVE_AUDIO_WATCHDOG_QUIET_INFO_PROBE.md) | 🟡 Implemented (verify a day of logs) |
| EYES+MODALS | Per-process CPU/RSS in status-eye hover; settings/logs modals undimmed | [WO-165](./work-orders/165_WO_STATUS_EYES_PROCESS_USAGE_AND_MODAL_BACKDROP.md) | 🟡 Implemented |
| LIVE-AUDIO-SWAP | Device change from the layer inspector, no Caspar restart | [WO-166](./work-orders/166_WO_LIVE_AUDIO_DEVICE_SWAP_IN_INSPECTOR.md) | 🟡 Implemented |
| TEMPLATE-REFRESH | Refresh re-fetches template catalog client-side (TLS already fired server-side) | [WO-167](./work-orders/167_WO_TEMPLATE_REFRESH_CLIENT_FETCH.md) | 🟡 Implemented |
| EGGS-EXCLUDES | `.private` identity leak excluded + verified; trash/backup purge; defaults manifest. **Rotate identities on boxes cloned from pre-2026-07-13 ISOs.** | [WO-168](./work-orders/168_WO_EGGS_EXCLUDES_CLEANUP_AND_FACTORY_DEFAULTS.md) | 🟡 Implemented (verify on next produce) |
| COUNTDOWN | Countdown/timer CG template + inspector + stateless API; multi-instance | [WO-169](./work-orders/169_WO_COUNTDOWN_TIMER_TEMPLATE.md) | 🟡 Implemented |
| COMPANION-PARITY | Streaming/record + multiview + timeline take/sendto + countdown actions in the companion module | [WO-170](./work-orders/170_WO_COMPANION_MODULE_API_PARITY.md) | 🔴 In progress |
| MATH-INPUTS | Math expressions in all number inputs (44 fields + follow-up sweep) | [WO-171](./work-orders/171_WO_MATH_IN_ALL_NUMBER_INPUTS.md) | 🟡 Implemented |
| STREAM-RECORD | Device-view→stream source sync fixed (missing export), record audio filter, layout-aware downmix, flag policy | [WO-172](./work-orders/172_WO_STREAMING_RECORD_SOURCE_SYNC_FLAGS_AUDIO.md) | 🟡 Implemented |
| TIMELINE-BATCH | Schedule-style AMCP: clip-start batches with DEFER fade-ins (P1 done); per-tick segment batching (P2/3) | [WO-173](./work-orders/173_WO_TIMELINE_SCHEDULE_BATCHED_AMCP.md) | 🔴 P2/P3 in progress |
| ROUTE-AUDIO-PICK | Choose source audio channels on route layers (e.g. only ch1+2 of 8ch) | [WO-174](./work-orders/174_WO_ROUTE_SOURCE_AUDIO_CHANNEL_PICK.md) | 🟡 Implemented |
| FTB-CLEAR | FTB fades 0.5 s at project fps then clears; Unblock button removed | [WO-175](./work-orders/175_WO_FTB_FADE_THEN_CLEAR_REMOVE_UNBLOCK.md) | 🟡 Implemented |
| PRV-RECHECK | "Current look still wrong on PRV" — re-test AFTER restart+reload (today's fixes inactive when reported) | [WO-176](./work-orders/176_WO_PRV_CURRENT_LOOK_VERIFY_AFTER_RESTART.md) | 🔴 Blocked on restart |
| BORDER-COLOR | Border color reverted by mixer_update WS echo — whitelist + recent-edit guard | [WO-177](./work-orders/177_WO_BORDER_COLOR_STOMPED_BY_MIXER_UPDATE_ECHO.md) | 🟡 Implemented |
| MINI-SLIDERS | Slim sliders under 54 bounded number inputs (effects/crop/PIP params) | [WO-178](./work-orders/178_WO_MINI_SLIDERS_UNDER_NUMBER_INPUTS.md) | 🟡 Implemented |
| LIGHTING-IO | Art-Net listener default OFF; sACN input; region-averaged sampling; mirror H/V | [WO-179](./work-orders/179_WO_ARTNET_SACN_DEFAULTS_AND_PIXELMAP_SAMPLING.md) | 🟡 Implemented |
| GDTF | GDTF fixture import/export | [WO-180](./work-orders/180_WO_GDTF_FIXTURE_IMPORT_EXPORT.md) | 🔴 Open (after WO-179 QA) |
| PGM-ONLY-500 | Take 500 (latent missing import, exposed by WO-160b) + exit-edit 400 on PGM-only mains | [WO-181](./work-orders/181_WO_PGM_ONLY_TAKE_500_AND_EXIT_EDIT_400.md) | 🟡 Implemented (needs restart) |
| EYES-CPU | 1400% CPU display → normalized machine share with core count | [WO-182](./work-orders/182_WO_EYES_CPU_NORMALIZATION.md) | 🟡 Implemented |
| MIXER-TIMELINE | Mixer showed last look's inputs after timeline take → timeline clip strips + stale filter | [WO-183](./work-orders/183_WO_AUDIO_MIXER_TIMELINE_TAKE_INPUTS.md) | 🟡 Implemented |
| THUMB-SPAM | "Image corrupt or truncated" console spam → atomic thumb writes, serve guards, client retry-once | [WO-184](./work-orders/184_WO_IMAGE_CORRUPT_TRUNCATED_THUMB_SPAM.md) | 🟡 Implemented |

| GLOBAL-PLAY-MAIN | Global play in the editor took the look to the wrong PGM → targets the edited look's main | [WO-185](./work-orders/185_WO_GLOBAL_PLAY_WRONG_MAIN_IN_EDITOR.md) | 🟡 Implemented |
| TIMER-PANEL | Collapsible timer control panel (selector, HH/MM/SS, center default) | [WO-186](./work-orders/186_WO_TIMER_CONTROL_PANEL.md) | 🟡 Implemented |
| TEMPLATE-THUMBS | Template layers show rendered "shown-state" snapshots in the looks editor | [WO-187](./work-orders/187_WO_TEMPLATE_THUMBNAILS_IN_LOOKS_EDITOR.md) | 🟡 Implemented |

| UPDATE-GAPS | dist-web now included in drops; DeckLink install API/UI + tar.gz; vendor seeding verified (GitHub webui update flow was already fully shipped) | [WO-188](./work-orders/188_WO_UPDATE_SYSTEM_GAPS_DISTWEB_DECKLINK.md) | 🟡 Implemented |
| HW-DISPLAY | Settings → System tab hardware summary (/api/system/hardware aggregator) | [WO-189](./work-orders/189_WO_SETTINGS_SYSTEM_HARDWARE_DISPLAY.md) | 🟡 Implemented |

| GLOBAL-PLAY-MAIN | Global play in editor targets the edited look's main | [WO-185](./work-orders/185_WO_GLOBAL_PLAY_WRONG_MAIN_IN_EDITOR.md) | 🟡 Implemented |
| TIMER-PANEL | Collapsible timer control panel, HH/MM/SS, center default | [WO-186](./work-orders/186_WO_TIMER_CONTROL_PANEL.md) | 🟡 Implemented |
| TEMPLATE-THUMBS | Rendered template snapshots in the looks editor | [WO-187](./work-orders/187_WO_TEMPLATE_THUMBNAILS_IN_LOOKS_EDITOR.md) | 🟡 Implemented |
| MV-CROP | Multiview shows layer without top crop (main correct) — apply lock + debug endpoint shipped; **owner repro capture needed** (procedure in WO §5) | [WO-190](./work-orders/190_WO_MULTIVIEW_TOP_CROP_MISMATCH.md) | 🔴 Awaiting repro evidence |
| MV-TIMERS | Per-layer L-rows with timers/progress on the multiview overlay | [WO-191](./work-orders/191_WO_MULTIVIEW_PER_LAYER_TIMERS.md) | 🟡 Implemented |

| TIMER-PANEL-FIX | Timer panel live ticking display, duration persistence, preset buttons | [WO-192](./work-orders/192_WO_TIMER_PANEL_LIVE_DISPLAY_PERSIST_PRESETS.md) | 🟡 Implemented |
| SYSTEM-TIME | System time view/NTP/manual set in Settings → System (sudoers via next installer run) | [WO-193](./work-orders/193_WO_SYSTEM_TIME_SETTING.md) | 🟡 Implemented |
| HOSTNAME-USB | Hostname-from-MAC failed on USB boots (read-only /var/log aborted wrapper) — fail-open logging; box self-corrects to highascg7579 next boot | [WO-194](./work-orders/194_WO_HOSTNAME_FROM_MAC_USB_BOOT_FIX.md) | 🟡 Implemented |

| MV-OVERLAY-REFINE | Overlay: pip rows hidden, L##+filename labels, no top block, PRV bank-map fix, instant stale-row removal | [WO-195](./work-orders/195_WO_MULTIVIEW_OVERLAY_REFINEMENTS.md) | 🟡 Implemented (reload via multiview Refresh) |
| COUNTDOWN-LIFECYCLE | Timer cleared on look exit; continuity across same-timer transitions (UPDATE-only takes); panel lists all project timers w/ on-air marks | [WO-196](./work-orders/196_WO_COUNTDOWN_LIFECYCLE_TEARDOWN_CONTINUITY_PANEL.md) | 🟡 Implemented |

Last updated: 2026-07-14 (WO-181–196; server-side changes live on next service restart; local commits await `git push origin main` by owner)

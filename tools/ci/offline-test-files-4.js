'use strict'

/**
 * The curated offline CI test bundle, part 4 — the WO-1106 review fix list's smokes (one or more per fixed row), spread
 * into part 3. Same rules as the other parts: each file passes on the box and touches no live state.
 */
module.exports = [
	'tools/smoke/smoke-wo1106-world-client-visitors.test.js', // WO-1106 A1 / A4 / A14 / A21 / A33: silence = unchanged, wst off clears all, effect cap, late models
	'tools/smoke/smoke-wo1106-world-client-pages.test.js', // WO-1106 A8 / A34 / A37: board house / scene / paused, host act gate, spectator boot retry
	'tools/smoke/smoke-wo1106-world-server-hub.test.js', // WO-1106 A5 / A8 / A16 / A18 / A25: skipped sends re-sent, board house / scene / paused, wq map, last game gone, refused effects
	'tools/smoke/smoke-wo1106-world-server-service.test.js', // WO-1106 A8: the board carries the house level and the hello scene
	'tools/smoke/smoke-wo1106-world-server-ws.test.js', // WO-1106 A15 / A18: backpressure terminate, ping sweep, off + 4403 when no game runs
	'tools/smoke/smoke-wo1106-world-server-referee.test.js', // WO-1106 A17: referee maps are swept
	'tools/smoke/smoke-wo1106-salad-world.test.js', // WO-1106 A2 / A5 / A32: contact carries the collider id (real hub), send says if it went, wq re
	'tools/smoke/smoke-wo1106-salad-client.test.js', // WO-1106 A4 / A32 / A36 / B61–B64: welcome reset, queue overflow, floors, disposal, muted start, non-finite flights, host gate
	'tools/smoke/smoke-wo1106-salad-room.test.js', // WO-1106 B34 / B36 / B60 / B64: ghost seats, silent spectators, per-address cap, buzzer clears flights
	'tools/smoke/smoke-wo1106-rc-client-fixes.test.js', // WO-1106 A4 / A32 / A35 / B35 / B42–B50: ghosts hidden, item press kept, clock reset, bot hit, host refresh, racing flag, spectator full card
	'tools/smoke/smoke-wo1106-rc-server-room.test.js', // WO-1106 B36 / B39 / B41: silent spectators, a race with no racer ends, ready broadcasts on change
	'tools/smoke/smoke-wo1106-rc-server-game.test.js', // WO-1106 A5 / A23 / B36 / B37 / B52 / B53: send result, own-key levels, unchanged scene rev keeps the bots, drop on disable, no CGNAT join url
	'tools/smoke/smoke-wo1106-rc-server-media.test.js', // WO-1106 B38 / B40 / B51 / B52: video subscribe on change + hold, stale bakes skipped, fresh bot-brain import
	'tools/smoke/smoke-wo1106-rc-server-world.test.js', // WO-1106 A32: wq re → the hub serves that socket afresh
	'tools/smoke/smoke-wo1106-skirmish-server.test.js', // WO-1106 A3 / A5 / A24 / A32 / B34 / B36 / B55 / B57–B59: stunned bots, ghost cap, move window, no damage while paused, weapon gap
	'tools/smoke/smoke-wo1106-skirmish-client.test.js', // WO-1106 A4 / A11 / A32 / B35 / B54 / B56 / B58 / B59: welcome reset, knock-back, ghosts gone, pickups reset, scene rev
	'tools/smoke/smoke-wo1106-core-modules.test.js', // WO-1106 B1 / B7 / B8 / B9: code-change gate (auth or the box itself), sha256 required for URLs, upgrade rollback, download deadline
	'tools/smoke/smoke-wo1106-core-venue-import.test.js', // WO-1106 B2 / B4: a file-then-folder name clash is rejected (no throw), staging caps, private temp dir under tests
	'tools/smoke/smoke-wo1106-core-pixelhue.test.js', // WO-1106 B3: a read cut mid-body settles; pending always clears
	'tools/smoke/smoke-wo1106-core-services.test.js', // WO-1106 B10–B13: keeping-up report caps, async fc-list / aplay, bluetooth status shared, live-audio repair backoff
	'tools/smoke/smoke-wo1106-core-shader-licence.test.js', // WO-1106 B14 / B68: no newlines in the header, removed ids never come back
	'tools/smoke/smoke-wo1106-iso-release-licences.test.js', // WO-1106 B65 / B66 / B69 / B70 / B72 / B73: collector home under sudo, host licence check, source state, dev-dep notices, module excludes, PortAudio, empty listing
	'tools/smoke/smoke-wo1106-games-hosting-fixes.test.js', // WO-1106 A6 / A7 / A19 / A23 / A26 / A30 + B1: sticky pause, local-only addresses, module list cache, level check, web save leaves games, module switch gate
	'tools/smoke/smoke-wo1106-stage-ltc.test.js', // WO-1106 B5 / B6 / B18–B23: zip budget, asoundrc label, one MagicQ rotation, finite OBJ numbers, cancel kills ffmpeg, libltc argtypes, degenerate matrix, runtime job restore
	'tools/smoke/smoke-wo1106-zoom-engine-window-fit.test.js', // WO-1106 C7: three empty looks clear the crop box (g++ harness, skipped without g++)
	'tools/smoke/smoke-wo1106-zoom-engine-audio.test.js', // WO-1106 C8 / C14: one tick at a time, daemon restart backoff + give-up, child error listeners
	'tools/smoke/smoke-wo1106-zoom-engine-session.test.js', // WO-1106 C9 / C12: one chain per source, a quit leaves no grabber, async grabber build
	'tools/smoke/smoke-wo1106-zoom-engine-ui.test.js', // WO-1106 C13: shared AT-SPI dump, one join / camera loop
	'tools/smoke/smoke-wo1106-zoom-engine-pixelhue.test.js', // WO-1106 C11 / C16: one Studio connect per host + failure cache, a layer removed mid-drive
	'tools/smoke/smoke-wo1106-cluster-http.test.js', // WO-1106 C17 / C22: peer answers capped + deadline, one poll in flight
	'tools/smoke/smoke-wo1106-cluster-media-link.test.js', // WO-1106 C20 / C26: sleep drops its abort listener, an aborted waiter hands the slot on
	'tools/smoke/smoke-wo1106-cluster-floors.test.js', // WO-1106 C23 / C24: hello floor persisted, per-namespace floors, linked fingerprints never evicted
	'tools/smoke/smoke-wo1106-cluster-air-journal.test.js', // WO-1106 C28: cleared layers leave the journal
	'tools/smoke/smoke-wo1106-godot-previs.test.js', // WO-1106 A22 / A42: converter outputs ignored + verifier, one drape colour form in GD and JS
	'tools/smoke/smoke-wo1106-godot-client-guards.test.js', // WO-1106 B28 / B31 / C3 / C4 / C6: polls keep one request in flight, presenters keep typed names, photo cache pruned
	'tools/smoke/smoke-wo1106-misc-zoom.test.js', // WO-1106 D3: rebind runs in the per-source chain, apply() waits for the tick in flight
	'tools/smoke/smoke-wo1106-misc-pixelhue.test.js', // WO-1106 C41: a dead Studio session is dropped, reconnected once and the call retried
	'tools/smoke/smoke-wo1106-misc-ci-decklink.test.js', // WO-1106 D4 / D5: dpkg --force-confmiss for desktopvideo, dev-dependency licences in the verify job
	'tools/smoke/smoke-wo1106-shaders-nc-tracked.test.js', // WO-1106 B67: no tracked template belongs to a NonCommercial-licensed shader; the withdrawn record
	'tools/smoke/smoke-wo1106-shaders-nc-store.test.js', // WO-1106 B67: the store never exports / seeds / ships an NC shader; locally held ones keep working, marked
	'tools/smoke/smoke-wo1106-shaders-nc-verifier.test.js', // WO-1106 B67: the ISO verifier fails an image that carries an NC shader
	'tools/smoke/smoke-wo1106-games2-lan.test.js', // WO-1106 D3: the games' join URLs rank link-local / bridge addresses last (same order as games-join)
	'tools/smoke/smoke-wo1106-games2-rc.test.js', // WO-1106 B34 / A35: RC resume token, bots take the hub's slick patches
	'tools/smoke/smoke-wo1106-games2-skirmish.test.js', // WO-1106 B34 / B56: Skirmish resume token, scene rev reaches players without a host page
	'tools/smoke/smoke-wo1106-games2-salad.test.js', // WO-1106 B34 / B60: Salad resume token, start / stop end practice flights
	'tools/smoke/smoke-wo1106-games2-client.test.js', // WO-1106 B34: the three net layers keep and send the token; 4410 = playing on another page
	'tools/smoke/smoke-wo1106-cluster2-relay.test.js', // WO-1106 D3: the relay has an overall deadline
	'tools/smoke/smoke-wo1106-cluster2-ownview.test.js', // WO-1106 C25: ownView cached per config revision (1000 verdicts, one build)
	'tools/smoke/smoke-wo1106-cluster2-lateness.test.js', // WO-1106 C21: the lateness baseline recovers after the sender's clock steps back
	'tools/smoke/smoke-wo1106-cluster2-press-once.test.js', // WO-1106 C19: a press runs once on the follower (local fallback or the master's copy, never both)
	'tools/smoke/smoke-wo1106-cluster2-v1-latch.test.js', // WO-1106 C27: v1 signed calls are refused from a peer seen on v2
	'tools/smoke/smoke-wo1106-cluster2-route-gate.test.js', // WO-1106 C29: cluster changes need the password, the box itself or a linked server's signature
	'tools/smoke/smoke-wo1106-shaderfx-nc-tick.test.js', // WO-1106 B67: the web Shader FX modal has an NC tick, sends allowNonCommercial only when ticked, shows the refusal and marks NC rows
	'tools/smoke/smoke-wo1113-visual-patch-flip.test.js', // WO-1113 previs decode turns an axis the patch runs against its file
	'tools/smoke/smoke-wo1120-shm-surface-half-size.test.js', // WO-1120 SHM consumer SCALE 2 for a channel far above UHD
	'tools/smoke/smoke-wo1122-operator-screen-reach.test.js', // WO-1122 operator-screen marks screens the confined pointer cannot reach
	'tools/smoke/smoke-wo1125-ctl-rules.test.js', // WO-1125 game self-service
	'tools/smoke/smoke-wo1125-ctl-games.test.js', // WO-1125 game self-service
	'tools/smoke/smoke-wo1125-self-service-core.test.js', // WO-1125 game self-service
	'tools/smoke/smoke-wo1125-client-panel.test.js', // WO-1125 game self-service
	'tools/smoke/smoke-wo1125-client-static.test.js', // WO-1125 game self-service
	'tools/smoke/smoke-wo1125-empty-room.test.js', // WO-1125 an abandoned round returns to the lobby
	'tools/smoke/smoke-caspar-memory-watch.test.js', // OOM 20.11: Caspar RSS history + burst / RAM-share warnings
]

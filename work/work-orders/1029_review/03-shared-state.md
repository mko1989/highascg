# 03 - Shared state between linked servers (review, read-only, 10.11.2026)

Scope: src/cluster/{shared-show,shared-show-ctx,show-merge,cluster-exchange,server-duties,server-senders,cluster-media}.js,
their wiring in src/api/routes-cluster.js, and the overlap with src/replication/. WO 712/732/746/751/772/802 read for intent.
Everything is from reading code plus two GETs (`/api/cluster` on .17/this box and .10). Nothing run, nothing changed.
Items marked (unconfirmed) follow from the code but I did not reproduce them.

Live state right now: both boxes `show.on: true`, this box master epoch 9, .10 follower, in_sync, same hash, slug `narvil`.
.10 has `before_share: projects/_cluster/new_project_1.before-share-20261109T195650.json`, i.e. on 9.11 sharing already
replaced .10's open project once. Both boxes have `replication.enabled=false` (checked here), so the old pair is not active now.

Line numbers: shared-show.js = SS, shared-show-ctx.js = CTX, show-merge.js = SM, server-senders.js = SND,
server-duties.js = DUT, routes-cluster.js = RC.

---------------------------------------------------------------------------------------------------------------------

## 1. Show sync

### How it works today (model)
- ONE show per cluster = the box's ACTIVE project, minus device-local hardware slices, `streaming`, and volatile stamps (SM:36-41).
  Master is the single writer. Followers get `show.push` (info) keyed by master epoch; a follower edit is a signed
  `show.propose` ACTION to the master, 3-way merged per keyed item (SM:merge3), master wins on a same-path conflict, the
  loser's version is written to `projects/_cluster/*.json` and the WS `cluster:show` says so.
- Per-box toggle `clusterShow.on` (SS:58), off by default, independent of the link. Not part of the link.
- Revision handling: `project.rev` is a per-box write counter. It is only compared in one place, the stale-push gate
  (SS:260, same epoch + same slug + lower rev). Real identity is the content hash; the epoch is the fence. Revs from two
  boxes are never comparable, and nothing relies on that. OK.

### Who wins when both edit
- Same item: master. Different items: both kept (tested, smoke-wo746-show-merge). Atomic (non-keyed) arrays and primitives
  conflict as a whole. Fine for the master/follower model.
- Master is whichever box holds the claim, not whichever box has the newer/better data. That is the root of most findings below.

### What a follower's edit does while the master is unreachable
- `written()` (SS:124) -> `propose()` -> `callMaster` fails with status 0 -> edit stays local and waits in `pending`
  (SS:220), later edits join it. On master return the edit is proposed at the same epoch and merged. Tested ("G4: a proposal
  made for the old epoch ... waits and goes again"). Good.
- BUT `pending` and `local` live only in memory (SS:~54-56). See F1.4 and F1.6.

### Findings (bugs against the current design)

**F1.1 [major] A mastership flip swaps the other box's open show, and the swap is driven by the claim, not by operator intent.**
SS:255-290 `onPush` -> `commit(show, slug, false)` -> CTX:21 `commitShow` -> `persistProject(project)`.
`persistProject` derives the slug from `project.name` (project-scenes.js ~l.307: `projectSlugFromName(project.name)`),
`name` is part of the shared show (not in VOLATILE, SM:25), so the follower's ACTIVE slug becomes the master's show name,
its live `screenDestinations` are replaced (CTX:27-30), and the on-box Godot client gets a project_sync broadcast. The slug
argument that `commit` receives is thrown away (CTX:76 `commit: (project) => ...`).
Scenario (today's incident, with show sharing ON on both boxes): A master with show "mhp", B master-after-failover with show "narvil".
Each flip, the new master pushes its show; the other box's open project is replaced. Epoch climbing every few seconds =
the operator's open show flips between the two shows. Only the first take is announced (before-share backup); later ones
log a warn.
Fix: (a) do not take a push from a claim younger than N seconds (claim.ts is signed, so this is checkable) or whose epoch
was reached by failover, until the operator confirms or the claim has been stable (hysteresis; WO-751 decision 2 asked the same);
(b) never switch the follower's active slug automatically: take the master's show into the slug with the same show identity
or only when the follower's open show is the one that was shared (`held.slug`), otherwise park it as a pending offer;
(c) add a show identity (uuid) to the project instead of using the display name.

**F1.2 [major] Backup covers the wrong file: a same-name project on the follower is overwritten with no copy.**
SS:275-281: the backup is `m.project`, the follower's ACTIVE project. The file that gets overwritten is slug(show.name)
(project-scenes.js persistProject, `readProjectFile(slug)` + `writeProjectFile`), and `preserveProjectCredentials` only keeps
credentials. Boxes commonly share names (`new_project_1` is the New-project default; .10's before_share file is exactly that).
Scenario: A's master show is "new_project_1" (looks a,b,c), B holds an unrelated "new_project_1" (looks x,y) not currently
open (or open: then backup is right). B takes the push: B's stored new_project_1.json is replaced by A's content; the unrelated
content exists nowhere. Conversely when B's open show is X and the master's is "new_project_1", X is backed up needlessly
while the real casualty is the unrelated new_project_1.json.
Fix: before `commit`, read `readProjectFile(slug(show.name))`; if it exists and its show-hash differs from the incoming hash,
back THAT up (tag `overwritten`). Also back up the open project when it differs (already done).

**F1.3 [major] A follower's New project / Load / delete becomes a proposal that rewrites the MASTER's open show and live destinations (WO-751 returns through the shared show).**
`written()` (SS:124) fires on every `persistProject`. New project on a follower = name + scenes + `screenDestinations` (factory
starter: Operator GUI only) all differ from `local.hash`, so the diff is a handful of big ops; the master has changed
nothing, so `merge3` returns `theirs` whole (SM merge3, `!hit.length`), `onPropose` (SS:177-206) `commit(merged, m.slug, true)`
runs `commitShow` on the master: master's active slug switches to the new name and `applyHardwareConfigToCtx` replaces the
master's live destinations (PGM/PRV gone from `ctx.config.screenDestinations`). This is exactly WO-751's complaint ("fresh
project on the main machine wiped the destinations on the failover master"), now reachable with no client-follow at all.
Only guard: master `accept_remote=false` (G6) or the toggle. (unconfirmed at runtime; follows from the code path.)
Fix: classify a change of `name`/slug (or a diff touching more than N top-level keys) as "show switch", not "edit": do not
propose it; the follower keeps its own show until the operator presses an explicit "share this show to the master". Also
exclude `hardwareConfig.screenDestinations` from edits that remove a destination the master has cabled/on air.

**F1.4 [major] A follower restart (or role change) with an unsent edit loses the merge base; the edit is kept only as a file.**
`pending`, `local`, `proposing` are in-memory (SS:54-58); `held` persists only its meta, `held.show` is null after restart
(SS:50, `heldShow()` SS:102). After restart `onPush` sees `m.hash !== held.hash` -> `diverged` backup -> overwrite (SS:275-283).
Scenario: master unreachable (the IP-change incident) -> follower operator edits for 20 min -> follower service restarts
(update, crash) -> link returns -> master's push replaces the follower show; 20 min of work sits in `_cluster/*.diverged-*.json`
and the only surface is a log line (`view()` exposes `before_share` but NOT `diverged`, SS:319-322; `diverged` is written to the
store at SS:278 and never read).
Test coverage: "a follower restarts" (gates test) only covers the no-edit case.
Fix: persist `held.show` (or its hash+ops chain) and `pending` (base hash, base show or ops) in the store; on restart rebuild
`local`; expose `diverged` in `view()` and in the Devices card.

**F1.5 [major] The same loss without a restart: "master unreachable -> auto-failover -> old master returns".**
This box (A) master epoch 9; B fails over to master (epoch 10) after 12 s of not seeing A. A kept editing meanwhile. A returns,
pulls the higher claim, steps down. B (new master) now pushes ITS show; A's un-pushed edits are replaced (A is `!held` or
`m.hash !== held.hash`), kept as a `diverged` file only. The data that wins is whichever box the failover picked, regardless of
which box the operator was working on. Tested as intended behaviour (G4 test), but with auto failover at 12 s on DHCP-fragile
links this is the normal path, not the exception, and the surface for the file is a log line.
Fix: on step-down with `m.hash !== held.hash` do not overwrite silently: propose the divergence to the new master as a normal
`show.propose` with base = the last hash both held (needs `history` of the common base kept; see F1.7) so it MERGES instead of
being replaced; only fall back to a file when no base is known. Also surface `diverged` in the UI.

**F1.6 [minor] `pending` survives a promotion to master and is never cleared.**
`tick()` for a master only calls `pushAll()` (SS:302); `pending`/`proposing` set while it was a follower stay. If it later
becomes follower again (second flip), `propose()` sends a stale base: the new master does not hold it -> `base_unknown` 409
(no `epoch` in the body) -> the "refused" branch (SS:222-233): backs up the "lost" edit and `commit(heldShow())` rolls the box
back to an OLD held show (`held` from the first follower stint) until the next push. Needs flapping twice inside one
unsent-edit window, which is exactly today's pattern. (unconfirmed.)
Fix: clear `pending/local` when `isMaster()` becomes true; treat `base_unknown` as "re-send as full proposal against the
master's pushed hash", not as a refusal.

**F1.7 [minor] New master has no merge history for the pre-flip base.**
`history` (SS:55) only gets hashes this box pushed/merged; `onPropose` needs `history.get(args.base)` (SS:186). A follower that
becomes master has never `remember`ed the show it held as follower (`held.show`), unless `tick -> pushAll` ran before the first
proposal arrives. If a proposer's base is the pre-flip show and the new master has already edited once, answer = 409
`base_unknown` -> refused branch -> the proposer's edit becomes a file and its box reverts (SS:222-233).
Fix: `remember(held.hash, heldShow())` on promotion; on `base_unknown` fall back to a 2-way merge by item.

**F1.8 [minor] `diverged` backups and `before_share` are never rotated and are only surfaced through logs/one field**
(CTX:36-44). Flapping with different shows writes a new file per swap of ownership (SS:275). Cap or prune; show the list.

**F1.9 [minor] `applying` window.** `commit` sets `applying = !own` around an awaited persist (SS:79-86). A local edit that lands in
that window is invisible to `written()`; it is picked up only when `m.hash !== local.hash` is compared at the next
`written()/prime()`. Probably benign because `commitShow` is synchronous; unconfirmed.

### What is device-local vs shared (verified against live project)
- Device-local (stripped both ends): `hardwareConfig.{osDisplay, casparServer, gpuPhysicalTopology, fingerprint, deviceGraph,
  audioRouting, streamingChannel, dmx, recordOutputs, streamOutputs, audioOutputs, rtmp}` (config-classify.js:86-101,
  SHOW_ROUTING_HARDWARE_SLICES), top-level `streaming`, `rev/savedAt/slug/_*`.
- SHARED: `hardwareConfig.screenDestinations` (whole list, incl. per-destination `mainScreenIndex`, `videoMode`, `stream.{type,source,url,key}`),
  `multiviewLayout`, `channelScheme`, `programOutput`, `multiview`, `fixtures`, `pixelMappingProposal`, `previs`, `operatorCompose`, scenes, timelines.
- Stream/record targets: `streaming`, `streamOutputs`, `recordOutputs`, `rtmp` are local (G9). But each destination also
  carries `stream: { url, key }` inside the shared `screenDestinations`. Live values are empty here (credentials get
  migrated out of the project by `applyStreamCredentialMigration` in persistProject before the mirror is written), so the
  key does not travel today. It depends on that migration having run on the sender first. (unconfirmed for the push path:
  `mine()` reads `persistence.get('web_project')` which is the post-migration copy, CTX:72-75, so probably safe.)
  Suggest asserting it in a test (see section 5).
- Media files are not part of the show; they move only on the "Send media" button (cluster-media.js, WO-670 answer 3). A taken show can reference media the follower
  does not have: black PGM, no error on the show card. WO-772 added a re-sync of the fan-out after a media send, not a missing-media warning.

### Gap against the owner's target model
**G1.A [blocker for "role distribution", major for backup] Destinations are one cluster-wide list.**
`screenDestinations` is shared and applied to the follower's live config on every take (CTX:27-30). "One box drives the LED
wall, the other streams/records" has to be expressed as the same destination list plus different cables (deviceGraph is local).
Consequences: a follower operator cannot own a destination of its own (it is proposed to the master and appears on the
master); deleting a destination on either box deletes it on both; a follower's destination `mainScreenIndex` (an OS output
number on THAT box) is overwritten by the master's value. This contradicts target items 1, 2 and 7 of the BRIEF.
Fix: give each destination an `owner` (device-key fingerprint) in the show; `showOf`/`intoProject` keep destinations owned by
the local box from the local config and take only foreign-owned ones as read-only "remote destinations" (the fanout
already has `remote-destination.js` for this).

**G1.B [major] Show sharing is a per-box toggle unrelated to link kind** (SS:58, RC `/api/cluster/show`). In the target model,
sharing is a property of the LINK (master/follower => on, peers => per-project or off). A box with it on and a master with it
off silently diverge (G1 test covers the refusal, not the UI).

---------------------------------------------------------------------------------------------------------------------

## 2. Duties and senders

Resolution (DUT:70-77, SND:49-60): each box computes every duty alone from its own idea of who is online and who is
master. Nothing is negotiated; the only shared state is the explicit sender choice (`{by, at}` per kind, last-write-wins
on wall-clock `at`, SND:85-95, synced by `cluster.senders`, RC:113-122).

- tracking/zones/auto/presenters: `zones=auto=presenters = tracking-here OR no ONLINE peer tracks` (DUT:71).
- lighting/ptz: explicit `by` (even if offline) -> else single tracker -> else master -> else lowest fp (SND:53-60).
- artnet_in: every server unless chosen (SND:55).

**F2.1 [major] Both boxes do lighting/PTZ when reachability is asymmetric (today's exact failure).**
`all = [self, ...peers.filter(online)]` (SND:56). A can see B, B cannot see A (A on the new DHCP address). B: `all.length===1`
-> B does lighting (SND:56 `return out(self,true)`). A: both online, master = whichever claim A holds -> may also be A.
Two Art-Net/PSN sources for the same fixtures, two VISCA senders to the same cameras, until the claim settles. Auto zones/auto
director also run on both (DUT:71 same logic). There is no tie-break that survives asymmetric views.
Fix: make the Auto choice depend on the signed claim only (master, else tracker), never on "alone in my view"; when the claim
holder is unreachable, keep doing nothing different for a grace period (>= FAILOVER_MS) rather than switch instantly to self.

**F2.2 [major] No hysteresis: Auto lighting/PTZ follows the master claim, so claim flapping flaps DMX/PTZ ownership.**
With no tracker, Auto = master (SND:59). Each epoch change moves `here` for lighting/ptz, `duties.refresh()` notifies
subscribers (DUT:79-92) and the follow engine starts/stops sending. During the incident that is a switch every few seconds
(sACN/Art-Net priority fights, PTZ preset jumps).
Fix: resolve Auto on a debounced master (e.g. unchanged for 30 s) or prefer "lowest fp" (stable) unless a tracker exists;
do not tie lighting/PTZ to the master at all by default (master = who takes PGM, a different concern).

**F2.3 [major] Neither box has the duty when the chosen sender is offline.**
SND:53 returns the explicit server "even while it is offline (an explicit choice never silently doubles)". Intentional, but
combined with F2.1 the failure mode is asymmetrical: explicit choice of the box that rebooted -> lighting off on the survivor
until an operator re-picks; there is no "backup sender" setting. For a hot-backup link this defeats the point.
Fix: `{ by, backup: 'auto'|'none' }`; with backup auto, a chosen server unseen for FAILOVER_MS yields to Auto.

**F2.4 [minor] Sender choice is last-write-wins by wall clock `at` (SND:85, 95).** Boxes without NTP on a shop network can have
skewed clocks; an operator choice made on the box that is behind loses silently against an older choice from the box that is ahead,
if the first box was offline when the other set (never merged). The `Math.max(now, at+1)` guard only helps after a merge.
Fix: use a (counter, fingerprint) Lamport pair instead of a timestamp.

**F2.5 [minor] Exchange topics can both be unwanted/unsent.** `tracking.auto` goes only to peers whose last PING says
`auto:false` (wants, exchange.js:29-31), `air` only to peers with `zones:true`. Duties in a peer's ping are up to one poll
(5 s) old and only for ONLINE peers; both are fine individually, but under asymmetric reachability (F2.1) a box that thinks it is
alone starts Auto itself while the other still sends it the overlay; the receiver refuses with 409 "this server does auto
itself" (exchange.js:34) every 5 s and logs once. Harmless, noisy. (Heartbeat/expiry logic itself is sound: EXPIRE 15 s,
`drop()` on unlink.)

**F2.6 [minor] `accept_remote` is a single device-local boolean (DUT:49).** Not a flap problem, but it is the only thing that
makes a follower's `show.propose` fail the right way (G6). A flip does not change it; a box with accept_remote=false that
becomes master refuses every follower edit, and the follower's "refused" branch backs the edit up and reverts (SS:222-233)
- the operator sees a revert, not "master does not accept remote edits".

Gap vs target model: duties are resolved per capability, not per link kind; "peers" would need duties to be NEGOTIATED per
operator (explicit sender per kind, no master default) and "master/follower role distribution" would need duties assigned
by the master and pushed (a single source of truth), not recomputed.

---------------------------------------------------------------------------------------------------------------------

## 3. cluster vs replication (old pair)

### Where both can be active
`replication.enabled` (device-local config, defaults false, defaults-replication.js:6) is checked in exactly four cluster places:
SS:58 `on()` (G2, shared show off), RC:165 fan-out `pairEnabled`, RC:195 `followsMaster`, cluster-fanout.js:149.
It is NOT checked by: master election/failover (cluster-master.js), duties/senders/exchange, `send-media`, `/api/cluster/call`
actions. So with the pair on and the two boxes also linked:
- Two "master/leader" notions. Pair role = `role-state.js` `leader|follower` (auto: leader if >=1 operator WS client,
  `_recompute`). Cluster = signed claim. The UI shows a cluster master while PGM blocking is decided by the pair role
  (`amcp-fanout.js:230` `isAmcpFanoutReceiveBox(ctx) || isClusterFollower()`).
- `followsMaster` returns false while the pair is on (RC:195) but `masterOf().view().is_master` still says master; lighting/PTZ
  Auto still resolve to that claim (SND:59) which can be the pair's FOLLOWER box.
- Two epochs: pair `leaderEpoch` and cluster `epoch`, two failover timers, two ssh keys paths (cluster-media.js reuses
  `ensureReplicationSshKey` / the same forced-command rsync as the pair; the file comment says "the hot-backup pairing is not used"
  but the authorized_keys line and `replication-ssh-setup` are the same, so unlinking one side does not remove the other's access).
- Two project-sync paths: pair `receiveProjectFromPeer` (replicate-projects.js:~100-125) merges with `mergeSharedProjectIntoLocal`
  and, on slug change, regenerates Caspar (`regenerateFollowerCasparFromDeviceView`); cluster `commitShow` explicitly never
  touches Caspar (G10). Same project JSON, opposite policies; guard is the single `replication.enabled` flag. Another path,
  exFAT/USB, uses `leaderOwnsActiveShow` (replication-show-authority.js:38-47) which ignores the cluster entirely: a cluster
  master is treated as "not leader" and may take stick show data. (unconfirmed)
- `followerMode` is read only inside replication (`mirror-apply.js`, `amcp-fanout.js:93`); a cluster follower has no equivalent
  ("armed", "mirror"), which is the actual product difference: the pair mirrors live state (playhead sync, tombstones, parity gates),
  the cluster forwards takes per destination and replays the journal on reconnect (WO-933).

### Is the old pair still reachable?
Yes: `routes-replication-post.js` (connect/pair, `/api/replication/project`, tombstone, timelines), `connect-pair.js`,
`replication-service.js` all load and `replication-ui-notify` is called from the project paths. Default off, and the pair can
only be switched on from the Replication UI. Nothing in the cluster link UI warns when the other box is already a pair peer.

### Should "hot backup" be a mode of the cluster link?
Yes. WO-772 already did it by hand: ".4 as this box's hot backup (cluster link + shared show + cabled PGM/PRV 1)" and says the
cluster "is the one WO-670 built to replace / extend the pair". Remaining pair-only features worth carrying:
(1) live playhead/timeline sync (playhead-sync.js, correction), (2) deleted-project tombstones, (3) media parity status/auto-sync
(syncthing/rsync, `project-media-parity.js`), (4) `armed` vs `mirror` follower mode, (5) manual promote/hand-back.
Suggested shape: link has `kind: 'master_follower' | 'peers'` and, for master_follower, `mode: 'backup' | 'roles'`:
- backup: all destinations cabled on both; show sharing ON; fan-out ON; duties = master does everything; follower is warm.
- roles: destinations carry `owner`; show shared (without owned destinations); fan-out only for destinations cabled on both; duties assigned.
Retire `replication.enabled` into `link.mode='backup'`, migrate existing pairs, delete the G2 mutual-exclusion code once the
pair is gone, keep the pair routes returning 410 for a release. Until then, add an explicit guard: refuse to LINK two boxes
(or refuse `/api/cluster/master/set`) while `replication.enabled`, and vice versa, with one message.

---------------------------------------------------------------------------------------------------------------------

## 4. What a "peers" link needs from the shared-show layer vs master/follower

Today everything is hard-wired to "one active project, one writer":
- `mine()`/`current()` read the box's active project (CTX:72-75); `held`, `local`, `pending`, hash cache, `peerState` are single-valued.
- `written()` branches on `isMaster()`/`follower()` (SS:124-132) and `follower()` needs `claim.epoch` (SS:59). No claim = no sharing.
- `commit` (CTX:21) switches the box's active slug and live destinations (F1.1).
- Every conflict has a loser by definition ("the master's version stays"), epoch G4 fences everything.

For peers (two operators, each with own show focus) the layer would need:
1. Per-project sync state keyed by slug/identity: `held[slug]`, `peerState[peer][slug]`, `history[slug]`, instead of one global.
   Sync the project LIBRARY (all projects) with a manifest exchange; the active project becomes a local `focus`, broadcast but not
   forced. `persistProject(..., { activate:false })` already exists for writing a non-active slug (project-scenes.js:~306).
2. Symmetric merge: both sides can propose to each other; a deterministic loser (lower fp keeps its version, or per-field
   last-writer by (counter,fp)) instead of "the master". show-merge.js (diff/apply/merge3) and `history` are reusable as is.
3. No epoch fence for data: epoch fences a single writer. Peers need base-hash fences (reject when the receiver's hash != base).
4. Ownership of hardware-facing parts: destinations/streams owned by one peer (G1.A), shared looks reference them by id.
5. A per-project edit lock or "who is editing" presence (WS) to make simultaneous edits of the SAME show a visible choice.
6. The sharing switch becomes per-link (plus per-project opt-out), not per-box.
7. Takes: no cluster fan-out of PGM between peers (cluster-fanout is master-only); each peer keeps local PGM, and a peer may be
   ASKED to take on a destination it owns (the signed `look.take` action already exists; a follower relays takes to the master,
   cluster-call-actions.js, which is the wrong direction for peers - for peers the take goes to the destination's OWNER).
8. Duties: explicit per-kind sender, no master default (section 2).

Reusable as is: show-merge.js, signed call transport, `showOf/intoProject` stripping, backups, `drop()` on unlink.
Needs rewrite: shared-show.js control flow (written/propose/onPush/tick/prime), the single `held` state and the commit target.

---------------------------------------------------------------------------------------------------------------------

## 5. Test gaps (concrete missing cases)

Existing: show-merge (9), shared-show gates (G1-G8 incl. split network, replay, restart-no-edit, master restart), e2e on three
sandbox servers, duties from config. Missing:
1. Flapping master: claim epochs e, e+1, e+2 within <30 s with each box holding a different show; assert the open show of each
   box does not change without confirmation (F1.1) and that exactly N backups are written.
2. Asymmetric reachability: A sees B, B does not see A (the incident). Assert show, duties (lighting/ptz/auto) and fan-out each
   have exactly one owner (F2.1), and that no push/propose crosses an epoch.
3. Same-name collision: follower has a stored but not open `new_project_1`, master pushes a show with that name; assert a backup of
   the overwritten file (F1.2).
4. Follower New project / Load / delete: assert it is not applied to the master's open show or live destinations (F1.3).
5. Follower restart WITH an unsent edit while master unreachable; then master returns: edit merged, not replaced (F1.4).
6. Old master returns after failover having edited alone; assert merge/propose, not overwrite, and that `diverged` is visible in `view()` (F1.5).
7. Two flips with a pending edit (follower -> master -> follower): no revert to the old held show (F1.6/F1.7).
8. Master edits once between promotion and the first propose (history lacks the base): proposal still merges (F1.7).
9. Stream-key leak: project whose destination has `stream.key` set at sender time but not yet migrated; assert nothing with a key is in `show.push`.
10. Media-missing take: pushed show references files absent on the follower; assert a visible warning (no test now).
11. Pair vs cluster: both enabled on linked boxes; assert election/failover/duties/send-media are refused or inert, and that the
    pair's role and the cluster's master cannot both block PGM (`shouldFollowerSkipLocalPgmAmcp`).
12. Senders: explicit chosen server goes offline for > FAILOVER_MS (neither does it today); two skewed clocks; sender choice made
    while the peer was offline and merged on return; claim flap does not toggle `duties.has('lighting')` more than once.
13. Duties under partition: both halves compute `zones/auto/presenters`; reconnection with both tracking; `air` exchange when
    neither/both have `zones`.
14. `accept_remote=false` on the new master after a flip: follower gets a clear refusal message, not a revert (F2.6).
15. IP change: peer saved by IP, same identity at a new address; show/duties/senders peers map keyed by hostname id keep
    working (shared state keys on `p.id`/fingerprint, not host, but the poll that drives them uses `host:port` only).
16. Large show: 6.7 MB push timeout (FULL_TIMEOUT_MS 30 s) with a flaky link; busy flag release; no lost heartbeat.

---------------------------------------------------------------------------------------------------------------------

## Summary table

| id | where | sev | kind |
|----|-------|-----|------|
| F1.1 | SS:255-290, CTX:21,76 | major | bug: flip swaps follower's open show/destinations |
| F1.2 | SS:275-281 | major | bug: backup of the wrong file, same-name project overwritten |
| F1.3 | SS:124, 177-206 | major | bug (unconfirmed run): follower New/Load rewrites master (WO-751 again) |
| F1.4 | SS:50-58, 102, 319 | major | bug: unsent edit lost on restart; `diverged` invisible |
| F1.5 | SS:275-283 | major | design: failover winner overwrites returning master's work |
| F1.6/F1.7 | SS:209-233, 186 | minor | bug: stale pending / no history on promotion |
| G1.A | CTX:27-30, config-classify | blocker for roles mode | gap: destinations are one shared list |
| G1.B | SS:58 | major | gap: sharing is per box, not per link |
| F2.1 | SND:53-60, DUT:71 | major | bug: duty doubled under asymmetric reachability |
| F2.2 | SND:59 | major | bug: Auto lighting/PTZ flaps with the claim |
| F2.3 | SND:53 | major | gap: chosen sender offline = nobody |
| F2.4-F2.6 | SND:85, exchange, DUT:49 | minor | |
| section 3 | guards in 4 places only | major | pair and cluster contradict; fold hot backup into link |

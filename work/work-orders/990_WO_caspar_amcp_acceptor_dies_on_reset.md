# WO-990 — Caspar's AMCP acceptor dies when a client resets the connection immediately (a port scan locks out new clients)
**Area:** caspar-build, amcp
**Status: DONE (07.11.26, repro kills AMCP on the old binary; on 379d81917 200 connect+RST and an nmap scan leave VERSION answering with 0 log errors on both boxes)**

## Investigation

**Incident (07.11, my doing).** To find the second box for WO-979 I ran `nmap -Pn --open -p 4200,5250 -T4` over
192.168.0.0/24 and 10.0.0.0/24 at 09:57. nmap ran without root, so it did connect scans: open, then reset at once.
Effects:

- `log/caspar_2026-11-07.log:16818` (09:57:29.185): `Exception: … basic_socket::remote_endpoint … remote_endpoint:
  Transport endpoint is not connected [system:107]`.
- From then on Caspar accepted **no new AMCP connections**. `ss -ltn` showed the :5250 listen backlog filling
  (Recv-Q 6, then 7, then 9) with never-answered connects, and `VERSION` from a new socket got no reply.
- The node server kept working through its **old** connection (127.0.0.1:52524 ESTAB), so nothing showed until I
  restarted node for WO-989 at 10:08. Then `Caspar TCP: Time out` and `AMCP response timeout: VERSION`: the box had
  no Caspar control.
- Recovered with `sudo systemctl restart casparcg-server.service` (allow-listed). AMCP answered after 3 s
  (`201 VERSION OK 2.5.1 deac375bb`). Then a node restart; PRV came back and the GUI reconnected.
- **highascg5867 (192.168.0.10) was scanned too.** A raw `VERSION` to 192.168.0.10:5250 at ~10:05 connected and got
  no reply: the same state. Its node still drives its Caspar over the old connection; its **next node restart will
  lose Caspar** until that Caspar restarts. Restarted 07.11 ~12:04 with the owner's go (`sudo systemctl restart casparcg-server` over SSH); its listen queue went back to 0 and `VERSION` answered after 12 s.

**Root cause** (`~/caspar-build/src-v2`, upstream 2.5.1 code, HEAD deac375bb):

- `src/protocol/util/AsyncEventServer.cpp:318-339` `handle_accept`: on success it calls `connection::create(…)`.
- The constructor logs `"Accepted connection from " << ipv4_address()` (`:211`).
- `ipv4_address()` (`:137-140`) calls the **throwing** `socket_->remote_endpoint()`. A peer that already sent RST has
  no remote endpoint, so it throws `system_error` (ENOTCONN).
- The exception leaves `handle_accept` before `start_accept()` (`:338`), so no new `async_accept` is ever queued. The
  io_context thread logs the exception and carries on, and the acceptor is dead for the life of the process.
- `local_endpoint()` in the constructor (`:206`, `listen_port_`) and `address()` (`:135`) use the throwing overloads
  too.

## What was done

The owner (07.11) said the HighAsCG Caspar build has essential additions that every build must carry, with no clean
branch: find what's there and add to it. So:

- **Kept the build branch and committed what was only in the worktree.** The `src-v2` worktree held the WO-800
  (per-layer audio meters) and WO-820 (native NotchLC) changes uncommitted. They are identical to
  `caspar/patches/wo800…`/`wo820…`: both reverse-apply cleanly. The deployed binary (md5 ab668967) was built from
  them. Now committed as `d6519d5d3` and `dd7862fba`. The branch was renamed `wo742-shm-producer` → **`highascg-main`**,
  so its name says what it is.
- **`cd177d369`** `src/protocol/util/AsyncEventServer.cpp`:
  - `address()`, `ipv4_address()` and the constructor's listen port use the `error_code` overloads (new
    `local_port()` helper).
  - `handle_accept` first checks `remote_endpoint(ec)`. A peer that is already gone is closed and logged at debug,
    and the accept is re-armed.
  - The per-connection setup is wrapped in try/catch, which closes the socket. `start_accept()` always runs, except
    on `operation_aborted` and when the acceptor is closed.
- **`379d81917`** passes the address read at accept time to the lifecycle factories (OSC subscription by peer).
  - Why: 5867 still logged one caught `make_address_v4: Invalid argument` after `cd177d369`. A remote peer reset
    between the check and the OSC factory, so `ipv4_address()` had become `no-address` by then.
- **`caspar/README.md`** (new) records the build itself:
  - the branch, build, deploy and distribution rules (`bin/` is ignored, ISOs clone it, peers get a copy);
  - a table of everything the build carries beyond v2.5.1, by commit and WO.
- **`caspar/patches/wo990-amcp-accept-loop-survives-reset.patch`**: both commits as `format-patch`.

Why the server-side fix and not just a "never scan" rule: any LAN scanner, flapping client or health check that
connects and drops took AMCP away until a restart, and nothing showed until node reconnected.

## What was VERIFIED

- **Repro on the old binary (this box, 12:36):**
  - `scratchpad/amcp-reset-repro.py 127.0.0.1 5` (SO_LINGER 0 connect+close ×5): `before: 201 VERSION OK` →
    `after: NO REPLY (timeout)`.
  - `ss -ltn` :5250 Recv-Q 5; log `remote_endpoint: Transport endpoint is not connected`.
  - The root cause is proven, not just matched by timestamp.
- **First fixed build `cd177d369`:** 50 resets → `201`, Recv-Q 0. The log showed caught `make_address_v4` backtraces,
  which led to the remote_endpoint pre-check.
- **`379d81917` (built with `build-26.sh`, md5 a8ffaf14), deployed to both boxes** (rollback `bin/casparcg.pre-wo990`
  on each; `casparcg.prev` kept):
  - 200 connect+RST against 127.0.0.1 and 200 against 192.168.0.10 → both `201 VERSION OK 2.5.1 379d81917`;
    **0 `[error]` lines** in either Caspar log since the swap.
  - `nmap -Pn -p 5250` of both boxes (the 07.11 trigger) → both still answer `VERSION`.
- **This box after the swaps:**
  - node reconnected, PRV ch3 layer 10 = ffmpeg (the neon loop, as found);
  - `:0` screenshot: GUI on Live with the PRV thumbnail playing.
- **highascg5867:** node active, GUI pid alive.
  - Caspar PGM/PRV are empty, as found: the last `CLEAR 3-10/11` was 05.11 13:09.
  - Its node still lists ch3 = "zz_loopcode (copy 2)" from before that. Stale server state, not caused here.

## Notes

- Worth upstreaming (CasparCG/server `AsyncEventServer.cpp` is unchanged on master in this area).
- The memory rule "never scan :5250" stays as manners, but it no longer takes AMCP down.

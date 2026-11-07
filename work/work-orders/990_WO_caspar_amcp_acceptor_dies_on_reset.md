# WO-990 — Caspar's AMCP acceptor dies when a client resets the connection immediately (a port scan locks out new clients)
**Area:** caspar-build, amcp
**Status: OPEN (root cause in source, fix written below; needs a Caspar rebuild + swap; both boxes hit 07.11)**

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
  lose Caspar** until that Caspar restarts. Not touched (owner's call, see below).

**Root cause** (`~/caspar-build/src-v2`, upstream 2.5.1 code, HEAD deac375bb):

- `src/protocol/util/AsyncEventServer.cpp:318-339` `handle_accept`: on success it calls `connection::create(…)`.
- The constructor logs `"Accepted connection from " << ipv4_address()` (`:211`).
- `ipv4_address()` (`:137-140`) calls the **throwing** `socket_->remote_endpoint()`. A peer that already sent RST has
  no remote endpoint, so it throws `system_error` (ENOTCONN).
- The exception leaves `handle_accept` before `start_accept()` (`:338`), so no new `async_accept` is ever queued. The
  io_context thread logs the exception and carries on, and the acceptor is dead for the life of the process.
- `local_endpoint()` in the constructor (`:206`, `listen_port_`) and `address()` (`:135`) use the throwing overloads
  too.

## Proposed fix (not built)

Use the non-throwing overloads, and keep the accept loop alive whatever a single connection does:

```cpp
std::wstring ipv4_address() const
{
    boost::system::error_code ec;
    auto ep = socket_->remote_endpoint(ec);
    return ec ? L"no-address" : u16(ep.address().to_string());
}
// listen_port_: same with local_endpoint(ec) → L"no-port"; address(): local_endpoint(ec).
void handle_accept(…)
{
    if (!acceptor_.is_open()) return;
    if (!error) {
        try { /* existing body */ }
        catch (...) { CASPAR_LOG_CURRENT_EXCEPTION(); }
    }
    start_accept();
}
```

**Why it isn't built yet:** the `src-v2` worktree has uncommitted changes from other work (screen slices: mixer,
stage, image_mixer). Building there now would ship those too. The patch belongs on a clean branch off the deployed
`deac375bb`, then build-v2, swap per the caspar-build-v2 procedure (cp `.new`, `mv -f`, `RESTART`, node restart),
keeping `casparcg.prev`. It is worth upstreaming: any LAN scanner or a flapping client takes AMCP away.

**Repro to verify the fix** (not run on purpose yet; the 07.11 link to the scan is the timestamp match plus the code path. Dev box only; it kills AMCP on an unfixed build): open and reset a socket against
:5250 (`python3 -c 'import socket,struct;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack("ii",1,0));s.connect(("127.0.0.1",5250));s.close()'`),
then a fresh `VERSION` must still get `201`.

## Mitigation until then

- Never port-scan the shop LAN's :5250 (memory rule added). Find HighAsCG servers on :4200 only (node handles
  resets fine), or use `/api/replication/ping`.
- highascg5867: restart its Caspar once (its own GUI, or `POST http://192.168.0.10:4200/api/restart`, AMCP RESTART
  over the connection that still works). Owner's go needed: that box shows a `visuals` shm feed on its PGM.

# RC game §2.6 — wiring the live lights and LED wall pictures (for the lead)

Contract: `work/notes/rc-game-contract.md` "2.6". Built as new files only; nothing below is wired yet.

| File | Role |
|---|---|
| `src/game/rc-lights-fk.js` | the previs forward kinematics (pure) |
| `src/game/rc-lights.js` | `createRcLights`, `rcLightsDeps`, `withLiveScene` — the static `lights` list + the 10 Hz `lxfull` / `lx` producer |
| `src/game/rc-video.js` | `createRcVideo`, `rcVideoDeps`, `screensFrom` — the `screens` list + JPEG fan-out through the existing video feed |
| `game/rc/stage-fx.js` (+ `stage-fx-math.js`, `stage-fx-beams.js`, `stage-fx-wall.js`) | the client: beams / pools / glows (3 InstancedMeshes) and the wall pictures |
| `tools/smoke/smoke-wo1074-rc-live-{lights,video,client}.test.js` | 11 + 8 + 9 tests (add them to `tools/ci/offline-test-files.js`) |

Every snippet uses `?.` so `createRcGame()` built by the smokes without a ctx keeps working (no lights, no video).

## Server — `src/game/rc-sanitize.js`

```js
const TYPES = new Set(['join', 'ready', 's', 'ping', 'video'])   // + 'video'
```

## Server — `src/game/rc-game.js`

1. Imports (top):
```js
const { createRcLights, rcLightsDeps, withLiveScene } = require('./rc-lights')
const { createRcVideo, rcVideoDeps } = require('./rc-video')
```
2. Inside `createRcGame`, **after `sendTo` is defined** (lights send through it: one message object per broadcast, so
   the existing WeakMap stringifies it once):
```js
	const videoDeps = deps.ctx ? rcVideoDeps(deps.ctx, { log }) : null
	const lights = deps.lights || (deps.ctx ? createRcLights(rcLightsDeps(deps.ctx, { send: sendTo, log })) : null)
	const video = deps.video || (videoDeps ? createRcVideo(videoDeps) : null)
```
   Creating them costs nothing: no timer, no feed client, no lease until a socket attaches / asks.
3. `decorate` — the state fields (welcome + every `state` broadcast + GET /state):
```js
	const decorate = (s) => ({ enabled: true, ...s, joinUrls: joinUrls(), sceneRev: lastRev,
		lights: lights ? lights.isOn() : false, wall: video ? video.isOn() : false })
```
4. `disable()` — next to `room.dispose()`:
```js
		lights?.stop()
		video?.stop()   // closes the feed client (its worker stops if nobody else watches) and releases the lease
```
5. `host(a)` — the switches. Replace the final `else { … }` branch with:
```js
	else {
		if (action === 'lights' || action === 'wall') {
			if (typeof a.on !== 'boolean') return { status: 400, body: { ok: false, error: '`on` must be true or false', state: state() } }
			;(action === 'lights' ? lights : video)?.setOn(a.on)
		}
		const r = room.host(action, a)
		if (!r.ok) return { status: r.status || 400, body: { ok: false, error: r.error, state: state() } }
	}
```
   …and in `src/game/rc-room.js` `host()` add two cases so the room broadcasts the new state (it has no public
   `broadcastState`):
```js
			case 'lights':
			case 'wall':
				break // flipped by the service (rc-game.js); only the state broadcast happens here
```
   `lights.setOn(false)` itself sends `{t:'lxfull', on:false, f:[]}` to every attached socket and stops its timer;
   `setOn(true)` sends a fresh `lxfull`. `video.setOn(false)` drops the feed client + lease; `true` re-subscribes the
   sockets that had asked.
6. `attach(ws)` — right after `room.connect(ws)`:
```js
		lights?.attach(ws)   // sends lxfull now (while on); the 10 Hz timer runs while ≥ 1 socket is attached
```
7. Message dispatch — in `ws.on('message')`, after `parseMessage`, before `room.handle`:
```js
			if (m.t === 'video') return video?.subscribe(ws, m.on === true)
```
8. Socket close — in `ws.on('close')`:
```js
			lights?.detach(ws)
			video?.detach(ws)
```
9. Scene JSON: give the service a way to hand out the live additions (the route does not see `lights`/`video`).
   Add to the returned object:
```js
		/** The baked scene + the live `lights` / `screens` (spliced into the cached text; the bake and its rev stay as they are). */
		sceneWithLive: () => refreshScene().then((out) => ({ ...out,
			text: withLiveScene(out.text, { lights: lights ? lights.list() : [], screens: videoDeps ? videoDeps.screens() : [] }) })),
```
   and in `refreshScene()` after `lastRev = out.rev` (walls may have moved / changed source): `video?.refresh()`.
10. `getRcGame(ctx)` — pass ctx: `createRcGame({ ctx, port: …, log: … })`.

## Server — `src/api/routes-rc-game.js`

In `sceneJson(game)`: `const out = await (game.sceneWithLive ? game.sceneWithLive() : game.scene())`. Nothing else;
the GLB route stays on `game.scene()`.

## Server — nothing else

- **Service start/stop:** none of their own. They live inside the game service; `disable()` stops both (step 4).
  Disabled = no sockets = no timers, no feed client, no lease.
- **Video feed:** `ctx._videoFeed.feed` (index.js) is read lazily on each subscribe. No edit is needed —
  `createRcVideo` adds ONE socket-shaped in-process client (`EventEmitter` + `readyState`/`bufferedAmount`/`send`).
  The feed's frames already use the game framing `[u8 n][role][JPEG]` and go out unchanged as one Buffer for all
  sockets, ≤ 8 / s per role, skipped for a socket with > 64 KB buffered (the game's JSON limit is 256 KB, so pictures
  never starve race messages).
- **Optional, a 1-line edit** (`src/system/video-feed.js` `addClient`): the feed encodes a role ONCE at the largest
  width any client asks. With a Godot GUI on a laptop watching `pgm1` at 960 px, the game gets 960 px JPEGs (≈ 4× the
  bytes; still ≤ 8 / s). To give the game its own 480 px encode:
```js
	function addClient(ws, query = {}, { relayFrom = null, tier = '' } = {}) {
		const c = { roles: new Set(), params: feedParams(query), tier: relayFrom ? RELAY_TIER : tier === 'game' ? 'game' : '' }
```
  `createRcVideo` already passes `{ tier: 'game' }`. The worker key becomes `pgm1~game` (generic; the relay tier works
  the same way). The cost is a second ffmpeg for that role while both are watched.
- **CSP:** no change. Frames arrive on the game socket (`connect-src 'self' ws: wss:`); `createImageBitmap(Blob)`
  needs no `img-src`; nothing else is fetched.

## What a lease does on the Caspar side (plainly)

`getVideoSurfaceManager(ctx).lease('rc-game', ['pgm1'])` → if that role has no consumer yet, ONE AMCP command
`ADD <channel> SHM NAME pgm1` on consumer index 741–748 (pgm/prv roles; `chN` / inputs higher). That is a
**read-only shared-memory consumer**: Caspar copies the channel's finished frames into `/dev/shm`, which the feed worker
reads and ffmpeg scales to JPEG. It changes nothing on any output, layer, look or mix. The lease is renewed every 5 s;
when the game releases it (last subscriber gone / walls off / game disabled) or stops renewing, the manager sends
`REMOVE <channel>-<index>` 15 s after the last lease (TTL 15000, swept every 2 s). If the Godot camera view or the
feed already leased the role, nothing new is sent to Caspar. On a Caspar without the shm module the ADD fails
harmlessly (logged) and the walls stay unlit. The raster for `uv` comes from the cached `ctx.gatheredInfo.infoConfig`;
no AMCP is issued for it.

## Client — `game/rc/protocol.js` `decode()`

`decode` drops unknown types, so add:
```js
		case 'lx':
		case 'lxfull':
			return Array.isArray(m.f) ? m : null
```

## Client — `game/rc/net.js`

1. In `_open()` right after `ws = new this.env.WebSocket(this.env.url)`: `ws.binaryType = 'arraybuffer'` (a Blob also
   works; `onBinary` handles both, ArrayBuffer is cheaper).
2. `ws.onmessage` — route binary BEFORE `decode` (which would `String()` it):
```js
		ws.onmessage = (ev) => (typeof ev.data === 'string' ? this._onMessage(ev.data) : this.env.onBinary?.(ev.data))
```

## Client — `game/rc/game.js`

1. Imports: `import * as THREE from 'three'` and `import { createStageFx } from './stage-fx.js'`.
2. Right after `G.world = createWorld(…)` (before `loadScene`; `lxfull` arrives as soon as the socket opens, and
   entries that arrive before their list are buffered):
```js
	G.fx = createStageFx({ THREE, scene: G.world.scene, quality, send: (m) => G.net?._sendRaw(m) ?? false })
	document.addEventListener('visibilitychange', () => G.fx?.setEnabled(!document.hidden)) // hidden tab: no pictures
	window.addEventListener('pagehide', () => G.fx?.dispose())
```
3. Scene load — in `loadScene(G)` after `G.scene = r.data`: `G.fx?.load(G.scene)`.
4. Quality toggle — in the `qBtn` handler after `G.world.setQuality(q)`: `G.fx?.setQuality(q)`.
5. Messages — first line of `onMessage(G, m)`: `if (G.fx?.onMessage(m)) return`. (It returns true only for `lx` /
   `lxfull`; for `welcome` / `state` it reads `state.lights` / `state.wall`, re-asks for pictures on a fresh socket,
   and returns false, so the switch below still runs.)
6. Binary — in the `RcNet` env: `onBinary: (d) => G.fx?.onBinary(d)`.
7. Per frame — in `game/rc/loop.js` `frame()`, before `G.world.render()`: `G.fx?.update(dt)`.

`setEnabled(false)` hides everything and sends `{t:'video', on:false}`; `true` asks again. `dispose()` also sends
`video` off. The client sends `video` only when its wish changes (enabled ∧ wall switch on ∧ the scene has screens), and
once again after every `welcome` (a new socket has no subscription).

Optional host UI (`game/rc/host.js`): two toggles posting `{action:'lights', on}` / `{action:'wall', on}`, showing
`state.lights` / `state.wall`.

## Deviations from the contract text (please accept or adjust the contract)

- **`lights[].p` is the head's tilt pivot, not the raw patch pose point.** For a hanging moving head the patch point is
  the yoke top; the beam starts lower, at the tilt axis (by the GDTF's yoke length). With the pivot, the beam from `p`
  along `d` passes ≤ 4 mm from the follow target (measured on three real GDTFs). With the pose point, it misses by
  about that offset. For a
  static head `p` is the mean beam origin.
- **`screens[].p` is the picture CENTRE.** A previs wall's `position` is its BOTTOM-centre (stage_builder.gd /
  mvr-export.js), so the server sends `position + R·(0, h/2, 0)`. The contract says "centre `position`".
- **Extra fields:** `screens[].cols` (column count, for curved walls). `lxfull` also carries `on`, `rev` and
  `lights` (the patch can change while the scene JSON stays cached; the client takes the newer list).
- **Known limit:** for a wall with a negative curve, the picture's ends can sit behind the bake's flat body face.
  Positive and flat walls are correct.

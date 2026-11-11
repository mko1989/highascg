extends RefCounted
## WO-1039 — Audio sub-tab model (pure): the routing matrix of the switcher, as Studio's lib/studio-audio.js reads and
## writes it. State = {supported, inputs, outputs, routes}: a channel is {key, interfaceId, channel, type, kind, port,
## name, mute, tone, signal}; routes maps an output key → the input key feeding it (or null). One input per output.
## Bodies: {routes:[{output, input|null}]}, {clear:true}, {channels:[{key, type, mute|tone}]}.


static func supported(state: Dictionary) -> bool:
	return state.get("supported") == true


## Channels of one port in a row (the matrix headers are port groups).
static func group_by_port(channels: Array) -> Array:
	var groups: Array = []
	for c in channels:
		if not c is Dictionary:
			continue
		var last: Dictionary = groups.back() if not groups.is_empty() else {}
		if not last.is_empty() and last.get("id") == c.get("interfaceId"):
			(last["channels"] as Array).append(c)
		else:
			groups.append({"id": c.get("interfaceId"), "port": str(c.get("port", "")), "kind": str(c.get("kind", "")), "channels": [c]})
	return groups


static func routes_of(state: Dictionary) -> Dictionary:
	var r: Variant = state.get("routes", {})
	return r if r is Dictionary else {}


static func routed_count(state: Dictionary) -> int:
	var n := 0
	for k in routes_of(state):
		if routes_of(state)[k] != null and str(routes_of(state)[k]) != "":
			n += 1
	return n


static func summary(state: Dictionary) -> String:
	return "%d in · %d out · %d routed" % [(state.get("inputs", []) as Array).size(), (state.get("outputs", []) as Array).size(), routed_count(state)]


static func is_routed(state: Dictionary, output_key: String, input_key: String) -> bool:
	return routes_of(state).get(output_key) == input_key


static func _same_port(channels: Array, interface_id: Variant) -> Array:
	var out: Array = []
	for c in channels:
		if c is Dictionary and c.get("interfaceId") == interface_id:
			out.append(c)
	return out


## Pair on: every channel of the input port goes to the same-numbered channel of the output port (Studio pairRoutes).
## `enable` false removes only the crosspoints that currently exist.
static func pair_routes(state: Dictionary, input: Dictionary, output: Dictionary, enable: bool) -> Array:
	var ins := _same_port(state.get("inputs", []), input.get("interfaceId"))
	var outs := _same_port(state.get("outputs", []), output.get("interfaceId"))
	var routes := routes_of(state)
	var result: Array = []
	for o in outs:
		var match_in: Dictionary = {}
		for i in ins:
			if i.get("channel") == o.get("channel"):
				match_in = i
				break
		if match_in.is_empty():
			continue
		if not enable and routes.get(o.get("key")) != match_in.get("key"):
			continue
		result.append({"output": o.get("key"), "input": match_in.get("key") if enable else null})
	return result


## The routes one click sends: pairing (unless Alt) or just this crosspoint; falls back to the single one.
static func click_routes(state: Dictionary, input: Dictionary, output: Dictionary, pair: bool, alt: bool) -> Array:
	var active := is_routed(state, str(output.get("key")), str(input.get("key")))
	var single: Array = [{"output": output.get("key"), "input": null if active else input.get("key")}]
	if pair and not alt:
		var routes := pair_routes(state, input, output, not active)
		if not routes.is_empty():
			return routes
	return single


static func routes_body(routes: Array) -> Dictionary:
	return {"routes": routes}


static func clear_body() -> Dictionary:
	return {"clear": true}


## `flag` = "mute" | "tone": flip one channel.
static func flag_body(channel: Dictionary, flag: String) -> Dictionary:
	return {"channels": [{"key": channel.get("key"), "type": channel.get("type"), flag: 0 if int(channel.get(flag, 0)) != 0 else 1}]}


## A port's M / T: all on unless all already on.
static func port_flag_body(group: Dictionary, flag: String) -> Dictionary:
	var next := 0 if port_flag_state(group, flag) == 2 else 1
	var list: Array = []
	for c in group.get("channels", []):
		list.append({"key": c.get("key"), "type": c.get("type"), flag: next})
	return {"channels": list}


## 0 none, 1 some, 2 all channels of the port have the flag.
static func port_flag_state(group: Dictionary, flag: String) -> int:
	var n := 0
	var cs: Array = group.get("channels", [])
	for c in cs:
		if int(c.get(flag, 0)) != 0:
			n += 1
	if n == 0:
		return 0
	return 2 if n == cs.size() else 1


static func flag_tip(flag: String, what: String) -> String:
	return ("Mute" if flag == "mute" else "Test tone") + " · " + what


static func signal_tip(sig: Variant) -> String:
	if sig == null:
		return ""
	return "Signal" if int(sig) == 1 else "No signal"


static func crosspoint_tip(input: Dictionary, output: Dictionary) -> String:
	return "%s %s → %s %s" % [input.get("port", ""), input.get("name", ""), output.get("port", ""), output.get("name", "")]

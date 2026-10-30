-- HighAsCG selection mirror for grandMA3 (WO-857).
--
-- Watches the console's fixture selection and sends it to HighAsCG as one UDP text datagram per change, so the
-- previs lights the same heads. Run the plugin once to start it, run it again to stop it.
--
--   datagram:  HACG-SEL 1 gma3 <seq> <FIDs>        e.g.  HACG-SEL 1 gma3 1790000123 101,102,110-115
--              "-" as FID list = nothing selected. seq grows with every packet (and across restarts, it starts from
--              the clock). The same selection is re-sent every KEEPALIVE seconds so a lost packet heals.
--
-- Settings: edit HOST / PORT below, or set the user variables HACG_HOST / HACG_PORT on the console (they win).
-- HOST is the HighAsCG box, PORT its selection port (default 6290/udp, config lighting.gma3SelectionPort).
--
-- How the selection is read: it is polled every POLL seconds (Selection / SelectionCount / SelectionFirst /
-- SelectionNext). HookObjectChange(..., Selection(), ...) is tried as well, but only to find out whether it fires on
-- this console (the log says "hook seen"): the poll alone drives the sending, so a console where the hook never
-- fires works the same. Each selected patch index is turned into the fixture's FID. NOT RUN ON A CONSOLE YET: see tools/lighting/grandma3/README.md for the first-run checks.

local HOST = "192.168.0.56"
local PORT = 6290
local POLL = 0.1
local KEEPALIVE = 5

local pluginName = select(1, ...)
local componentName = select(2, ...)
local signalTable = select(3, ...)
local myHandle = select(4, ...)

local function log(text)
	Printf("[HighAsCG] " .. tostring(text))
end

local function setting(name, default)
	local ok, v = pcall(function() return GetVar(UserVars(), name) end)
	if ok and v ~= nil and tostring(v) ~= "" then return v end
	return default
end

-- One selected patch index -> its FID (nil when it cannot be read).
local function fidOf(patchIndex)
	local ok, fx = pcall(GetSubfixture, patchIndex)
	if not ok or fx == nil then return nil end
	local fid
	ok, fid = pcall(function() return fx.FID end)
	if ok and tonumber(fid) then return math.floor(tonumber(fid)) end
	ok, fid = pcall(function() return fx:Get("FID") end)
	if ok and tonumber(fid) then return math.floor(tonumber(fid)) end
	return nil
end

-- The sorted, unique FIDs of the current selection, and how many selected fixtures had no readable FID.
local function readSelection()
	local seen, list, missing = {}, {}, 0
	local count = SelectionCount()
	if not count or count == 0 then return list, 0 end
	local idx = SelectionFirst()
	local guard = 0
	while idx and guard < 100000 do
		guard = guard + 1
		local fid = fidOf(idx)
		if fid then
			if not seen[fid] then
				seen[fid] = true
				list[#list + 1] = fid
			end
		else
			missing = missing + 1
		end
		idx = SelectionNext(idx)
	end
	table.sort(list)
	return list, missing
end

-- {101,102,110,111,112} -> "101,102,110-112"; runs of three or more become a range.
local function encode(list)
	if #list == 0 then return "-" end
	local parts, i = {}, 1
	while i <= #list do
		local j = i
		while j < #list and list[j + 1] == list[j] + 1 do j = j + 1 end
		if j - i >= 2 then
			parts[#parts + 1] = list[i] .. "-" .. list[j]
		else
			for k = i, j do parts[#parts + 1] = tostring(list[k]) end
		end
		i = j + 1
	end
	return table.concat(parts, ",")
end

local function Main(displayHandle)
	if HighAsCG_Selection and HighAsCG_Selection.running then
		HighAsCG_Selection.running = false -- a second run stops the first
		log("selection mirror stopping")
		return
	end
	local state = { running = true }
	HighAsCG_Selection = state

	local host = tostring(setting("HACG_HOST", HOST))
	local port = tonumber(setting("HACG_PORT", PORT)) or PORT
	local socket = require("socket")
	local udp = assert(socket.udp())
	assert(udp:setpeername(host, port))
	local seq = os.time()
	log(string.format("selection mirror -> udp %s:%d (run the plugin again to stop)", host, port))

	local hooked = false
	local okHook, hookId = pcall(function()
		return HookObjectChange(function() hooked = true end, Selection(), myHandle)
	end)
	if not okHook then log("HookObjectChange(Selection) not available, polling only") end

	local last, lastSent, warnedMissing = nil, 0, false
	while state.running do
		local ok, list, missing = pcall(readSelection)
		if ok then
			local text = encode(list)
			local now = os.time()
			if text ~= last or now - lastSent >= KEEPALIVE then
				seq = seq + 1
				udp:send(string.format("HACG-SEL 1 gma3 %d %s", seq, text))
				if text ~= last then log("selection " .. text .. (hooked and " (hook seen)" or "")) end
				last, lastSent = text, now
			end
			if missing > 0 and not warnedMissing then
				warnedMissing = true
				log(missing .. " selected fixture(s) have no readable FID and are skipped")
			end
		elseif not warnedMissing then
			warnedMissing = true
			log("reading the selection failed: " .. tostring(list))
		end
		coroutine.yield(POLL)
	end

	if okHook and hookId then pcall(Unhook, hookId) end
	udp:send(string.format("HACG-SEL 1 gma3 %d -", seq + 1))
	udp:close()
	HighAsCG_Selection = nil
	log("selection mirror stopped")
end

local function Cleanup()
	if HighAsCG_Selection then HighAsCG_Selection.running = false end
end

return Main, Cleanup

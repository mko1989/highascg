'use strict'

function updateClockOffsetFromPing(runtime, localReceiveMs, pingJson) {
	if (!runtime || !pingJson || typeof pingJson.serverTimeMs !== 'number') return
	runtime.clockOffsetMs = pingJson.serverTimeMs - localReceiveMs
	runtime.lastClockSyncAt = localReceiveMs
}

function leaderTimeToLocal(runtime, leaderTimeMs) {
	// offset = leaderNow - localNow at ping → local = leader - offset
	return leaderTimeMs - (runtime?.clockOffsetMs ?? 0)
}

function localApplyTime(runtime, applyAtLeaderTimeMs) {
	return leaderTimeToLocal(runtime, applyAtLeaderTimeMs)
}

module.exports = { updateClockOffsetFromPing, leaderTimeToLocal, localApplyTime }

/** @type {number} */
let lastGpuLayoutTraceSeq = 0

/** @param {number} seq */
export function setLastGpuLayoutTraceSeq(seq) {
	lastGpuLayoutTraceSeq = seq
}

/** @returns {number} */
export function getLastGpuLayoutTraceSeq() {
	return lastGpuLayoutTraceSeq
}

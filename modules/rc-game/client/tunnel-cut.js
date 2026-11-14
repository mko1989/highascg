/**
 * §3.1 tunnels through tables (WO-1074): the scene's own faces vanish inside a tunnel's tube, so the tablecloth gets
 * an arch-shaped hole where the tube (track-tunnel.js) runs through it and nothing of the table shows inside the tube.
 * Every mesh material of the scene GLB is patched once (onBeforeCompile; the Lambert copies of "low" quality too) to
 * discard a fragment that lies inside one of the CUT_MAX straight outer volumes (tunnel.js cutSegments: plan within
 * wo of the piece — no end caps, so nothing outside a portal is cut — and under the arch profile), unless it is a
 * floor-facing face at floor height (the hall floor under the tube stays). The volumes are shared uniforms: changing
 * the track (setCut) needs no recompile.
 */
import * as THREE from 'three'

export const CUT_MAX = 24

const segA = Array.from({ length: CUT_MAX }, () => new THREE.Vector4())
const segB = Array.from({ length: CUT_MAX }, () => new THREE.Vector4())
const U = { rcCutN: { value: 0 }, rcCutA: { value: segA }, rcCutB: { value: segB } }

/** The active volumes ([[ax, az, bx, bz, y, wo, h0, ho]], at most CUT_MAX). */
export function setCut(list) {
	const L = (list || []).slice(0, CUT_MAX)
	L.forEach((v, i) => {
		segA[i].set(v[0], v[1], v[2], v[3])
		segB[i].set(v[4], v[5], v[6], v[7])
	})
	U.rcCutN.value = L.length
}

const VERT_HEAD = 'varying vec3 vRcWorld;\nvarying float vRcUp;\n'
const VERT_BODY = `
	vRcWorld = (modelMatrix * vec4(position, 1.0)).xyz;
	vRcUp = normalize(mat3(modelMatrix) * normal).y;
`
const FRAG_HEAD = `varying vec3 vRcWorld;
varying float vRcUp;
uniform int rcCutN;
uniform vec4 rcCutA[${CUT_MAX}];
uniform vec4 rcCutB[${CUT_MAX}];
bool rcInCut(vec3 p) {
	for (int i = 0; i < ${CUT_MAX}; i++) {
		if (i >= rcCutN) break;
		vec2 a = rcCutA[i].xy, b = rcCutA[i].zw;
		vec2 ab = b - a;
		float l2 = dot(ab, ab);
		float t = l2 > 0.0 ? dot(p.xz - a, ab) / l2 : 0.0;
		if (t < 0.0 || t > 1.0) continue;
		float d = length(a + t * ab - p.xz);
		float wo = rcCutB[i].y;
		if (d > wo) continue;
		float h = p.y - rcCutB[i].x;
		float top = rcCutB[i].z + (rcCutB[i].w - rcCutB[i].z) * sqrt(max(0.0, 1.0 - (d / wo) * (d / wo)));
		if (h > top) continue;
		if (vRcUp > 0.7 && h < 0.004) continue; // the floor itself
		return true;
	}
	return false;
}
`

/** Patch one material (once). */
function patch(m) {
	if (!m || m.userData.rcCut) return
	m.userData.rcCut = true
	const prev = m.onBeforeCompile
	m.onBeforeCompile = (sh, r) => {
		prev?.call(m, sh, r)
		Object.assign(sh.uniforms, U)
		sh.vertexShader =
			VERT_HEAD + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>' + VERT_BODY)
		sh.fragmentShader =
			FRAG_HEAD + sh.fragmentShader.replace('void main() {', 'void main() {\n\tif (rcInCut(vRcWorld)) discard;')
	}
	const key = m.customProgramCacheKey?.bind(m)
	m.customProgramCacheKey = () => (key ? key() : '') + '|rc-cut'
	m.needsUpdate = true
}

/** Patch every mesh material under root (call again after materials are swapped). */
export function applyCut(root) {
	root?.traverse?.((o) => {
		if (!o.isMesh) return
		for (const m of Array.isArray(o.material) ? o.material : [o.material]) patch(m)
	})
}

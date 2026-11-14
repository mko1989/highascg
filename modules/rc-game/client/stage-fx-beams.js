/**
 * WO-1074 §2.6 — the lights' three.js side for stage-fx.js: ONE InstancedMesh each for beam cones, floor pools and lens
 * glows (≤ 150 lights → three draw calls), additive, depth-write off, procedural shaders (no textures, no assets).
 * Cones hang from the light along its direction with soft edges (view-angle falloff) and fade towards the far end; pools
 * are radial gradients lying on the floor; glows are camera-facing discs. A dark light (a = 0) is scaled to nothing.
 */
import { floorHit, halfAngle, poolShape, kindStyle } from './stage-fx-math.js'

const CONE_VS = /* glsl */ `
varying vec3 vCol;
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
	mat4 m = modelMatrix * instanceMatrix;
	vec4 wp = m * vec4(position, 1.0);
	vT = clamp(-position.y, 0.0, 1.0);
#ifdef USE_INSTANCING_COLOR
	vCol = instanceColor;
#else
	vCol = vec3(1.0);
#endif
	vN = normalize(mat3(m) * normal);
	vV = normalize(cameraPosition - wp.xyz);
	gl_Position = projectionMatrix * viewMatrix * wp;
}`

const CONE_FS = /* glsl */ `
uniform float uGain;
varying vec3 vCol;
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
	float facing = abs(dot(normalize(vN), normalize(vV)));
	float edge = smoothstep(0.0, 0.75, facing);
	float fall = (1.0 - vT);
	fall = 0.15 * fall + 0.85 * fall * fall;
	gl_FragColor = vec4(vCol * edge * fall * uGain, 1.0);
}`

const POOL_VS = /* glsl */ `
varying vec3 vCol;
varying float vR;
void main() {
	vR = length(position.xz);
#ifdef USE_INSTANCING_COLOR
	vCol = instanceColor;
#else
	vCol = vec3(1.0);
#endif
	gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`

const POOL_FS = /* glsl */ `
uniform float uGain;
varying vec3 vCol;
varying float vR;
void main() {
	float k = 1.0 - smoothstep(0.0, 1.0, vR);
	gl_FragColor = vec4(vCol * k * k * uGain, 1.0);
}`

const GLOW_VS = /* glsl */ `
varying vec3 vCol;
varying vec2 vUv;
void main() {
	mat4 m = modelMatrix * instanceMatrix;
	vec4 c = viewMatrix * m * vec4(0.0, 0.0, 0.0, 1.0);
	float s = length(m[0].xyz);
	c.xy += position.xy * s;
	vUv = position.xy * 2.0;
#ifdef USE_INSTANCING_COLOR
	vCol = instanceColor;
#else
	vCol = vec3(1.0);
#endif
	gl_Position = projectionMatrix * c;
}`

const GLOW_FS = /* glsl */ `
uniform float uGain;
varying vec3 vCol;
varying vec2 vUv;
void main() {
	float d2 = dot(vUv, vUv);
	if (d2 > 1.0) discard;
	float k = exp(-d2 * 9.0) * 1.4 + exp(-d2 * 2.5) * 0.35;
	gl_FragColor = vec4(mix(vCol, vec3(1.0), 0.35 * exp(-d2 * 30.0)) * k * uGain, 1.0);
}`

function additive(THREE, vs, fs, gain, extra = {}) {
	return new THREE.ShaderMaterial({
		vertexShader: vs,
		fragmentShader: fs,
		uniforms: { uGain: { value: gain } },
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		...extra,
	})
}

/**
 * @param {typeof import('three')} THREE
 * @param {number} max instance capacity (the server sends ≤ 150 lights)
 */
export function createBeamMeshes(THREE, max = 150) {
	const group = new THREE.Group()
	group.name = 'stage-fx-lights'
	const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true)
	coneGeo.translate(0, -0.5, 0) // apex at the origin, base at y = −1: the beam hangs along −Y
	const poolGeo = new THREE.CircleGeometry(1, 40)
	poolGeo.rotateX(-Math.PI / 2) // lies in XZ, facing up
	const glowGeo = new THREE.PlaneGeometry(1, 1)
	const cones = new THREE.InstancedMesh(
		coneGeo,
		additive(THREE, CONE_VS, CONE_FS, 0.35, { side: THREE.DoubleSide }),
		max
	)
	const pools = new THREE.InstancedMesh(
		poolGeo,
		additive(THREE, POOL_VS, POOL_FS, 0.5, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
		max
	)
	const glows = new THREE.InstancedMesh(glowGeo, additive(THREE, GLOW_VS, GLOW_FS, 1), max)
	const zero = new THREE.Matrix4().makeScale(0, 0, 0)
	const black = new THREE.Color(0, 0, 0)
	for (const mesh of [cones, pools, glows]) {
		mesh.frustumCulled = false // instances span the whole room; the bounding sphere would be the first one's
		mesh.count = 0
		for (let i = 0; i < max; i++) {
			mesh.setMatrixAt(i, zero)
			mesh.setColorAt(i, black) // creates instanceColor before the first render (the shaders read it)
		}
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
		group.add(mesh)
	}
	cones.renderOrder = 2
	pools.renderOrder = 1
	glows.renderOrder = 3
	const m4 = new THREE.Matrix4()
	const q = new THREE.Quaternion()
	const s = new THREE.Vector3()
	const v = new THREE.Vector3()
	const down = new THREE.Vector3(0, -1, 0)
	const dir = new THREE.Vector3()
	const col = new THREE.Color()
	const yAxis = new THREE.Vector3(0, 1, 0)
	let floors = []

	/** Write instance `i` from a light { p, kind } and its current state { d, c, a, z }. */
	function write(i, light, cur) {
		const st = kindStyle(light.kind)
		const p = light.p
		if (!(cur.a > 0.002)) {
			cones.setMatrixAt(i, zero)
			pools.setMatrixAt(i, zero)
			glows.setMatrixAt(i, zero)
			return
		}
		const { len, hit } = floorHit(p, cur.d, floors)
		const half = halfAngle(cur.z)
		// cone: wide beams spread the same light thinner
		const r = len * Math.tan(Math.min(half, (60 * Math.PI) / 360))
		dir.set(cur.d[0], cur.d[1], cur.d[2])
		q.setFromUnitVectors(down, dir)
		if (st.cone > 0) {
			m4.compose(v.set(p[0], p[1], p[2]), q, s.set(r, len, r))
			cones.setMatrixAt(i, m4)
			const thin = st.cone / (1 + 2.5 * Math.tan(half))
			cones.setColorAt(i, col.setRGB(cur.c[0] * cur.a * thin, cur.c[1] * cur.a * thin, cur.c[2] * cur.a * thin))
		} else cones.setMatrixAt(i, zero)
		if (hit) {
			const ps = poolShape(cur.d, len, cur.z)
			q.setFromAxisAngle(yAxis, ps.yaw)
			m4.compose(v.set(hit[0], hit[1] + 0.03, hit[2]), q, s.set(ps.major, 1, ps.minor))
			pools.setMatrixAt(i, m4)
			const g = (st.pool * cur.a) / (1 + 0.25 * ps.r)
			pools.setColorAt(i, col.setRGB(cur.c[0] * g, cur.c[1] * g, cur.c[2] * g))
		} else pools.setMatrixAt(i, zero)
		const gs = st.glow * (0.6 + 0.4 * cur.a)
		m4.compose(
			v.set(p[0] + cur.d[0] * 0.2, p[1] + cur.d[1] * 0.2, p[2] + cur.d[2] * 0.2),
			q.identity(),
			s.set(gs, gs, gs)
		)
		glows.setMatrixAt(i, m4)
		glows.setColorAt(i, col.setRGB(cur.c[0] * cur.a, cur.c[1] * cur.a, cur.c[2] * cur.a))
	}

	function flush() {
		for (const mesh of [cones, pools, glows]) {
			mesh.instanceMatrix.needsUpdate = true
			mesh.instanceColor.needsUpdate = true
		}
	}

	return {
		group,
		max,
		write,
		flush,
		setFloors(f) {
			floors = Array.isArray(f) ? f : []
		},
		setCount(n) {
			const c = Math.max(0, Math.min(max, n | 0))
			cones.count = c
			pools.count = c
			glows.count = c
		},
		setQuality(q2) {
			cones.visible = q2 !== 'low'
		},
		dispose() {
			for (const mesh of [cones, pools, glows]) {
				mesh.geometry.dispose()
				mesh.material.dispose()
				mesh.dispose?.()
			}
			group.removeFromParent()
		},
		meshes: { cones, pools, glows },
	}
}

import * as THREE from 'three';

// Late-afternoon atmosphere shared by the sky dome, fog and building reflections.
export const ATMOS = {
  sunDir: new THREE.Vector3(-0.72, 0.26, 0.42).normalize(),
  zenith: new THREE.Color(0x2c5d9e),
  horizon: new THREE.Color(0xb9c6cf),
  sunColor: new THREE.Color(0xffe2bc),
  haze: new THREE.Color(0xf3c9a0),
};

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: ATMOS.sunDir },
      uZenith: { value: ATMOS.zenith },
      uHorizon: { value: ATMOS.horizon },
      uSun: { value: ATMOS.sunColor },
      uHaze: { value: ATMOS.haze },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w * 0.99999; // always behind everything
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uZenith, uHorizon, uSun, uHaze;
      uniform float uTime;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float a = 0.5, s = 0.0;
        for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float sunAmt = max(dot(d, uSunDir), 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
        // warm scattering toward the sun, strongest near the horizon
        float horizonBand = pow(1.0 - clamp(abs(h), 0.0, 1.0), 5.0);
        col = mix(col, uHaze, pow(sunAmt, 3.0) * horizonBand * 0.75);
        col += uSun * pow(sunAmt, 12.0) * 0.35;
        // clouds: a thin layer projected onto a plane
        if (h > 0.01) {
          vec2 uv = d.xz / (h + 0.06) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
          float c = fbm(uv * 1.4);
          c = smoothstep(0.52, 0.85, c) * smoothstep(0.01, 0.18, h);
          vec3 cloudLit = mix(vec3(0.93, 0.92, 0.94), uHaze * 1.15, pow(sunAmt, 4.0) * 0.8);
          col = mix(col, cloudLit, c * 0.8);
        }
        // below the horizon fade into the haze colour (matches the fog)
        col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.08, h));
        // sun disc
        col += uSun * smoothstep(0.99955, 0.99985, sunAmt) * 30.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.scale.setScalar(3000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

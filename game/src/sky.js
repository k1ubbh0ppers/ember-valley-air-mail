// Sky dome, sun, drifting clouds and a few birds. Lighting presets switch the
// valley between morning, noon and dusk; dusk turns the runway lights up.
import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

export const PRESETS = {
  morning: {
    skyTop: 0x7fb2e0, skyBottom: 0xf6d9a0, sunColor: 0xffe0a8, sunIntensity: 2.4,
    sunPos: [-1400, 900, -1600], hemiSky: 0xbfd8ee, hemiGround: 0x8a7a5a, hemiIntensity: 0.85,
    fogColor: 0xe8d9b8, fogNear: 900, fogFar: 5200, cloudTint: 0xffffff, lightBoost: 1,
  },
  noon: {
    skyTop: 0x5ea0dd, skyBottom: 0xcfe8f2, sunColor: 0xfff4d8, sunIntensity: 2.8,
    sunPos: [300, 2400, 400], hemiSky: 0xcfe4f2, hemiGround: 0x7a8a5a, hemiIntensity: 1.0,
    fogColor: 0xd8e8ee, fogNear: 1100, fogFar: 6000, cloudTint: 0xffffff, lightBoost: 1,
  },
  dusk: {
    skyTop: 0x4a4a7a, skyBottom: 0xff9a5a, sunColor: 0xff8a3a, sunIntensity: 2.2,
    sunPos: [1900, 260, 900], hemiSky: 0x8a7aa8, hemiGround: 0x5a4a3a, hemiIntensity: 0.8,
    fogColor: 0xd89a72, fogNear: 700, fogFar: 4200, cloudTint: 0xffd0b0, lightBoost: 1.6,
  },
};

export function buildSky(scene, renderer) {
  // Gradient dome: a shader sphere, far enough to enclose the whole valley.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x7fb2e0) },
      bottomColor: { value: new THREE.Color(0xf6d9a0) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y * 0.5 + 0.5;
        gl_FragColor = vec4(mix(bottomColor, topColor, pow(max(h, 0.0), 0.8)), 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6000, 24, 16), skyMat);
  dome.name = 'sky-dome';
  scene.add(dome);

  const sun = new THREE.DirectionalLight(0xffe0a8, 2.4);
  sun.position.set(-1400, 900, -1600);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbfd8ee, 0x8a7a5a, 0.85);
  scene.add(hemi);
  scene.fog = new THREE.Fog(0xe8d9b8, 900, 5200);
  renderer.setClearColor(0x87b5dd);

  // Sun disc so the low sun reads in screenshots.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(150, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false }),
  );
  sunDisc.name = 'sun-disc';
  scene.add(sunDisc);

  // Clouds: puffs of merged spheres, drifting slowly with the wind.
  const clouds = [];
  const rand = mulberry32(4242);
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 26; i += 1) {
    const puff = new THREE.Group();
    const blobs = 3 + Math.floor(rand() * 3);
    for (let b = 0; b < blobs; b += 1) {
      const r = 26 + rand() * 42;
      const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), cloudMat);
      blob.position.set((rand() - 0.5) * 130, (rand() - 0.5) * 14, (rand() - 0.5) * 50);
      blob.scale.y = 0.45;
      puff.add(blob);
    }
    puff.position.set((rand() - 0.5) * 4200, 420 + rand() * 260, (rand() - 0.5) * 4200);
    puff.name = `cloud-${i}`;
    scene.add(puff);
    clouds.push(puff);
  }

  // Birds: simple dark V shapes crossing the sky.
  const birds = [];
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
  for (let i = 0; i < 6; i += 1) {
    const bird = new THREE.Group();
    const wingGeo = new THREE.BoxGeometry(2.4, 0.12, 0.5);
    const left = new THREE.Mesh(wingGeo, birdMat);
    left.position.x = -1.2;
    const right = new THREE.Mesh(wingGeo, birdMat);
    right.position.x = 1.2;
    bird.add(left); bird.add(right);
    bird.userData = { left, right, phase: rand() * Math.PI * 2, speed: 9 + rand() * 5 };
    bird.position.set((rand() - 0.5) * 2000, 260 + rand() * 120, (rand() - 0.5) * 2000);
    bird.name = `bird-${i}`;
    scene.add(bird);
    birds.push(bird);
  }

  function setPreset(name) {
    const p = PRESETS[name] || PRESETS.morning;
    skyMat.uniforms.topColor.value.set(p.skyTop);
    skyMat.uniforms.bottomColor.value.set(p.skyBottom);
    sun.color.set(p.sunColor);
    sun.intensity = p.sunIntensity;
    sun.position.set(p.sunPos[0], p.sunPos[1], p.sunPos[2]);
    hemi.color.set(p.hemiSky);
    hemi.groundColor.set(p.hemiGround);
    hemi.intensity = p.hemiIntensity;
    scene.fog.color.set(p.fogColor);
    scene.fog.near = p.fogNear;
    scene.fog.far = p.fogFar;
    sunDisc.position.set(p.sunPos[0] * 2.6, Math.max(120, p.sunPos[1] * 2.2), p.sunPos[2] * 2.6);
    sunDisc.lookAt(0, 120, 0);
    sunDisc.material.color.set(p.sunColor);
    cloudMat.color.set(p.cloudTint);
    renderer.setClearColor(p.skyBottom);
    return p;
  }

  function update(dt, time) {
    for (const puff of clouds) {
      puff.position.x += 2.2 * dt;
      if (puff.position.x > 2200) puff.position.x = -2200;
    }
    for (const bird of birds) {
      const u = bird.userData;
      bird.position.x += u.speed * dt;
      bird.position.y += Math.sin(time * 0.7 + u.phase) * 0.4;
      if (bird.position.x > 2100) bird.position.x = -2100;
      const flap = Math.sin(time * 6 + u.phase) * 0.5;
      u.left.rotation.z = flap;
      u.right.rotation.z = -flap;
    }
  }

  return { setPreset, update, sun, hemi };
}

// The valley itself: a seeded heightfield, a river and lake, three villages,
// three grass airstrips and a pine forest. Everything is generated from the
// seed in config.js, so the same valley appears on every machine.
import * as THREE from 'three';
import { WORLD, STRIPS, VILLAGES, RIVER_PATH, LAKE } from './config.js';

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded 2D value noise with smooth interpolation. */
function makeNoise(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) base[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = base[i]; base[i] = base[j]; base[j] = tmp;
  }
  for (let i = 0; i < 512; i += 1) perm[i] = base[i & 255];
  const fade = (t) => t * t * (3 - 2 * t);
  function lattice(ix, iz) {
    return perm[(perm[ix & 255] + iz) & 255] / 255;
  }
  return function noise(x, z) {
    const ix = Math.floor(x); const iz = Math.floor(z);
    const fx = x - ix; const fz = z - iz;
    const a = lattice(ix, iz); const b = lattice(ix + 1, iz);
    const c = lattice(ix, iz + 1); const d = lattice(ix + 1, iz + 1);
    const u = fade(fx); const v = fade(fz);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  };
}

const noise = makeNoise(WORLD.seed);
const detailNoise = makeNoise(WORLD.seed + 7);

/** Fractal brownian motion: 4 octaves of the seeded noise. */
function fbm(x, z) {
  let value = 0; let amp = 1; let freq = 1;
  for (let o = 0; o < 4; o += 1) {
    value += amp * noise(x * freq, z * freq);
    amp *= 0.5; freq *= 2.1;
  }
  return value;
}

/** Distance from a point to one segment of the river polyline. */
function distanceToRiver(x, z) {
  let best = Infinity;
  for (let i = 0; i < RIVER_PATH.length - 1; i += 1) {
    const [ax, az] = RIVER_PATH[i];
    const [bx, bz] = RIVER_PATH[i + 1];
    const dx = bx - ax; const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t; const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const stripById = new Map(STRIPS.map((s) => [s.id, s]));

/** Raw terrain height before the strips are flattened onto it. */
function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  const river = distanceToRiver(x, z);
  const lakeD = Math.hypot(x - LAKE.x, z - LAKE.z);
  let h = 78 + fbm(x * 0.0016, z * 0.0016) * 55 + detailNoise(x * 0.012, z * 0.012) * 7;
  // Carve the valley floor along the river and around the lake.
  const valley = 1 - smoothstep(120, 520, Math.min(river, Math.max(0, lakeD - LAKE.r + 120)));
  h = h * (1 - valley) + 47 * valley;
  // The rim mountains rise toward the edge of the map.
  h += smoothstep(1480, 2050, r) * 560;
  h += smoothstep(1200, 1900, r) * fbm(x * 0.004 + 9, z * 0.004 + 9) * 90;
  return h;
}

/** Terrain height with the airstrips flattened in. */
export function heightAt(x, z) {
  let h = baseHeight(x, z);
  for (const strip of STRIPS) {
    const heading = (strip.heading * Math.PI) / 180;
    const fx = Math.sin(heading); const fz = -Math.cos(heading);
    const rx = Math.cos(heading); const rz = Math.sin(heading);
    const dx = x - strip.x; const dz = z - strip.z;
    const along = dx * fx + dz * fz;
    const across = dx * rx + dz * rz;
    // The strip pad itself.
    const d = Math.hypot(dx, dz);
    if (d < 340) {
      const blend = 1 - smoothstep(180, 340, d);
      h = h * (1 - blend) + strip.elevation * blend;
    }
    // The approach corridor: flat ground under the glide path, both ends,
    // so a landing never meets a hill short of the runway. The lake is
    // left alone — a glide over water needs no grading.
    if (Math.abs(along) < 1000 && Math.abs(across) < 130
      && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + 30) {
      const edge = Math.max(
        smoothstep(90, 130, Math.abs(across)),
        smoothstep(850, 1000, Math.abs(along)),
      );
      const blend = 1 - edge;
      h = h * (1 - blend) + strip.elevation * blend;
    }
  }
  return h;
}

// Sample each strip's elevation once, from the unflattened terrain.
// A strip never sits below the water: the valley floor can dip under it.
for (const strip of STRIPS) {
  strip.elevation = Math.max(baseHeight(strip.x, strip.z), WORLD.waterLevel + 8);
}

/** Is (x, z) inside a strip's runway rectangle? Returns the strip or null. */
export function stripAt(x, z) {
  for (const strip of STRIPS) {
    const heading = (strip.heading * Math.PI) / 180;
    const fx = Math.sin(heading); const fz = -Math.cos(heading);
    const rx = Math.cos(heading); const rz = Math.sin(heading);
    const dx = x - strip.x; const dz = z - strip.z;
    const along = dx * fx + dz * fz;
    const across = dx * rx + dz * rz;
    if (Math.abs(along) < 210 && Math.abs(across) < 17) return strip;
  }
  return null;
}

/** Build the terrain mesh, water, villages, strips and forest into the scene. */
export function buildTerrain(scene) {
  const group = new THREE.Group();
  group.name = 'valley';

  // --- Ground: displaced plane with vertex colours by height and slope. ---
  const segments = 150;
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const grassA = new THREE.Color(0x5d8a3c);
  const grassB = new THREE.Color(0x7ba24a);
  const rock = new THREE.Color(0x8a7d6d);
  const snow = new THREE.Color(0xe8eef2);
  const sand = new THREE.Color(0xc9b078);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i); const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = fbm(x * 0.01 + 40, z * 0.01 + 40);
    tmp.copy(grassA).lerp(grassB, Math.max(0, Math.min(1, 0.5 + n * 0.5)));
    if (h < WORLD.waterLevel + 4) tmp.lerp(sand, smoothstep(WORLD.waterLevel + 4, WORLD.waterLevel + 1, h));
    if (h > 300) tmp.lerp(rock, smoothstep(300, 460, h));
    if (h > 520) tmp.lerp(snow, smoothstep(520, 620, h));
    colours[i * 3] = tmp.r; colours[i * 3 + 1] = tmp.g; colours[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.name = 'ground';
  group.add(ground);

  // --- River ribbon + lake, sitting just above the carved channel. ---
  const waterMat = new THREE.MeshPhongMaterial({
    color: 0x3f7f9e, transparent: true, opacity: 0.88, shininess: 120, specular: 0x99ccdd,
  });
  const ribbon = [];
  const ribbonIndex = [];
  let vi = 0;
  for (let i = 0; i < RIVER_PATH.length - 1; i += 1) {
    const [ax, az] = RIVER_PATH[i];
    const [bx, bz] = RIVER_PATH[i + 1];
    const dx = bx - ax; const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const nx = (-dz / len) * 34; const nz = (dx / len) * 34;
    const steps = 8;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const cx = ax + dx * t; const cz = az + dz * t;
      ribbon.push(cx + nx, WORLD.waterLevel, cz + nz, cx - nx, WORLD.waterLevel, cz - nz);
      if (s > 0 || i > 0) {
        const a = vi - 2; const b = vi - 1; const c = vi; const d = vi + 1;
        ribbonIndex.push(a, b, c, b, d, c);
      }
      vi += 2;
    }
  }
  const riverGeo = new THREE.BufferGeometry();
  riverGeo.setAttribute('position', new THREE.Float32BufferAttribute(ribbon, 3));
  riverGeo.setIndex(ribbonIndex);
  riverGeo.computeVertexNormals();
  const river = new THREE.Mesh(riverGeo, waterMat);
  river.name = 'river';
  group.add(river);
  const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r, 40), waterMat);
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(LAKE.x, WORLD.waterLevel, LAKE.z);
  lake.name = 'lake';
  group.add(lake);

  // --- Airstrips: dirt apron, dark runway, centre dashes, edge lights, windsock. ---
  const runwayMat = new THREE.MeshLambertMaterial({ color: 0x4a4640 });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2ead8 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  const apronMat = new THREE.MeshLambertMaterial({ color: 0x9a7d54 });
  for (const strip of STRIPS) {
    const apron = new THREE.Mesh(new THREE.CircleGeometry(150, 24), apronMat);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(strip.x, strip.elevation + 0.15, strip.z);
    apron.name = `apron-${strip.id}`;
    group.add(apron);
    const runway = new THREE.Mesh(new THREE.PlaneGeometry(400, 26), runwayMat);
    runway.rotation.x = -Math.PI / 2;
    runway.rotation.z = -(strip.heading * Math.PI) / 180;
    runway.position.set(strip.x, strip.elevation + 0.3, strip.z);
    runway.name = `runway-${strip.id}`;
    group.add(runway);
    const heading = (strip.heading * Math.PI) / 180;
    const fx = Math.sin(heading); const fz = -Math.cos(heading);
    const rx = Math.cos(heading); const rz = Math.sin(heading);
    for (let d = -180; d <= 180; d += 40) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.6), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = -(strip.heading * Math.PI) / 180;
      dash.position.set(strip.x + fx * d, strip.elevation + 0.45, strip.z + fz * d);
      group.add(dash);
    }
    for (let d = -195; d <= 195; d += 30) {
      for (const side of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), lightMat);
        lamp.position.set(
          strip.x + fx * d + rx * side * 14,
          strip.elevation + 0.8,
          strip.z + fz * d + rz * side * 14,
        );
        lamp.name = `runway-light-${strip.id}`;
        group.add(lamp);
      }
    }
    // Windsock on a pole beside the strip.
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 9, 6),
      new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }),
    );
    pole.position.set(strip.x + rx * 30, strip.elevation + 4.5, strip.z + rz * 30);
    group.add(pole);
    const sock = new THREE.Mesh(
      new THREE.ConeGeometry(1.1, 4.5, 8),
      new THREE.MeshLambertMaterial({ color: 0xff7a2a }),
    );
    sock.rotation.z = Math.PI / 2;
    sock.position.set(strip.x + rx * 32.5, strip.elevation + 8.4, strip.z + rz * 32.5);
    sock.name = `windsock-${strip.id}`;
    group.add(sock);
  }

  // --- Villages: little houses with warm windows, one red-roofed mail hut each. ---
  const wallCols = [0xe8dcc0, 0xd8c8a8, 0xcbb59a, 0xe0d0b0];
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x8a4a34 });
  const hutRoofMat = new THREE.MeshLambertMaterial({ color: 0xb03a2a });
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  const rand = mulberry32(WORLD.seed + 99);
  for (const village of VILLAGES) {
    const strip = stripById.get(village.strip);
    const cx = strip.x + village.dx; const cz = strip.z + village.dz;
    for (let i = 0; i < village.houses; i += 1) {
      const hx = cx + (rand() - 0.5) * 170;
      const hz = cz + (rand() - 0.5) * 170;
      const hy = heightAt(hx, hz);
      const w = 7 + rand() * 5; const dpt = 6 + rand() * 4; const hh = 4 + rand() * 2;
      const house = new THREE.Group();
      const walls = new THREE.Mesh(
        new THREE.BoxGeometry(w, hh, dpt),
        new THREE.MeshLambertMaterial({ color: wallCols[Math.floor(rand() * wallCols.length)] }),
      );
      walls.position.y = hh / 2;
      house.add(walls);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, dpt) * 0.78, 3.2, 4), roofMat);
      roof.position.y = hh + 1.6;
      roof.rotation.y = Math.PI / 4;
      house.add(roof);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), windowMat);
      win.position.set(0, hh * 0.55, dpt / 2 + 0.05);
      house.add(win);
      house.position.set(hx, hy, hz);
      house.rotation.y = rand() * Math.PI * 2;
      group.add(house);
    }
    // Mail hut by the strip: red roof, easy to spot from the air.
    const hut = new THREE.Group();
    const hutWalls = new THREE.Mesh(
      new THREE.BoxGeometry(9, 4.5, 7),
      new THREE.MeshLambertMaterial({ color: 0xf0e6cc }),
    );
    hutWalls.position.y = 2.25;
    hut.add(hutWalls);
    const hutRoof = new THREE.Mesh(new THREE.ConeGeometry(7.4, 3.4, 4), hutRoofMat);
    hutRoof.position.y = 6.2;
    hutRoof.rotation.y = Math.PI / 4;
    hut.add(hutRoof);
    const hutWin = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.4), windowMat);
    hutWin.position.set(0, 2.4, 3.55);
    hut.add(hutWin);
    hut.position.set(strip.x - 40, strip.elevation, strip.z + 34);
    hut.name = `mail-hut-${strip.id}`;
    group.add(hut);
  }

  // --- Pine forest: instanced trunks and cones, kept off strips and water. ---
  const treeRand = mulberry32(WORLD.seed + 5);
  const spots = [];
  let guard = 0;
  while (spots.length < 1100 && guard < 20000) {
    guard += 1;
    const x = (treeRand() - 0.5) * 3800;
    const z = (treeRand() - 0.5) * 3800;
    const h = heightAt(x, z);
    if (h < 58 || h > 430) continue;
    if (distanceToRiver(x, z) < 90) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 40) continue;
    let nearStrip = false;
    for (const strip of STRIPS) {
      if (Math.hypot(x - strip.x, z - strip.z) < 320) { nearStrip = true; break; }
    }
    if (nearStrip) continue;
    spots.push([x, h, z, 0.7 + treeRand() * 0.9]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 5, 5);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const coneGeo = new THREE.ConeGeometry(4.2, 13, 7);
  const coneMat = new THREE.MeshLambertMaterial({ color: 0x2f5d33 });
  const cones = new THREE.InstancedMesh(coneGeo, coneMat, spots.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const posV = new THREE.Vector3();
  const scaleV = new THREE.Vector3();
  for (let i = 0; i < spots.length; i += 1) {
    const [x, h, z, s] = spots[i];
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), treeRand() * Math.PI * 2);
    posV.set(x, h + 2.5 * s, z); scaleV.set(s, s, s);
    m4.compose(posV, q, scaleV);
    trunks.setMatrixAt(i, m4);
    posV.set(x, h + (2.5 + 6.5) * s, z);
    m4.compose(posV, q, scaleV);
    cones.setMatrixAt(i, m4);
  }
  trunks.name = 'tree-trunks';
  cones.name = 'tree-tops';
  group.add(trunks);
  group.add(cones);

  scene.add(group);
  return { group, stripById };
}
